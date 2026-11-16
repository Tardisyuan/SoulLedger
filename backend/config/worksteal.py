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
"""
import json
from pathlib import Path

from xdist.scheduler.worksteal import MIN_PENDING, WorkStealingScheduling

WORKERINPUT_KEY = "soulledger_db_kinds_path"


def write_kinds(path, kinds):
    """Worker side: `kinds` is `_db_kind(item)` for each collected item, in order ('tx' / 'db' / None)."""
    Path(path).write_text(json.dumps({
        "n": len(kinds),
        "tx": [i for i, k in enumerate(kinds) if k == "tx"],
        "db": [i for i, k in enumerate(kinds) if k == "db"],
    }))


class TxLastWorkStealing(WorkStealingScheduling):
    def __init__(self, config, log=None, kinds_path=None):
        super().__init__(config, log)
        self.kinds_path = kinds_path
        self.tx = self.db = None  # sets of collection indices; tests may set them directly
        self.tainted = set()

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
        up = [(n, p) for n, p in self.node2pending.items() if not n.shutting_down]
        # No clean worker left (one crashed): run plain tests anyway rather than hang with them pending.
        clean_left = any(n not in self.tainted for n, _ in up)

        def tainted(node):
            return clean_left and node in self.tainted

        def idle_nodes():
            return [n for n, p in up if len(p) < MIN_PENDING]

        idle = idle_nodes()
        if not idle:
            return
        if self.pending:
            # Tainted first, so the last clean worker takes whatever plain tests are left.
            ordered = [n for n in idle if tainted(n)] + [n for n in idle if not tainted(n)]
            for i, node in enumerate(ordered):
                ok = [x for x in self.pending if x not in self.db] if tainted(node) else list(self.pending)
                self._send(node, ok[: len(ok) // (len(ordered) - i)])
            idle = idle_nodes()
            if not idle:
                return
        if self.steal_requested_from_node is not None:
            return
        only_tainted = all(tainted(n) for n in idle)

        def stealable(pending):
            num = min(len(pending) // 2, max(0, len(pending) - MIN_PENDING))
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
