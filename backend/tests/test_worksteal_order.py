"""config/worksteal.py: no worker runs a plain database test after a transactional one.

Both schedulers drive the same simulated run (five workers, a collection shaped like the suite's: many short
plain tests, a tail of slow transactional ones, then no-database tests; steals answered asynchronously as xdist
does). Stock worksteal is asserted to break the order, so the simulation can see the 2026-11-16 hand-off;
`TxLastWorkStealing` must not, and must still run every test exactly once.

2026-11-19 (the tail): with recorded durations it dedicates workers to the transactional tests and orders them
longest first. `_MainTxLast` is the scheduler as it was on main f44543d66, the baseline its makespan is held to.
Seeds are fixed (xdist refuses a collection that differs between workers); every assertion names its seed.
"""
import heapq
import json
import random

import pytest
from xdist.scheduler.worksteal import MIN_PENDING, WorkStealingScheduling

from config import gate_progress
from config.worksteal import TxLastWorkStealing

PLAIN, TX, NODB = 400, 40, 30


class _Config:
    def __init__(self, n=5):
        self.n = n

    def getvalue(self, name):
        return [f"{self.n}*popen"] if name == "tx" else None


class _MainTxLast(TxLastWorkStealing):
    """check_schedule as on main f44543d66: collected order, no dedicated workers, even shares."""

    def check_schedule(self):
        if self.collection is None:
            return WorkStealingScheduling.check_schedule(self)
        up = [(n, p) for n, p in self.node2pending.items() if not n.shutting_down]
        clean_left = any(n not in self.tainted for n, _ in up)

        def tainted(node):
            return clean_left and node in self.tainted

        def idle_nodes():
            return [n for n, p in up if len(p) < MIN_PENDING]

        idle = idle_nodes()
        if not idle:
            return
        if self.pending:
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


class _Worker:
    def __init__(self, sim, name):
        self.sim, self.gateway_id = sim, name
        self.gateway = type("Gateway", (), {"id": name})
        self.queue, self.running, self.ran = [], None, []
        self.shutting_down = self.gone = False

    def send_runtest_some(self, indices):
        self.sim.sent.extend(indices)
        self.queue.extend(indices)
        self.sim.kick(self)

    def send_steal(self, indices):
        # xdist: the worker answers later with the ones it has not started.
        def answer():
            returned = [i for i in self.queue if i in indices]
            self.queue[:] = [i for i in self.queue if i not in indices]
            self.sim.sched.remove_pending_tests_from_node(self, returned)

        self.sim.at(0, answer)

    def shutdown(self):
        self.shutting_down = True
        self.sim.kick(self)


def _suite_like(rng):
    kinds = ["db"] * PLAIN + ["tx"] * TX + [None] * NODB
    # The first plain tests are slow (one app's heavy tests, collected together), so the worker holding
    # them still has plain tests queued after the others have taken part of the transactional tail.
    durations = [rng.uniform(20, 40) if i < PLAIN // 10 else rng.uniform(0.1, 2) for i in range(PLAIN)] + \
                [rng.uniform(20, 120) for _ in range(TX)] + [rng.uniform(0.1, 1) for _ in range(NODB)]
    return kinds, durations, set()


def _tail_heavy(rng):
    """The gate's shape: many short plain tests; short transactional ones, then 26 migration round trips of
    60-90 s alone that slow each other down (`CONTENTION`), as on the gate machines: 1-1.5 min alone, 3-7 min
    when several run at once."""
    kinds = ["db"] * 1500 + ["tx"] * 60 + ["tx"] * 26 + [None] * 300
    durations = [rng.uniform(0.2, 2.5) for _ in range(1500)] + [rng.uniform(0.5, 4) for _ in range(60)] + \
                [rng.uniform(60, 90) for _ in range(26)] + [rng.uniform(0.05, 0.5) for _ in range(300)]
    return kinds, durations, set(range(1560, 1586))


CONTENTION = 0.6  # each other round trip running when one starts makes it 60 % longer


class _Sim:
    def __init__(self, sched_cls, seed, shape=_suite_like, workers=5, history="exact"):
        rng = random.Random(seed)
        self.kinds, self.base, self.contended = shape(rng)
        self.durations = list(self.base)  # what each test took in this run (contention included)
        self.ids = [f"tests/test_f{i // 8}.py::t{i}" for i in range(len(self.kinds))]
        if issubclass(sched_cls, TxLastWorkStealing):
            # History: last run's durations, give or take 30 %; "none" is a first run.
            recorded = {} if history == "none" else {
                n: d * rng.uniform(0.7, 1.3) for n, d in zip(self.ids, self.base, strict=True)}
            self.sched = sched_cls(_Config(workers), durations=recorded)
            self.sched.status_path = None  # under the gate, the env names the live progress file
            self.sched.tx = {i for i, k in enumerate(self.kinds) if k == "tx"}
            self.sched.db = {i for i, k in enumerate(self.kinds) if k == "db"}
        else:
            self.sched = sched_cls(_Config(workers))
        self.now, self.seq, self.events, self.tx_starts, self.sent = 0.0, 0, [], [], []
        self.workers = [_Worker(self, f"gw{i}") for i in range(workers)]

    def at(self, delay, fn):
        self.seq += 1
        heapq.heappush(self.events, (self.now + delay, self.seq, fn))

    def kick(self, w):
        if w.running is not None or w.gone:
            return
        if w.queue:
            w.running = w.queue.pop(0)
            if self.kinds[w.running] == "tx":
                self.tx_starts.append((self.now, w.running))
            if w.running in self.contended:
                others = sum(1 for o in self.workers if o is not w and o.running in self.contended)
                self.durations[w.running] = self.base[w.running] * (1 + CONTENTION * others)
            self.at(self.durations[w.running], lambda: self.finish(w))
        elif w.shutting_down:
            w.gone = True
            self.at(0, lambda: self.sched.remove_node(w))

    def finish(self, w):
        i, w.running = w.running, None
        w.ran.append(i)
        self.sched.mark_test_complete(w, i, self.durations[i])
        self.kick(w)

    def run(self):
        for w in self.workers:
            self.sched.add_node(w)
            self.sched.add_node_collection(w, self.ids)
        self.sched.schedule()
        while self.events:
            self.now, _, fn = heapq.heappop(self.events)
            fn()
        return self

    def plain_after_tx(self):
        bad = []
        for w in self.workers:
            seen_tx = False
            for i in w.ran:
                seen_tx = seen_tx or self.kinds[i] == "tx"
                if seen_tx and self.kinds[i] == "db":
                    bad.append((w.gateway_id, i))
        return bad


SEEDS = range(20)


def test_stock_worksteal_hands_plain_tests_to_a_worker_after_transactional_ones():
    broken = [s for s in SEEDS if _Sim(WorkStealingScheduling, s).run().plain_after_tx()]
    assert broken, "the simulation no longer reproduces the hand-off, so the test below proves nothing"


@pytest.mark.parametrize("seed", SEEDS)
@pytest.mark.parametrize("shape", [_suite_like, _tail_heavy], ids=["suite", "tail"])
@pytest.mark.parametrize("workers", [2, 3, 5, 11])
@pytest.mark.parametrize("history", ["exact", "none"])
def test_tx_last_worksteal_keeps_plain_tests_first_on_every_worker(seed, shape, workers, history):
    sim = _Sim(TxLastWorkStealing, seed, shape, workers, history).run()
    assert sim.plain_after_tx() == [], f"seed {seed}"
    assert sorted(i for w in sim.workers for i in w.ran) == list(range(len(sim.kinds))), f"seed {seed}"
    assert all(w.gone for w in sim.workers), f"seed {seed}"


@pytest.mark.parametrize("seed", SEEDS)
@pytest.mark.parametrize("shape", [_suite_like, _tail_heavy], ids=["suite", "tail"])
@pytest.mark.parametrize("workers", [3, 5, 11])
def test_the_makespan_is_no_worse_than_on_main(seed, shape, workers):
    new = _Sim(TxLastWorkStealing, seed, shape, workers).run().now
    old = _Sim(_MainTxLast, seed, shape, workers).run().now
    assert new <= old * 1.01, f"seed {seed}: {new:.0f} s against main's {old:.0f} s"


def test_a_tail_of_round_trips_finishes_clearly_sooner():
    """Five workers, as the gate runs. Each seed sooner, and a tenth sooner over all of them: main runs all 26
    round trips side by side at the end, this scheduler two at a time from the start."""
    new = {s: _Sim(TxLastWorkStealing, s, _tail_heavy).run().now for s in SEEDS}
    old = {s: _Sim(_MainTxLast, s, _tail_heavy).run().now for s in SEEDS}
    for s in SEEDS:
        assert new[s] <= old[s] * 0.97, f"seed {s}: {new[s]:.0f} s against main's {old[s]:.0f} s"
    assert sum(new.values()) <= 0.9 * sum(old.values()), f"{sum(new.values()):.0f} s against {sum(old.values()):.0f} s"


@pytest.mark.parametrize("seed", SEEDS)
def test_dedicated_workers_take_the_longest_transactional_tests_first(seed):
    sim = _Sim(TxLastWorkStealing, seed, _tail_heavy).run()
    assert sim.sched.dedicated, f"seed {seed}"
    for w in sim.sched.dedicated:
        assert w.ran and sim.kinds[w.ran[0]] == "tx", f"seed {seed}: {w.gateway_id} started on {w.ran[:1]}"
    # Transactional tests go out in recorded longest-first order, whoever takes them.
    sent = [sim.sched.expected[i] for i in sim.sent if i in sim.sched.tx]
    assert sent == sorted(sent, reverse=True), f"seed {seed}"


def test_the_dedicated_share_follows_the_recorded_durations(monkeypatch):
    monkeypatch.delenv("PYTEST_TX_WORKERS", raising=False)
    sim = _Sim(TxLastWorkStealing, 1, _tail_heavy, workers=11).run()
    tx_share = sum(sim.sched.expected[i] for i in sim.sched.tx) / sum(sim.sched.expected)
    assert len(sim.sched.dedicated) == max(1, round(11 * tx_share)) > 2
    # No history: the default share, 2 of 11. Fewer than three workers: none.
    assert len(_Sim(TxLastWorkStealing, 1, _tail_heavy, 11, "none").run().sched.dedicated) == 2
    assert _Sim(TxLastWorkStealing, 1, _tail_heavy, 2).run().sched.dedicated == []
    monkeypatch.setenv("PYTEST_TX_WORKERS", "0")
    assert _Sim(TxLastWorkStealing, 1, _tail_heavy, 11).run().sched.dedicated == []
    monkeypatch.setenv("PYTEST_TX_WORKERS", "3")
    assert len(_Sim(TxLastWorkStealing, 1, _tail_heavy, 11).run().sched.dedicated) == 3


@pytest.mark.parametrize("content", ["{not json", "[1, 2]", '{"a::b": "x", "c::d": -1}', ""])
def test_a_corrupt_durations_file_is_an_empty_history(tmp_path, monkeypatch, content):
    path = tmp_path / "durations.json"
    path.write_text(content)
    assert gate_progress.load(str(path)) == {}
    monkeypatch.setenv(gate_progress.ENV_DURATIONS, str(path))
    assert TxLastWorkStealing(_Config()).history == {}
    gate_progress.save(str(path), {"t::a": 1.5})
    assert gate_progress.load(str(path)) == {"t::a": 1.5}
    assert gate_progress.load(str(tmp_path / "missing.json")) == {}


def test_recorded_durations_merge_and_leave_skipped_tests_out(tmp_path):
    path = tmp_path / "d.json"
    path.write_text(json.dumps({"old::t": 3.0, "a::t": 9.0}))
    rec = gate_progress.DurationRecorder(str(path))

    class _R:
        def __init__(self, nodeid, duration, skipped=False):
            self.nodeid, self.duration, self.skipped = nodeid, duration, skipped

    for r in [_R("a::t", 0.5), _R("a::t", 2.0), _R("a::t", 0.25), _R("s::t", 0.01, skipped=True)]:
        rec.pytest_runtest_logreport(r)
    rec.pytest_sessionfinish(None)
    assert gate_progress.load(str(path)) == {"old::t": 3.0, "a::t": 2.75}


def test_the_progress_line_names_what_runs_and_estimates_what_is_left():
    now = 10_000.0
    status = {"workers": 4, "left": 31, "known": True, "queued_s": 600.0, "running": [
        ["gw4", "tests/test_b.py::test_short", now - 40, 30.0],
        ["gw2", "apps/realms/tests.py::TestX::test_realms_0015_round_trip", now - 190, 300.0],
    ]}
    # (600 + 110 + 0) / 4 = 177.5 s, more than the 110 s gw2 still has -> 3 min.
    assert gate_progress.status_line(status, now) == \
        "running: gw2 test_realms_0015_round_trip 3m10s; gw4 test_short 40s · ~31 tests left, est. 3 min"
    status["queued_s"] = 0.0
    status["running"][1][3] = 700.0  # 510 s still to go on gw2 alone
    assert gate_progress.status_line(status, now).endswith("est. 9 min")
    # No history: no estimate, the count stays.
    status["known"] = False
    assert gate_progress.status_line(status, now).endswith(" · ~31 tests left")
    # Many workers: the four longest-running, then a count.
    status["running"] = [[f"gw{i}", f"t.py::t{i}", now - i, 1.0] for i in range(7)]
    assert gate_progress.status_line(status, now).startswith(
        "running: gw6 t6 6s; gw5 t5 5s; gw4 t4 4s; gw3 t3 3s (+3 more)")
    assert gate_progress.status_line({}, now) == ""


def test_the_progress_script_prints_nothing_for_a_missing_or_corrupt_status(tmp_path, capsys):
    bad = tmp_path / "s.json"
    bad.write_text("{oops")
    assert gate_progress.main(["x", str(bad)]) == 0
    assert gate_progress.main(["x", str(tmp_path / "missing")]) == 0
    assert capsys.readouterr().out == ""


def test_the_scheduler_writes_the_status_the_line_reads(tmp_path):
    path = tmp_path / "status.json"
    sim = _Sim(TxLastWorkStealing, 3, _tail_heavy)
    sim.sched.status_path = str(path)
    seen = []
    write = gate_progress.write_status

    def spy(p, status):
        seen.append(status)
        write(p, status)

    gate_progress.write_status = spy
    try:
        sim.run()
    finally:
        gate_progress.write_status = write
    mid = seen[len(seen) // 2]
    assert len(mid["running"]) == 5 and mid["known"] is True and 0 < mid["left"] < len(sim.kinds)
    assert json.loads(path.read_text())["left"] == 0


def _few_plain(plain, tx):
    """`tests/test_ask_data_evals.py` (2026-11-21): one plain test among 73 no-database ones. With `-n 2` both
    workers were clean, the plain test went to one, nothing went to the other, and neither was handed the
    no-database tests, so xdist shut both down with 73 pending: `Unexpectedly no active workers available`."""
    def shape(rng):
        kinds = ["db"] * plain + ["tx"] * tx + [None] * 73
        return kinds, [rng.uniform(0.1, 2) for _ in kinds], set()
    return shape


@pytest.mark.parametrize("plain", [1, 2, 3, 5, 7])
@pytest.mark.parametrize("tx", [0, 1, 4])
@pytest.mark.parametrize("workers", [2, 3, 5])
@pytest.mark.parametrize("history", ["exact", "none"])
def test_a_handful_of_plain_tests_does_not_strand_the_rest(plain, tx, workers, history):
    sim = _Sim(TxLastWorkStealing, 0, _few_plain(plain, tx), workers, history).run()
    assert sorted(i for w in sim.workers for i in w.ran) == list(range(len(sim.kinds)))
    assert sim.plain_after_tx() == []
