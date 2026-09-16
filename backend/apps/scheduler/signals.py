"""Celery lifecycle → TaskRun rows; Tenant lifecycle → schedule rows.

EVERY RECEIVER HERE IS WRAPPED. Celery already logs and swallows exceptions
raised by signal receivers (celery.utils.dispatch.Signal.send), so a broken
receiver cannot fail the task — but "already" is a property of the library,
not of this code, and the `_safe` decorator makes the contract local: a
bookkeeping error is a log line, never a task outcome.

Header lookup handles both shapes celery produces: a real worker flattens
custom headers into `task.request` (protocol 2), while `Task.apply()` — the
eager path tests drive — leaves them nested under `request.headers`.
"""
import functools
import logging

from celery import signals as celery_signals
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from apps.scheduler import services
from apps.scheduler.models import FINAL_STATUSES, RunStatus, RunTrigger, TaskRun

logger = logging.getLogger(__name__)


def _safe(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception:  # noqa: BLE001 — see module docstring
            logger.exception("scheduler: %s failed; task outcome unaffected", fn.__name__)

    return wrapper


def _header(request, name):
    value = request.get(name) if hasattr(request, "get") else getattr(request, name, None)
    if value is None:
        nested = (request.get("headers") if hasattr(request, "get") else getattr(request, "headers", None)) or {}
        value = nested.get(name)
    return value


def _trigger_from(request) -> str:
    if _header(request, "scheduler_trigger") == RunTrigger.MANUAL:
        return RunTrigger.MANUAL
    return RunTrigger.SCHEDULE


# ---------------------------------------------------------------------------
# Publish (beat process, or the API's manual trigger): PENDING
# ---------------------------------------------------------------------------

@celery_signals.before_task_publish.connect
@_safe
def on_before_publish(sender=None, headers=None, body=None, **_):
    """A PENDING row from the publishing side, so "the broker lost it" is
    detectable: a row that stays PENDING past the grace is what the reaper
    marks LOST. Only beat-dispatched messages (they carry
    `periodic_task_name`); the manual API already wrote its row, and
    get_or_create makes this a no-op for it."""
    headers = headers or {}
    if not headers.get("periodic_task_name"):
        return
    kwargs = body[1] if isinstance(body, list | tuple) and len(body) > 1 else {}
    resolved = services.resolve_job(sender, (), kwargs or {})
    if resolved is None:
        return
    spec, tenant_id, job = resolved
    TaskRun.objects.get_or_create(
        celery_task_id=str(headers["id"]),
        defaults={
            "job": job,
            "task_name": spec.task,
            "tenant_id": tenant_id,
            "trigger": RunTrigger.SCHEDULE,
            "status": RunStatus.PENDING,
        },
    )


# ---------------------------------------------------------------------------
# Worker: RUNNING → SUCCESS / FAILURE / RETRY
# ---------------------------------------------------------------------------

@celery_signals.task_prerun.connect
@_safe
def on_prerun(sender=None, task_id=None, task=None, args=None, kwargs=None, **_):
    resolved = services.resolve_job(sender.name, args or (), kwargs or {})
    if resolved is None:
        return
    spec, tenant_id, job = resolved
    request = task.request
    run, _ = TaskRun.objects.get_or_create(
        celery_task_id=str(task_id),
        defaults={
            "job": job,
            "task_name": spec.task,
            "tenant_id": tenant_id,
            "trigger": _trigger_from(request),
        },
    )
    if run.status in FINAL_STATUSES:
        return
    run.status = RunStatus.RUNNING
    # A retry re-enters prerun with the same task_id; the first start stands.
    run.started_at = run.started_at or timezone.now()
    run.worker_hostname = (request.get("hostname") if hasattr(request, "get") else None) or ""
    run.save(update_fields=["status", "started_at", "worker_hostname"])


@celery_signals.task_failure.connect
@_safe
def on_failure(sender=None, task_id=None, exception=None, einfo=None, **_):
    """Traceback tail onto the row. postrun (below) sets the status; this only
    adds the detail the UI's "expand error" wants, so the two are idempotent
    in either order."""
    run = TaskRun.objects.filter(celery_task_id=str(task_id)).first()
    if run is None or run.status in FINAL_STATUSES:
        return
    text = f"{type(exception).__name__}: {exception}"
    if einfo is not None:
        text += "\n" + str(einfo.traceback)[-3000:]
    run.error = text[:4000]
    run.save(update_fields=["error"])


@celery_signals.task_postrun.connect
@_safe
def on_postrun(sender=None, task_id=None, retval=None, state=None, **_):
    run = TaskRun.objects.filter(celery_task_id=str(task_id)).select_related("job", "job__periodic_task").first()
    if run is None or run.status in FINAL_STATUSES:
        return
    if state == "RETRY":
        run.status = RunStatus.RETRY
        run.save(update_fields=["status"])
        return
    if state == "FAILURE":
        run.finish(RunStatus.FAILURE, error=run.error or f"{type(retval).__name__}: {retval}")
    else:
        # Anything celery reports as done and not failed: SUCCESS, and the
        # rare IGNORED/REJECTED which have no better home here.
        run.finish(RunStatus.SUCCESS, result="" if retval is None else str(retval))
    services.record_final_status(run)


# ---------------------------------------------------------------------------
# Worker restart: what this hostname left RUNNING is gone
# ---------------------------------------------------------------------------

@celery_signals.worker_ready.connect
@_safe
def on_worker_ready(sender=None, **_):
    hostname = getattr(sender, "hostname", None)
    if hostname:
        services.mark_lost_for_worker(hostname)


# ---------------------------------------------------------------------------
# Tenants
# ---------------------------------------------------------------------------

@receiver(post_save, sender="tenants.Tenant", dispatch_uid="scheduler_tenant_sync")
def on_tenant_saved(sender, instance, raw=False, **_):
    """A new or (de)activated tenant gets its per-tenant rows without waiting
    for the next boot. Failure is logged, not raised: the boot command
    re-syncs everything, and a tenant save must not fail on beat bookkeeping."""
    if raw:
        return
    try:
        services.sync_tenant(instance)
    except Exception:  # noqa: BLE001
        logger.exception("scheduler: could not sync schedule rows for tenant %s", instance.pk)
