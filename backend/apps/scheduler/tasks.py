"""This app's own maintenance jobs. Registered in registry.py like any other,
so they get TaskRun rows, the lock, and overdue detection themselves.

`check_overdue` is beat-driven, which means a dead beat also kills the thing
that would report a dead beat. That is why the same computation is exposed on
`/health/detailed/` (apps/core/health.py) for an external probe — this task
covers the other case, a job that beat fires but nothing runs.
"""
from celery import shared_task


@shared_task(name="scheduler.reap_stale_runs")
def reap_stale_runs():
    from apps.scheduler.services import reap_stale_runs as _reap

    return _reap()


@shared_task(name="scheduler.check_overdue")
def check_overdue():
    from apps.scheduler.services import alert_overdue

    return {"alerted": alert_overdue()}


@shared_task(name="scheduler.prune_runs")
def prune_runs():
    from apps.scheduler.services import prune_runs as _prune

    return {"deleted": _prune()}
