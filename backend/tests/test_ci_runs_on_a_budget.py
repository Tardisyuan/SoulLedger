"""GitHub Actions 跑在额度上(上线前缺口 19,用户 2026-10-30 定)。

额度曾经耗尽,而这里几乎每次推送都是推 main。所以 workflow 只许按钟点、按 tag、
按手动触发;不许在分支推送或 PR 上自动跑。每个 job 必须有 `timeout-minutes`
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
        # At most once a week: a fixed minute, hour and weekday.
        assert minute.isdigit() and hour.isdigit() and dow.isdigit() and dom == month == "*", entry
    assert data["concurrency"]["cancel-in-progress"] is True
    for job_name, job in data["jobs"].items():
        assert isinstance(job.get("timeout-minutes"), int), f"{name}: {job_name} has no timeout-minutes"


def test_ci_does_run_on_its_own():
    """The opposite failure: back to dispatch-only, CI never runs at all."""
    _, on = _load("ci.yml")
    assert on.get("schedule"), "ci.yml has no schedule"
    assert "workflow_dispatch" in on
