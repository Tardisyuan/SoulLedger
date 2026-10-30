"""GitHub Actions 跑在额度上(上线前缺口 19,用户 2026-10-30 定)。

额度曾经耗尽,而这里几乎每次推送都是推 main。所以 workflow 只许按钟点(最多每天一次)、
按 tag、按手动触发;不许在分支推送或 PR 上自动跑。每个 job 必须有 `timeout-minutes`
(默认 360 分钟,一条挂住的测试就能吃掉一个月额度的几分之一),同一 ref 的旧运行被取消。
"""
from pathlib import Path

import pytest
import yaml

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"


def _load(name):
    data = yaml.safe_load((WORKFLOWS / name).read_text())
    # PyYAML (YAML 1.1) reads the bare key `on` as boolean True.
    return data, data.get("on", data.get(True))


@pytest.mark.parametrize("name", ["ci.yml", "security.yml"])
def test_triggers_stay_on_the_budget(name):
    data, on = _load(name)
    assert set(on) <= {"workflow_dispatch", "schedule", "push"}, f"{name}: {sorted(on)}"
    assert "pull_request" not in on and "pull_request_target" not in on
    if "push" in on:
        push = on["push"] or {}
        assert set(push) == {"tags"}, f"{name}: push runs on more than tags: {push}"
    for entry in on.get("schedule") or []:
        minute, hour, dom, month, dow = entry["cron"].split()
        # At most once a day: a fixed minute and hour (daily, or one weekday).
        assert minute.isdigit() and hour.isdigit() and dom == month == "*", entry
        assert dow == "*" or dow.isdigit(), entry
    assert data["concurrency"]["cancel-in-progress"] is True
    for job_name, job in data["jobs"].items():
        assert isinstance(job.get("timeout-minutes"), int), f"{name}: {job_name} has no timeout-minutes"


def test_ci_does_run_on_its_own():
    """The opposite failure: back to dispatch-only, CI never runs at all."""
    _, on = _load("ci.yml")
    assert on.get("schedule"), "ci.yml has no schedule"
    assert "workflow_dispatch" in on


def test_the_daily_run_skips_a_day_with_no_new_commit():
    """User 2026-10-30: no change, no daily run. The `changes` job decides; every other job waits on it (directly or
    through `needs` on a job that does), so a skipped `changes` gate skips the whole run."""
    data, _ = _load("ci.yml")
    jobs = data["jobs"]
    check = " ".join(step.get("run", "") for step in jobs["changes"]["steps"])
    assert "schedule" in check and "86400" in check, "the changes job no longer limits only the daily run"

    def gated(name, seen=()):
        job = jobs[name]
        needs = job.get("needs") or []
        needs = [needs] if isinstance(needs, str) else needs
        if "changes" in needs:
            return "needs.changes.outputs.run" in str(job.get("if", ""))
        return bool(needs) and all(n not in seen and gated(n, (*seen, name)) for n in needs)

    ungated = [name for name in jobs if name != "changes" and not gated(name)]
    assert ungated == [], f"jobs that run even on a day with no commit: {ungated}"


def test_the_backend_suite_runs_in_parallel():
    """2026-10-30 (user decision): CI's backend suite ran serially on minutes it pays for. pytest-xdist is in
    requirements-dev.txt, so that file is installed before the tests, not only for ruff after them."""
    data, _ = _load("ci.yml")
    steps = data["jobs"]["backend"]["steps"]
    runs = [step.get("run", "") for step in steps]
    install = next(i for i, r in enumerate(runs) if "-r requirements-dev.txt" in r)
    tests = next(i for i, r in enumerate(runs) if "python -m pytest" in r)
    assert install < tests
    # The command line itself, not the comment above it in the same `run:` block.
    (command,) = [ln for ln in runs[tests].splitlines() if ln.strip().startswith("python -m pytest")]
    assert "-n auto" in command, command
