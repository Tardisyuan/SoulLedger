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


# Every workflow, not a named list: ios-sim-build.yml (2026-11-07) would otherwise be outside the guard.
@pytest.mark.parametrize("name", sorted(p.name for p in WORKFLOWS.glob("*.yml")))
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


def _runs(job):
    data, _ = _load("ci.yml")
    return [step.get("run", "") for step in data["jobs"][job]["steps"]]


def test_the_multidb_guard_runs_in_the_backend_job():
    """Review C21 (2026-10-31): test_multidb_shadow.py exists only under its own settings, so the suite skips it."""
    (command,) = [r for r in _runs("backend") if "test_multidb_shadow.py" in r]
    assert "--ds=config.settings_multidb" in command and "-m multidb" in command, command


def test_the_synapse_integration_runs_against_a_started_synapse_and_a_skip_fails_it():
    """Review C21: test_chat_synapse_integration.py skips without SYNAPSE_TEST_URL. The job starts a disposable
    Synapse, sets the variables both of its skips read, and turns any skip into a red job."""
    data, _ = _load("ci.yml")
    job = data["jobs"]["synapse"]
    env = job["env"]
    assert env["SYNAPSE_TEST_URL"] and env["SYNAPSE_TEST_PUSH"], env
    runs = _runs("synapse")
    up = next(i for i, r in enumerate(runs) if "scripts/synapse-test.sh up" in r)
    test = next(i for i, r in enumerate(runs) if "tests/test_chat_synapse_integration.py" in r)
    assert up < test
    assert "--liveserver 0.0.0.0:18099" in runs[test] and "! grep -q SKIPPED" in runs[test], runs[test]
    assert (WORKFLOWS.parents[1] / "scripts" / "synapse-test.sh").is_file()


def test_the_synapse_job_uses_three_distinct_keys_and_the_script_writes_each_into_the_module():
    """Audit A2-07: login (JWT), speaking grant and push hook each have their own key. With the grant and hook
    unset the script falls back to the JWT key, so a code path that signs with the wrong one would stay green."""
    env = _load("ci.yml")[0]["jobs"]["synapse"]["env"]
    keys = [env.get(k) for k in ("SYNAPSE_TEST_JWT_SECRET", "SYNAPSE_TEST_GRANT_SECRET", "SYNAPSE_TEST_HOOK_SECRET")]
    assert all(keys) and len(set(keys)) == 3, keys
    script = (WORKFLOWS.parents[1] / "scripts" / "synapse-test.sh").read_text()
    assert "${MATRIX_GRANT_SECRET}|${SYNAPSE_TEST_GRANT_SECRET" in script
    assert "${MATRIX_HOOK_SECRET}|${SYNAPSE_TEST_HOOK_SECRET" in script
    conf = (WORKFLOWS.parents[1] / "config" / "synapse" / "homeserver.soulledger.yaml").read_text()
    assert 'grant_secret: "${MATRIX_GRANT_SECRET}"' in conf and 'hook_secret: "${MATRIX_HOOK_SECRET}"' in conf


@pytest.mark.parametrize("job,app", [("mobile", "mobile"), ("officer", "mobile-officer")])
def test_the_app_jobs_run_test_coverage_once_the_app_defines_it(job, app):
    """Review C22: the apps get coverage thresholds through a `test:coverage` script. The step runs it when the
    package defines it and plain `test` otherwise — never neither."""
    (command,) = [r for r in _runs(job) if "package.json" in r]
    assert f"require('./{app}/package.json').scripts['test:coverage'] ? 'test:coverage' : 'test'" in command, command


def test_the_demo_build_is_checked_against_its_recording():
    """演示版答的是录制数据:页面开始读录制里没有的东西时,只有这个 job 会红(用户 2026-11-02)。"""
    job = yaml.safe_load((WORKFLOWS / "ci.yml").read_text(encoding="utf-8"))["jobs"]["e2e-demo"]
    assert job["env"]["NEXT_PUBLIC_DEMO_MODE"] == "1"
    assert any("playwright.demo.config.ts" in step.get("run", "") for step in job["steps"])


def test_the_daily_e2e_still_runs_all_three_engines():
    """Firefox runs only here since 2026-11-12 (user decision): before main, the gates run chromium +
    mobile-chrome (CLAUDE.md, E2E). Dropping firefox from this matrix would leave it run nowhere."""
    data, _ = _load("ci.yml")
    projects = {leg["project"] for leg in data["jobs"]["e2e"]["strategy"]["matrix"]["include"]}
    assert projects == {"chromium", "firefox", "mobile-chrome"}, projects


def test_a_green_main_run_uploads_its_suite_counts_and_only_the_stats_job_may_write_them_back():
    """A10 (2026-11-13): the `stats` job turns the suites' own reports into landing-stats.json's shape, uploads it,
    and (user decision 2026-11-13) commits that one file to main. It is the only job with write access, it touches
    only that file, never forces, and its commit must not count as a change for tomorrow's daily run."""
    data, _ = _load("ci.yml")
    assert data["permissions"] == {"contents": "read"}
    writers = [n for n, j in data["jobs"].items() if "contents" in (j.get("permissions") or {}) and j["permissions"]["contents"] == "write"]
    assert writers == ["stats"], writers
    stats = data["jobs"]["stats"]
    assert stats["permissions"] == {"contents": "write"}
    commit = " ".join(step.get("run", "") for step in stats["steps"])
    assert "git add frontend/src/config/landing-stats.json" in commit and commit.count("git add") == 1
    assert "[skip ci]" in commit and "github-actions[bot]" in commit
    assert "--force" not in commit and "push -f" not in commit and "+HEAD" not in commit
    assert commit.count("git push") == 1 and "git push origin HEAD:main" in commit
    others = " ".join(step.get("run", "") for n, j in data["jobs"].items() if n != "stats" for step in j["steps"])
    assert "git push" not in others and "git commit" not in others
    # the bot commit is not "a commit in the last 24 h"
    check = " ".join(step.get("run", "") for step in data["jobs"]["changes"]["steps"])
    assert "--invert-grep" in check and "skip ci" in check
    assert {"backend", "frontend", "mobile", "officer"} <= set(stats["needs"])
    assert "refs/heads/main" in stats["if"]
    uses = [step.get("uses", "") for step in stats["steps"]]
    assert any(u.startswith("actions/download-artifact@") for u in uses)
    assert any(u.startswith("actions/upload-artifact@") for u in uses)
    # every count the script reads is uploaded by the job that produces it
    artifacts = {(s.get("with") or {}).get("name") for j in data["jobs"].values() for s in j["steps"]}
    assert {"count-backend", "count-web", "count-soul_app", "count-officer_app"} <= artifacts
