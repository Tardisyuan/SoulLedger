"""Everything the scheduler does that is not a view or a signal receiver.

Sections: schedule sync (registry → PeriodicTask/ScheduledJob rows), the
single-flight lock, manual triggering, health (next run / overdue), alerting,
and the two recovery passes (reap stuck runs, prune old ones).
"""
import json
import logging
import uuid
from collections import Counter
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django_celery_beat.models import CrontabSchedule, PeriodicTask, PeriodicTasks

from apps.scheduler import registry
from apps.scheduler.models import (
    OPEN_STATUSES,
    RunStatus,
    RunTrigger,
    ScheduledJob,
    TaskRun,
)

logger = logging.getLogger(__name__)


def _setting(name: str, default):
    return getattr(settings, name, default)


# ---------------------------------------------------------------------------
# Schedule sync
# ---------------------------------------------------------------------------

def default_schedule(spec: registry.JobSpec) -> CrontabSchedule:
    schedule, _ = CrontabSchedule.objects.get_or_create(**spec.cron_fields(), timezone=spec.timezone)
    return schedule


def _ensure_job(spec: registry.JobSpec, tenant, *, reset: bool, stats: Counter) -> str:
    """Make the (spec, tenant) row exist and point at the right task/kwargs.

    Task name and kwargs always follow the registry. `enabled`, `crontab` and
    the schedule's timezone are the operator's, and are only touched when the
    row is new, when `reset` is asked for, or when the row has no crontab at
    all (a PeriodicTask must carry exactly one schedule type).
    """
    name = spec.periodic_task_name(tenant)
    wanted = {
        "task": spec.task,
        "kwargs": json.dumps(spec.task_kwargs(tenant), sort_keys=True),
        "args": "[]",
        "interval": None,
        "solar": None,
        "clocked": None,
        "one_off": False,
        "description": f"managed by setup_scheduled_tasks ({spec.key})",
    }
    task = PeriodicTask.objects.filter(name=name).first()
    if task is None:
        task = PeriodicTask.objects.create(name=name, crontab=default_schedule(spec), enabled=True, **wanted)
        stats["created"] += 1
    else:
        changed = False
        for field_name, value in wanted.items():
            if getattr(task, field_name) != value:
                setattr(task, field_name, value)
                changed = True
        if reset:
            task.crontab = default_schedule(spec)
            task.enabled = True
            changed = True
        elif task.crontab_id is None:
            task.crontab = default_schedule(spec)
            changed = True
        if changed:
            task.save()
            stats["updated"] += 1

    tenant_id = tenant.pk if tenant is not None else None
    job, created = ScheduledJob.objects.get_or_create(
        periodic_task=task, defaults={"job_key": spec.key, "tenant_id": tenant_id}
    )
    if not created and (job.job_key != spec.key or job.tenant_id != tenant_id):
        job.job_key, job.tenant_id = spec.key, tenant_id
        job.save(update_fields=["job_key", "tenant_id"])
    return name


def _active_tenants():
    from apps.tenants.models import Tenant

    return list(Tenant.objects.filter(is_active=True))


@transaction.atomic
def sync_schedules(*, reset: bool = False) -> dict:
    """Idempotent: registry × active tenants → rows; everything else ours → gone.

    Removes (a) ScheduledJob rows whose (key, tenant) is no longer wanted —
    the key left the registry or the tenant was deactivated — together with
    their PeriodicTask, and (b) any PeriodicTask whose `task` is one of the
    old fan-out parents (registry.LEGACY_TASKS), whatever it is named.
    PeriodicTask rows this app never owned (no ScheduledJob) are left alone.
    """
    stats: Counter = Counter()
    wanted: set[str] = set()
    tenants = _active_tenants()
    for spec in registry.REGISTRY:
        targets = tenants if spec.scope == registry.TENANT else [None]
        for tenant in targets:
            wanted.add(_ensure_job(spec, tenant, reset=reset, stats=stats))

    stale = ScheduledJob.objects.exclude(periodic_task__name__in=wanted).select_related("periodic_task")
    for job in stale:
        job.periodic_task.delete()  # cascades to the job
        stats["removed"] += 1

    legacy = PeriodicTask.objects.filter(task__in=registry.LEGACY_TASKS)
    stats["legacy_removed"] += legacy.count()
    legacy.delete()

    # The per-row saves/deletes above already bump PeriodicTasks.last_update
    # through django_celery_beat's own signals; this makes the bulk path
    # explicit so beat notices even if that wiring changes.
    PeriodicTasks.update_changed()
    return dict(stats)


def sync_tenant(tenant) -> dict:
    """Rows for exactly one tenant: created if it is active, removed if not."""
    stats: Counter = Counter()
    if tenant.is_active and not getattr(tenant, "is_deleted", False):
        for spec in registry.tenant_specs():
            _ensure_job(spec, tenant, reset=False, stats=stats)
    else:
        for job in ScheduledJob.objects.filter(tenant=tenant).select_related("periodic_task"):
            job.periodic_task.delete()
            stats["removed"] += 1
    PeriodicTasks.update_changed()
    return dict(stats)


# ---------------------------------------------------------------------------
# Single-flight lock
# ---------------------------------------------------------------------------

LOCK_PREFIX = "scheduler:lock:"


def lock_key(job_key: str, tenant_id) -> str:
    return f"{LOCK_PREFIX}{job_key}:{tenant_id if tenant_id is not None else 'global'}"


def acquire_lock(key: str, owner: str, ttl: int) -> bool:
    """`cache.add` is SET NX EX on the Redis backend — atomic, expiring.

    Fail-open when the cache is unreachable: the lock guards against overlap,
    and refusing every run while Redis is down would trade a rare double-run
    for a certain outage — and Redis is also the broker, so nothing reaches
    here in that state anyway.
    """
    try:
        return bool(cache.add(key, owner, timeout=ttl))
    except Exception:  # noqa: BLE001
        logger.exception("scheduler: lock %s unavailable, running unlocked", key)
        return True


def release_lock(key: str, owner: str) -> None:
    # ponytail: get-then-delete is not atomic; the window is a lock that just
    # expired and was re-taken by the next run in the same millisecond. A Lua
    # compare-and-delete closes it if that ever matters.
    try:
        if cache.get(key) == owner:
            cache.delete(key)
    except Exception:  # noqa: BLE001
        logger.exception("scheduler: could not release lock %s", key)


def lock_holder(key: str):
    try:
        return cache.get(key)
    except Exception:  # noqa: BLE001
        logger.exception("scheduler: could not read lock %s", key)
        return None


# ---------------------------------------------------------------------------
# Resolving a celery call to a job
# ---------------------------------------------------------------------------

def tenant_id_from_call(spec: registry.JobSpec, args, kwargs):
    if spec.scope != registry.TENANT:
        return None
    tenant_id = (kwargs or {}).get("tenant_id")
    if tenant_id is None and args:
        tenant_id = args[0]
    return str(tenant_id) if tenant_id is not None else None


def resolve_job(task_name: str, args, kwargs):
    """(spec, tenant_id, job-or-None) for a registered task, else None."""
    spec = registry.get(task_name)
    if spec is None:
        return None
    tenant_id = tenant_id_from_call(spec, args, kwargs)
    job = ScheduledJob.objects.filter(job_key=spec.key, tenant_id=tenant_id).select_related("tenant").first()
    return spec, tenant_id, job


# ---------------------------------------------------------------------------
# Manual trigger
# ---------------------------------------------------------------------------

class JobLockedError(Exception):
    """A run of this (job, tenant) holds the single-flight lock right now."""


class EnqueueFailedError(Exception):
    """The broker refused the message; the PENDING row was marked FAILURE."""


def trigger_manual(job: ScheduledJob, user) -> TaskRun:
    from config.celery import app as celery_app

    spec = job.spec
    if spec is None:
        raise ValueError(f"{job.job_key} is not in the registry")
    if lock_holder(lock_key(job.job_key, job.tenant_id)) is not None:
        raise JobLockedError(job.periodic_task.name)

    run = TaskRun.objects.create(
        job=job,
        task_name=spec.task,
        celery_task_id=str(uuid.uuid4()),
        tenant=job.tenant,
        trigger=RunTrigger.MANUAL,
        triggered_by=user,
        status=RunStatus.PENDING,
    )
    try:
        celery_app.send_task(
            spec.task,
            kwargs=spec.task_kwargs(job.tenant),
            task_id=run.celery_task_id,
            headers={"scheduler_trigger": RunTrigger.MANUAL},
        )
    except Exception as exc:  # noqa: BLE001
        run.finish(RunStatus.FAILURE, error=f"enqueue failed: {type(exc).__name__}: {exc}")
        raise EnqueueFailedError(str(exc)) from exc
    return run


# ---------------------------------------------------------------------------
# Health: next run and overdue
# ---------------------------------------------------------------------------

def next_fire_after(periodic_task: PeriodicTask, reference):
    """The first time this row's schedule fires strictly after `reference`.

    Uses celery's *parsed* crontab (the `minute` / `hour` / `day_of_week` /
    `day_of_month` / `month_of_year` sets on the TzAwareCrontab, so "*/5" and
    "1-5" mean what beat thinks they mean) but NOT `crontab.remaining_delta`.
    That method decides "is there a later slot this hour / today" by comparing
    the reference's date with *its own* `now()`, because beat only ever calls
    it with a reference a few seconds old. Called with yesterday's last run at
    23:10 against `40 23 * * *`, it answers tomorrow 23:40 — measured
    2026-09-17 when the full suite ran at 23:5x Asia/Shanghai and the tz test
    went red. A day-by-day search over the parsed sets has no such assumption.

    Bounded: 367 days is enough for any month/day-of-month combination that
    exists; a cron that never matches (e.g. Feb 30) returns None.
    """
    if periodic_task.crontab_id is not None:
        schedule = periodic_task.crontab.schedule
        tz = getattr(schedule, "tz", None) or ZoneInfo("UTC")
        local = reference.astimezone(tz)
        hours, minutes = sorted(schedule.hour), sorted(schedule.minute)
        for day_offset in range(367):
            day = local.date() + timedelta(days=day_offset)
            if (
                day.month not in schedule.month_of_year
                or day.day not in schedule.day_of_month
                or (day.isoweekday() % 7) not in schedule.day_of_week  # celery: Sunday == 0
            ):
                continue
            for hour in hours:
                for minute in minutes:
                    candidate = datetime(day.year, day.month, day.day, hour, minute, tzinfo=tz)
                    if candidate > local:
                        return candidate.astimezone(ZoneInfo("UTC"))
        return None
    if periodic_task.interval_id is not None:
        return reference + periodic_task.interval.schedule.run_every
    return None


def job_health(job: ScheduledJob, now=None) -> dict:
    """next_run_at, last_run, overdue, expected_at — the read-time computation.

    Overdue means: the schedule should have fired after the last evidence we
    have, plus a grace period, and no run appeared. Evidence is the newest of
    the last TaskRun's queued_at, the PeriodicTask's date_changed (an operator
    re-enabling a job re-arms the clock instead of inheriting the whole time
    it was off) and the job's own creation. Disabled jobs are never overdue.
    """
    now = now or timezone.now()
    pt = job.periodic_task
    last_run = job.runs.order_by("-queued_at").first()
    beat_reference = pt.last_run_at or pt.date_changed or job.created_at
    next_run_at = next_fire_after(pt, beat_reference) if pt.enabled else None

    overdue, expected_at = False, None
    if pt.enabled:
        evidence = [job.created_at, pt.date_changed, last_run.queued_at if last_run else None]
        reference = max(t for t in evidence if t is not None)
        expected_at = next_fire_after(pt, reference)
        grace = timedelta(seconds=_setting("SCHEDULER_OVERDUE_GRACE_SECONDS", 600))
        overdue = expected_at is not None and now > expected_at + grace
    return {"next_run_at": next_run_at, "last_run": last_run, "overdue": overdue, "expected_at": expected_at}


def overdue_jobs(now=None) -> list[ScheduledJob]:
    now = now or timezone.now()
    jobs = ScheduledJob.objects.filter(periodic_task__enabled=True).select_related("periodic_task", "tenant")
    return [job for job in jobs if job_health(job, now)["overdue"]]


# ---------------------------------------------------------------------------
# Alerting
# ---------------------------------------------------------------------------

def alert_recipients(job: ScheduledJob):
    """Every active ADMIN, plus the job's tenant's users who hold scheduler.manage."""
    from apps.authentication.models import User
    from apps.perm.checker import check_permission

    users = list(User.objects.filter(role="ADMIN", is_active=True))
    if job.tenant_id is not None:
        for user in User.objects.filter(tenant_id=job.tenant_id, is_active=True).exclude(role="ADMIN"):
            if check_permission(user, "scheduler.manage"):
                users.append(user)
    return users


def _notify(job: ScheduledJob, title: str, message: str) -> None:
    from apps.notifications.models import notify_user

    for user in alert_recipients(job):
        notify_user(user, title=title, message=message, related_resource="scheduler", related_id=str(job.pk))


def record_final_status(run: TaskRun) -> None:
    """Failure counter and the success→failure edge alert. Called from postrun.

    Alerts once per episode: on the transition from 0 to 1 consecutive
    failures. A job failing every 5 minutes therefore produces one
    notification, not 288 a day; the counter on the row shows how long it has
    been going on. Recovery resets the counter silently.
    """
    job = run.job
    if job is None:
        return
    if run.status == RunStatus.FAILURE:
        was_healthy = job.consecutive_failures == 0
        job.consecutive_failures += 1
        fields = ["consecutive_failures"]
        if was_healthy:
            job.last_alerted_at = timezone.now()
            fields.append("last_alerted_at")
        job.save(update_fields=fields)
        if was_healthy:
            _notify(
                job,
                title=f"Scheduled task failed: {job.periodic_task.name}",
                message=(run.error or "no error detail")[:500],
            )
    elif run.status == RunStatus.SUCCESS and job.consecutive_failures:
        job.consecutive_failures = 0
        job.save(update_fields=["consecutive_failures"])


def alert_overdue(now=None) -> int:
    """Notify once per overdue episode; clear the marker when the job runs again."""
    now = now or timezone.now()
    alerted = 0
    for job in ScheduledJob.objects.filter(periodic_task__enabled=True).select_related("periodic_task", "tenant"):
        health = job_health(job, now)
        if health["overdue"]:
            if job.overdue_alerted_at is None:
                job.overdue_alerted_at = now
                job.save(update_fields=["overdue_alerted_at"])
                _notify(
                    job,
                    title=f"Scheduled task did not run: {job.periodic_task.name}",
                    message=f"expected at {health['expected_at'].isoformat()}, no run recorded since",
                )
                alerted += 1
        elif job.overdue_alerted_at is not None:
            job.overdue_alerted_at = None
            job.save(update_fields=["overdue_alerted_at"])
    return alerted


# ---------------------------------------------------------------------------
# Recovery: reap and prune
# ---------------------------------------------------------------------------

def mark_lost_for_worker(hostname: str) -> int:
    """worker_ready: whatever this hostname left RUNNING died with the old process."""
    lost = 0
    for run in TaskRun.objects.filter(status=RunStatus.RUNNING, worker_hostname=hostname):
        run.finish(RunStatus.LOST, error=f"worker {hostname} restarted before this run finished")
        lost += 1
    if lost:
        logger.warning("scheduler: %s run(s) marked LOST on worker_ready of %s", lost, hostname)
    return lost


def reap_stale_runs(now=None) -> dict:
    """RUNNING past max_runtime → LOST; PENDING never picked up → LOST.

    A SIGKILLed worker sends no signal at all, so worker_ready alone cannot
    cover a worker that never comes back — this pass is the floor. Per-job
    max_runtime comes from the registry (600s when the job is unknown).
    """
    now = now or timezone.now()
    stats: Counter = Counter()
    for run in TaskRun.objects.filter(status=RunStatus.RUNNING).select_related("job"):
        limit = run.job.max_runtime if run.job else 600
        if run.started_at and now - run.started_at > timedelta(seconds=limit):
            run.finish(RunStatus.LOST, error=f"still RUNNING after max_runtime={limit}s; presumed dead")
            stats["running_lost"] += 1
    grace = timedelta(seconds=_setting("SCHEDULER_PENDING_GRACE_SECONDS", 900))
    for run in TaskRun.objects.filter(status=RunStatus.PENDING, queued_at__lt=now - grace):
        run.finish(RunStatus.LOST, error=f"never picked up by a worker within {grace.total_seconds():.0f}s")
        stats["pending_lost"] += 1
    return dict(stats)


def prune_runs(now=None, *, batch_size: int = 1000) -> int:
    """Delete finished runs older than the retention window, keeping the newest
    M per job so a monthly job's history is not emptied by a daily sweep.

    FAILURE and LOST runs have their own, longer window
    (SCHEDULER_FAILED_RUN_RETENTION_DAYS): the failures are what someone comes
    back to look for, and they are a small fraction of the table.

    Open rows (PENDING/RUNNING/RETRY) are the reaper's business and are never
    pruned. Rows whose job is gone (SET_NULL) have no floor to keep.
    """
    now = now or timezone.now()
    cutoff = now - timedelta(days=_setting("SCHEDULER_RUN_RETENTION_DAYS", 30))
    failed_cutoff = now - timedelta(days=_setting("SCHEDULER_FAILED_RUN_RETENTION_DAYS", 365))
    keep = _setting("SCHEDULER_RUN_KEEP_MIN", 20)
    failed = (RunStatus.FAILURE, RunStatus.LOST)
    other_closed = [s for s in RunStatus.values if s not in OPEN_STATUSES and s not in failed]
    expired = TaskRun.objects.filter(
        Q(status__in=other_closed, queued_at__lt=cutoff) | Q(status__in=failed, queued_at__lt=failed_cutoff)
    )
    deleted = 0
    job_ids = list(expired.values_list("job_id", flat=True).distinct())
    for job_id in job_ids:
        candidates = expired.filter(job_id=job_id)
        if job_id is not None:
            newest = TaskRun.objects.filter(job_id=job_id).order_by("-queued_at").values_list("pk", flat=True)[:keep]
            candidates = candidates.exclude(pk__in=list(newest))
        while True:
            batch = list(candidates.order_by("queued_at").values_list("pk", flat=True)[:batch_size])
            if not batch:
                break
            count, _ = TaskRun.objects.filter(pk__in=batch).delete()
            deleted += count
    return deleted
