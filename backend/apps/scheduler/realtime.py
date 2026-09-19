"""Real-time events for the scheduler page, through the existing event bus.

Contract (what the frontend subscribes to via `onGenericEvent`):

    domain  "scheduler"
    event   "SCHEDULER_RUN_UPDATED"   — a TaskRun changed status (every status,
                                        including LOST set by the reaper)
            payload: job_id (int|null), run_id (int), status, task_name,
                     trigger, tenant_id (int|null), timestamp (ISO-8601)
    event   "SCHEDULER_JOB_UPDATED"   — one ScheduledJob's schedule changed
                                        (PATCH: enabled / cron / timezone)
            payload: job_id, periodic_task_name, enabled (bool),
                     tenant_id (int|null), reason ("patch"), timestamp
    event   "SCHEDULER_JOBS_REBUILT"  — the registry sync ran (rebuild / boot)
            payload: created, updated, removed, legacy_removed, timestamp

Plus one `EventType` member, which is NOT realtime-only:

    event   SCHEDULER_RUN_FAILED      — a *tenant* TaskRun reached FAILURE or
                                        LOST. Same payload as RUN_UPDATED.
            It is published on the same bus as everything above, so it also
            reaches the WebSocket (same group, same gate), and it is the one
            scheduler event `WebhookHandler` is registered for (by type, in
            `configure_default_handlers`) — failures are what a tenant
            integration subscribes to; heartbeats are not. GLOBAL runs never
            emit it: `WebhookHandler` delivers per tenant, and a run that
            belongs to no tenant has no tenant whose webhooks may see it. The
            ADMINs still get the RUN_UPDATED frame.

Delivery is what `WebSocketHandler` does with the envelope, and is also the
authorization: `permission="scheduler.read"` rides on every event, so the
consumer drops it for a socket whose permission set lacks the codename;
tenant rows go to that tenant's group only (`rt_tenant_{code}`), and GLOBAL
rows (tenant NULL) go to the per-user groups of active ADMINs and nowhere
else. The handler defers to `transaction.on_commit` when inside a transaction
and swallows channel-layer failures, so nothing here can fail the caller;
the try/except below covers the bus itself.

The payload is enough to invalidate the jobs/runs queries — not a full row.
"""
import logging

from django.utils import timezone

logger = logging.getLogger(__name__)

DOMAIN = "scheduler"
PERMISSION = "scheduler.read"
RUN_UPDATED = "SCHEDULER_RUN_UPDATED"
JOB_UPDATED = "SCHEDULER_JOB_UPDATED"
JOBS_REBUILT = "SCHEDULER_JOBS_REBUILT"


def _admin_ids() -> list[int]:
    from apps.authentication.models import User

    return list(User.objects.filter(role="ADMIN", is_active=True).values_list("id", flat=True))


def _tenant_code(tenant_id):
    from apps.tenants.models import Tenant

    return Tenant.objects.filter(pk=tenant_id).values_list("code", flat=True).first()


def _publish(event_type: str, payload: dict, tenant_id) -> None:
    from apps.events.event_bus import event_bus

    try:
        if tenant_id is not None:
            code = _tenant_code(tenant_id)
            if code is None:
                return
            event_bus.publish(event_type, payload, DOMAIN, tenant_code=code, permission=PERMISSION)
        else:
            event_bus.publish(event_type, payload, DOMAIN, user_ids=_admin_ids(), permission=PERMISSION)
    except Exception:  # noqa: BLE001 — a push is never worth a failed task or request
        logger.exception("scheduler realtime: could not publish %s", event_type)


#: The statuses that emit SCHEDULER_RUN_FAILED. Both are terminal failures:
#: FAILURE from postrun or a refused enqueue, LOST from the reaper / worker_ready.
FAILED_STATUSES = frozenset({"FAILURE", "LOST"})


def emit_run_updated(run) -> None:
    payload = {
        "job_id": run.job_id,
        "run_id": run.pk,
        "status": run.status,
        "task_name": run.task_name,
        "trigger": run.trigger,
        "tenant_id": run.tenant_id,
        "timestamp": timezone.now().isoformat(),
    }
    _publish(RUN_UPDATED, payload, run.tenant_id)
    if run.status in FAILED_STATUSES and run.tenant_id is not None:
        from apps.events.models import EventType

        _publish(EventType.SCHEDULER_RUN_FAILED.value, payload, run.tenant_id)


def emit_job_updated(job, reason: str = "patch") -> None:
    _publish(
        JOB_UPDATED,
        {
            "job_id": job.pk,
            "periodic_task_name": job.periodic_task.name,
            "enabled": job.periodic_task.enabled,
            "tenant_id": job.tenant_id,
            "reason": reason,
            "timestamp": timezone.now().isoformat(),
        },
        job.tenant_id,
    )


def emit_jobs_rebuilt(stats: dict) -> None:
    """Every active tenant's group, then the ADMINs: a rebuild may have
    touched anyone's rows and the payload carries no per-row detail."""
    from apps.tenants.models import Tenant

    payload = {k: stats.get(k, 0) for k in ("created", "updated", "removed", "legacy_removed")}
    payload["timestamp"] = timezone.now().isoformat()
    for tenant_id in Tenant.objects.filter(is_active=True).values_list("pk", flat=True):
        _publish(JOBS_REBUILT, payload, tenant_id)
    _publish(JOBS_REBUILT, payload, None)
