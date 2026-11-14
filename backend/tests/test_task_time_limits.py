"""Per-task Celery time limits (user decision 2026-11-14).

Global: 300 s soft / 360 s hard (config/settings.py). Every scheduled job overrides it with limits derived from
its registry `max_runtime` (`apps/scheduler/registry.py::time_limits`: hard = max_runtime, soft = max_runtime − 60),
so a job is never killed before the scheduler stops vouching for it, nor left running after its run is marked
LOST and its single-flight lock expires. A registered job whose decorator forgets `**time_limits(key)` is red here.

What this cannot notice: a long task that is NOT in the registry (on-demand tasks such as an export or an eval
run) and has no override. Nothing in the code says how long such a task may take, so there is nothing to derive
from; each such override is listed in EXPLICIT with its reason, and any override not listed is red, so the list
stays the one place to read them.
"""
import importlib
from pathlib import Path

import pytest

from apps.scheduler import registry

BACKEND = Path(__file__).resolve().parents[1]

#: Non-registry tasks with their own limits: name -> (soft, hard, reason).
EXPLICIT = {
    "soul_assist.run_eval": (3600, 3660, "candidates × cases asks, each up to ASSISTANT_TIMEOUT_SECONDS"),
}


def _tasks():
    for path in (BACKEND / "apps").rglob("*.py"):
        rel = path.relative_to(BACKEND)
        if "tests" in rel.parts or "migrations" in rel.parts:
            continue
        if "@shared_task" in path.read_text(encoding="utf-8"):
            importlib.import_module(".".join(rel.with_suffix("").parts))
    from config.celery import app

    return {name: task for name, task in app.tasks.items() if not name.startswith("celery.")}


def test_every_registered_job_has_limits_derived_from_its_max_runtime():
    tasks = _tasks()
    wrong = {}
    for spec in registry.REGISTRY:
        task = tasks.get(spec.key)
        assert task is not None, f"{spec.key}: registered but no Celery task answers to it"
        want = (spec.max_runtime - registry.SOFT_LIMIT_MARGIN, spec.max_runtime)
        got = (task.soft_time_limit, task.time_limit)
        if got != want:
            wrong[spec.key] = got
    # Add `**time_limits("<key>")` to the task's @shared_task decorator.
    assert wrong == {}


def test_overrides_outside_the_registry_are_the_listed_ones():
    registered = {spec.key for spec in registry.REGISTRY}
    overridden = {
        name: (task.soft_time_limit, task.time_limit)
        for name, task in _tasks().items()
        if name not in registered and (task.soft_time_limit or task.time_limit)
    }
    assert overridden == {name: (soft, hard) for name, (soft, hard, _) in EXPLICIT.items()}


def test_limits_leave_room_for_the_soft_limit_and_reject_unknown_jobs():
    for spec in registry.REGISTRY:
        assert spec.max_runtime > registry.SOFT_LIMIT_MARGIN, spec.key
    with pytest.raises(KeyError):
        registry.time_limits("no.such.job")


def test_the_daily_ledger_recalculation_has_room_for_a_large_hall():
    # be-scale 1.2: ~5 ms a soul; one hall of ~720k souls passes 3600 s.
    assert registry.get("ledger.recalculate_tenant").max_runtime >= 7200
