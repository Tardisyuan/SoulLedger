"""config/worksteal.py: no worker runs a plain database test after a transactional one.

Both schedulers drive the same simulated run (five workers, a collection shaped like the suite's: many short
plain tests, a tail of slow transactional ones, then no-database tests; steals answered asynchronously as xdist
does). Stock worksteal is asserted to break the order, so the simulation can see the 2026-11-16 hand-off;
`TxLastWorkStealing` must not, and must still run every test exactly once.
"""
import heapq
import random

import pytest
from xdist.scheduler.worksteal import WorkStealingScheduling

from config.worksteal import TxLastWorkStealing

PLAIN, TX, NODB = 400, 40, 30


class _Config:
    def getvalue(self, name):
        return ["5*popen"] if name == "tx" else None


class _Worker:
    def __init__(self, sim, name):
        self.sim, self.gateway_id = sim, name
        self.gateway = type("Gateway", (), {"id": name})
        self.queue, self.running, self.ran = [], None, []
        self.shutting_down = self.gone = False

    def send_runtest_some(self, indices):
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


class _Sim:
    def __init__(self, sched_cls, seed):
        rng = random.Random(seed)
        self.kinds = ["db"] * PLAIN + ["tx"] * TX + [None] * NODB
        # The first plain tests are slow (one app's heavy tests, collected together), so the worker holding
        # them still has plain tests queued after the others have taken part of the transactional tail.
        self.durations = [rng.uniform(20, 40) if i < PLAIN // 10 else rng.uniform(0.1, 2) for i in range(PLAIN)] + \
                         [rng.uniform(20, 120) for _ in range(TX)] + [rng.uniform(0.1, 1) for _ in range(NODB)]
        self.sched = sched_cls(_Config())
        if isinstance(self.sched, TxLastWorkStealing):
            self.sched.tx = {i for i, k in enumerate(self.kinds) if k == "tx"}
            self.sched.db = {i for i, k in enumerate(self.kinds) if k == "db"}
        self.now, self.seq, self.events = 0.0, 0, []
        self.workers = [_Worker(self, f"gw{i}") for i in range(5)]

    def at(self, delay, fn):
        self.seq += 1
        heapq.heappush(self.events, (self.now + delay, self.seq, fn))

    def kick(self, w):
        if w.running is not None or w.gone:
            return
        if w.queue:
            w.running = w.queue.pop(0)
            self.at(self.durations[w.running], lambda: self.finish(w))
        elif w.shutting_down:
            w.gone = True
            self.at(0, lambda: self.sched.remove_node(w))

    def finish(self, w):
        i, w.running = w.running, None
        w.ran.append(i)
        self.sched.mark_test_complete(w, i)
        self.kick(w)

    def run(self):
        ids = [f"t{i}" for i in range(len(self.kinds))]
        for w in self.workers:
            self.sched.add_node(w)
            self.sched.add_node_collection(w, ids)
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
def test_tx_last_worksteal_keeps_plain_tests_first_on_every_worker(seed):
    sim = _Sim(TxLastWorkStealing, seed).run()
    assert sim.plain_after_tx() == []
    assert sorted(i for w in sim.workers for i in w.ran) == list(range(len(sim.kinds)))
    assert all(w.gone for w in sim.workers)
