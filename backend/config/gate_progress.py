"""Per-test durations kept between gate runs, and the progress line's "running … / ~N left, est." part.

`scripts/run-gates.sh` sets two paths:
- SOULLEDGER_TEST_DURATIONS: {nodeid: seconds} from earlier runs. The controller records every test that ran
  (setup + call + teardown; skipped tests are left out, so the suite's skip of a `sharded` test does not
  overwrite what the sharded group measured) and merges them in at the end (`DurationRecorder`).
  `config/worksteal.py` reads it to order tests longest first and to size the workers it dedicates to the
  transactional tests. Locally it lives in the git common dir; on the remote boxes under the synced tree's
  node_modules/.cache, which survives the sync like the jest cache.
- SOULLEDGER_GATE_STATUS: what each worker is running and since when, written by the scheduler on every
  change. The gate's progress line runs this file as a script on it (`main`) every 30 s.

A missing or corrupt durations file is an empty history: the run goes on and the estimate is left out.
Stdlib only: the gate runs `main` with the venv's python but without Django.
"""
import json
import math
import os
import sys
import time
from pathlib import Path

ENV_DURATIONS = "SOULLEDGER_TEST_DURATIONS"
ENV_STATUS = "SOULLEDGER_GATE_STATUS"


def load(path):
    """{nodeid: seconds}; {} when there is no file or it is not what `save` writes."""
    if not path:
        return {}
    try:
        data = json.loads(Path(path).read_text())
        return {str(k): float(v) for k, v in data.items()
                if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v < math.inf}
    except Exception:  # noqa: BLE001 -- history is a hint; never the reason a run fails
        return {}


def save(path, new):
    """Merge `new` into the file. Two runs finishing together (the suite and the sharded group) may lose one
    of the two merges; the next run writes it again."""
    if not path or not new:
        return
    try:
        merged = load(path)
        merged.update({k: round(v, 2) for k, v in new.items()})
        tmp = f"{path}.{os.getpid()}.tmp"
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(tmp).write_text(json.dumps(merged, sort_keys=True))
        os.replace(tmp, path)
    except OSError:
        pass


class DurationRecorder:
    """Controller (or a serial run): sum each test's phases; write them at the end."""

    def __init__(self, path):
        self.path, self.sums, self.skipped = path, {}, set()

    def pytest_runtest_logreport(self, report):
        if report.skipped:
            self.skipped.add(report.nodeid)
        self.sums[report.nodeid] = self.sums.get(report.nodeid, 0.0) + (report.duration or 0.0)

    def pytest_sessionfinish(self, session):
        save(self.path, {k: v for k, v in self.sums.items() if k not in self.skipped})


def write_status(path, status):
    """Scheduler: `status` is {"workers", "left", "queued_s", "known", "running": [[gw, nodeid, start, expected]]}."""
    if not path:
        return
    try:
        tmp = f"{path}.tmp"
        Path(tmp).write_text(json.dumps(status))
        os.replace(tmp, path)
    except OSError:
        pass


def _clock(seconds):
    s = max(0, int(seconds))
    return f"{s // 60}m{s % 60:02d}s" if s >= 60 else f"{s}s"


def status_line(status, now, show=4):
    """'running: gw2 test_x 3m10s; gw4 test_y 40s (+2 more) · ~31 tests left, est. 6 min'. The longest-running
    first; `show` of them. The estimate (only with history): the larger of the longest running test's expected
    remainder and all remaining expected work spread over the workers."""
    running = sorted(status.get("running") or [], key=lambda r: r[2])
    parts = [f"{gw} {nodeid.rsplit('::', 1)[-1][:48]} {_clock(now - start)}" for gw, nodeid, start, _ in running[:show]]
    out = []
    if parts:
        more = len(running) - show
        out.append("running: " + "; ".join(parts) + (f" (+{more} more)" if more > 0 else ""))
    left = status.get("left") or 0
    if left:
        text = f"~{left} tests left"
        if status.get("known"):
            ahead = [max(0.0, exp - (now - start)) for _, _, start, exp in running]
            est = max([*ahead, (status.get("queued_s", 0) + sum(ahead)) / max(1, status.get("workers") or 1)])
            text += f", est. {math.ceil(est / 60)} min"
        out.append(text)
    return " · ".join(out)


def main(argv):
    try:
        line = status_line(json.loads(Path(argv[1]).read_text()), time.time())
    except Exception:  # noqa: BLE001 -- a progress line, never a reason to stop
        return 0
    if line:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
