"""`--dist worksteal` that never hands a worker a plain database test after a transactional one.

A transactional test's teardown truncates every table, including the rows data migrations seed (roles,
permissions, a SYSTEM_ADMIN). The collected order keeps plain tests first (root conftest.py,
`pytest_collection_modifyitems`), but stock worksteal does not keep it per worker: an idle worker that ran
part of the transactional tail steals plain tests from a busier one and runs them after the flush.
2026-11-16: gw4 ran `test_ws_*` / `test_workflow_number`, then failed `test_judgment_request_reassign`; on real
PostgreSQL the same steal failed eight perm / scheduler tests. Each passed alone.

d2b9b4e73 fixed that by flushing and reloading the seed before such a plain test. Correct, but at the tail plain
and transactional tests interleave on every worker, and the full run went from ~16 min to past 90.

Here the scheduler keeps the order instead: a worker that has been sent a transactional test ("tainted") is only
ever sent non-plain tests (transactional or no-database) afterwards; plain tests go to clean workers. Every
worker's queue is therefore plain tests, then the rest, which is the collected order, so nothing needs reseeding.

The controller does not collect, so it cannot tell a transactional test from a nodeid. gw0 writes the
collection's kinds (indices into the collected list) to a file the controller named in `workerinput`
(`write_kinds`), before it reports its collection; the scheduler reads it once. `tests/test_worksteal_order.py`
drives this class and stock worksteal through the same simulated run: stock breaks the order, this does not.

THE TAIL (2026-11-19). That order put every transactional test last on every worker, so the migration round trips
(1–1.5 min alone, 3–7 min side by side) all ran in the final minutes while the progress line sat at 99% for 10–15
of a ~35-minute `--real-pg --full`. Now, with the per-test durations earlier runs recorded (config/gate_progress.py):
- K of the N workers (N >= 3) are dedicated: tainted from the start, they take transactional tests from the
  first second, longest first, while the others run the plain tests. K = max(1, round(N × share)), share = the
  transactional tests' part of the expected time (0.2 with no history); PYTEST_TX_WORKERS=<K> overrides, 0 turns
  it off. At most N − 1, so a clean worker is left for the plain tests.
- Transactional tests go out a couple at a time, longest first (greedy longest-processing-time), to whichever
  worker frees first — not as a fixed share, which is what stacked them up.
- Plain and no-database tests keep their per-file order (module and class fixtures, `setUpTestData`) with the
  longest files first. Unknown tests count as the average.
The invariant is unchanged: dedicated workers are tainted before their first test, so they get no plain test.
"""
import json
import os
from collections import defaultdict
from pathlib import Path
from time import time

from xdist.scheduler.worksteal import MIN_PENDING, WorkStealingScheduling

from config import gate_progress

DEFAULT_TX_SHARE = 0.2

WORKERINPUT_KEY = "soulledger_db_kinds_path"


def write_kinds(path, kinds):
    """Worker side: `kinds` is `_db_kind(item)` for each collected item, in order ('tx' / 'db' / None)."""
    Path(path).write_text(json.dumps({
        "n": len(kinds),
        "tx": [i for i, k in enumerate(kinds) if k == "tx"],
        "db": [i for i, k in enumerate(kinds) if k == "db"],
    }))


class TxLastWorkStealing(WorkStealingScheduling):
    def __init__(self, config, log=None, kinds_path=None, durations=None):
        super().__init__(config, log)
        self.kinds_path = kinds_path
        self.tx = self.db = None  # sets of collection indices; tests may set them directly
        self.tainted = set()
        self.history = gate_progress.load(os.environ.get(gate_progress.ENV_DURATIONS)) if durations is None else durations
        self.status_path = os.environ.get(gate_progress.ENV_STATUS)
        self.expected = None  # seconds per collection index, once collected
        self.started = {}  # node -> when its current test started (approximately: its previous one ended)
        self.left = self.left_s = 0
        self.dedicated = []

    def _prepare(self):
        """Once, at the first schedule: expected durations, the order, the dedicated workers."""
        known = [self.history[n] for n in self.collection if n in self.history]
        avg = sum(known) / len(known) if known else 1.0
        self.expected = [self.history.get(n, avg) for n in self.collection]
        self.left, self.left_s = len(self.collection), sum(self.expected)

        def group(i):
            return 0 if i in self.db else 1 if i in self.tx else 2

        def file(i):
            return self.collection[i].split("::", 1)[0]

        per_file = defaultdict(float)
        for i in self.pending:
            per_file[group(i), file(i)] += self.expected[i]

        def key(i):
            g = group(i)
            if g == 1:
                return (g, -self.expected[i], "", i)
            return (g, -per_file[g, file(i)], file(i), i)

        self.pending.sort(key=key)

        n = self.numnodes
        override = os.environ.get("PYTEST_TX_WORKERS", "").strip()
        if override.isdigit():
            k = int(override)
        elif n < 3:
            k = 0
        else:
            total = sum(self.expected)
            share = sum(self.expected[i] for i in self.tx) / total if known and total else DEFAULT_TX_SHARE
            k = max(1, int(n * share))  # floor: clean workers join the tail later, dedicated ones never leave it
        k = min(k, len(self.node2pending) - 1, len(self.tx))
        self.dedicated = sorted(self.node2pending, key=lambda node: node.gateway.id)[:max(0, k)]
        self.tainted.update(self.dedicated)

    def _status(self):
        if not self.status_path or self.expected is None:
            return
        running = [[node.gateway.id, self.collection[p[0]], self.started.get(node, time()), self.expected[p[0]]]
                   for node, p in self.node2pending.items() if p]
        gate_progress.write_status(self.status_path, {
            "workers": len(self.node2pending), "left": self.left, "known": bool(self.history),
            "queued_s": max(0.0, self.left_s - sum(r[3] for r in running)), "running": running,
        })

    def mark_test_complete(self, node, item_index, duration=None):
        if self.expected is not None:
            self.left -= 1
            self.left_s -= self.expected[item_index]
        self.started[node] = time()
        super().mark_test_complete(node, item_index, duration)
        self._status()

    def _load_kinds(self):
        if self.tx is None:
            data = json.loads(Path(self.kinds_path).read_text())
            if data["n"] != len(self.collection):
                raise RuntimeError(f"{self.kinds_path}: {data['n']} kinds for {len(self.collection)} tests")
            self.tx, self.db = set(data["tx"]), set(data["db"])

    def _send(self, node, indices):
        if not indices:
            return
        taken = set(indices)
        self.pending[:] = [i for i in self.pending if i not in taken]
        if not self.node2pending[node]:
            self.started[node] = time()
        self.node2pending[node].extend(indices)
        if not taken.isdisjoint(self.tx):
            self.tainted.add(node)
        node.send_runtest_some(indices)

    def check_schedule(self):
        """Stock `check_schedule`, except that a tainted worker is sent only non-plain tests and steals only
        a victim's non-plain tail (queues are plain-then-rest, so that tail is exact)."""
        if self.collection is None:
            return super().check_schedule()
        self._load_kinds()
        if self.expected is None:
            self._prepare()
        up = [(n, p) for n, p in self.node2pending.items() if not n.shutting_down]
        # No clean worker left (one crashed): run plain tests anyway rather than hang with them pending.
        clean_left = any(n not in self.tainted for n, _ in up)

        def tainted(node):
            return clean_left and node in self.tainted

        def idle_nodes():
            return [n for n, p in up if len(p) < MIN_PENDING]

        def steal_size(pending):
            return min(len(pending) // 2, max(0, len(pending) - MIN_PENDING))

        idle = idle_nodes()
        if not idle:
            return
        if self.pending:
            # Plain tests, while any are pending, to the clean idle workers in even shares (stock worksteal).
            plain_nodes = [n for n in idle if not tainted(n)] if not self.db.isdisjoint(self.pending) else []
            for i, node in enumerate(plain_nodes):
                plain = [x for x in self.pending if x in self.db]
                self._send(node, plain[: len(plain) // (len(plain_nodes) - i)])
            # Everyone else: transactional tests, longest first, only enough to keep MIN_PENDING queued, so the
            # next one goes to whichever worker frees first; then the no-database tests in even shares.
            # A clean worker is the only kind that can run plain tests, and taking a transactional one ends
            # that: while another clean worker still has plain tests to spare, it steals those instead (below).
            plain_backlog = any(steal_size(p) for n, p in up if not tainted(n))
            rest_nodes = [n for n in idle if n not in plain_nodes and (tainted(n) or not plain_backlog)]
            for i, node in enumerate(rest_nodes):
                tx = sorted((x for x in self.pending if x in self.tx), key=lambda x: -self.expected[x])
                if tx:
                    self._send(node, tx[: max(1, MIN_PENDING - len(self.node2pending[node]))])
                else:
                    rest = [x for x in self.pending if x not in self.db]
                    self._send(node, rest[: len(rest) // (len(rest_nodes) - i)])
            idle = idle_nodes()
            if not idle:
                return
        if self.steal_requested_from_node is not None:
            return
        only_tainted = all(tainted(n) for n in idle)

        def stealable(pending):
            num = steal_size(pending)
            if only_tainted:
                run = 0
                for x in reversed(pending):
                    if x in self.db:
                        break
                    run += 1
                num = min(num, run)
            return num

        victim = max(up, key=lambda np: stealable(np[1]), default=None)
        num = stealable(victim[1]) if victim else 0
        if num == 0:
            for node in idle:
                node.shutdown()
            return
        victim[0].send_steal(victim[1][-num:])
        self.steal_requested_from_node = victim[0]
