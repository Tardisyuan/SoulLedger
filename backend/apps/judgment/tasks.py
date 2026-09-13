"""
Celery tasks for Judgment app.
"""
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

STALE_MARKER = "[SYSTEM] Flagged as stale"
STALE_CHUNK = 500


def _flush_stale(chunk):
    from apps.audit.models import AuditAction
    from apps.audit.signals import create_batch_audit_log
    from apps.judgment.models import Judgment

    Judgment.objects.bulk_update(chunk, ["notes"])
    create_batch_audit_log(AuditAction.BATCH_UPDATE, chunk, {"field": "notes", "reason": "stale judgment flag"})
    return len(chunk)


@shared_task(name="judgment.auto_conclude_stale")
def auto_conclude_stale_judgments(days_threshold: int = 30):
    """
    Fan out one flagging subtask per active tenant. Same reasoning as
    ledger.recalculate_all: a single run touching every tenant's stale
    judgments has no fault isolation between tenants and produces
    audit-log rows with no tenant to attribute to. See
    auto_conclude_stale_judgments_for_tenant.
    """
    from apps.tenants.models import Tenant

    tenant_ids = list(Tenant.objects.filter(is_active=True).values_list("id", flat=True))
    for tenant_id in tenant_ids:
        auto_conclude_stale_judgments_for_tenant.delay(str(tenant_id), days_threshold)

    return {
        "tenants_dispatched": len(tenant_ids),
        "threshold_days": days_threshold,
        "timestamp": timezone.now().isoformat(),
    }


@shared_task(name="judgment.auto_conclude_stale_for_tenant")
def auto_conclude_stale_judgments_for_tenant(tenant_id: str, days_threshold: int = 30):
    """
    Flag stale pending judgments for exactly one tenant.
    Pending judgments older than days_threshold without a judge or verdict
    are flagged (not auto-concluded, just logged).
    """
    from apps.judgment.models import Judgment
    from apps.tenants.managers import clear_current_tenant, set_current_tenant
    from apps.tenants.models import Tenant

    tenant = Tenant.objects.get(id=tenant_id)
    # Not load-bearing for the query below — that's the explicit tenant_id=
    # filter two lines down. TenantManager no longer consumes this
    # contextvar for filtering (see apps/tenants/managers.py); it's set
    # here purely so apps.audit.signals can attribute the notes.save()
    # below to this tenant instead of leaving it tenant-less, the same way
    # apps.tenants.middleware does per-request for HTTP.
    set_current_tenant(tenant)
    try:
        now = timezone.now()
        threshold = now - timedelta(days=days_threshold)
        # `.exclude(marker)`: this runs on a schedule, and without it every run
        # appended another flag line to every judgment still stale (BD-14).
        stale_judgments = Judgment.objects.filter(
            tenant_id=tenant_id,
            is_final=False,
            verdict__isnull=True,
            created_at__lt=threshold,
        ).exclude(notes__contains=STALE_MARKER).only("id", "notes")

        # Chunked bulk_update instead of one `.save()` per row (PQ-02). That
        # also skips the per-row post_save audit rows, so each chunk gets one
        # batch audit row instead — same attribution, via the contextvar above.
        stamp = f"\n{STALE_MARKER} on {now.isoformat()}"
        flagged = 0
        chunk = []
        for judgment in stale_judgments.iterator(chunk_size=STALE_CHUNK):
            judgment.notes = (judgment.notes or "") + stamp
            chunk.append(judgment)
            if len(chunk) == STALE_CHUNK:
                flagged += _flush_stale(chunk)
                chunk = []
        if chunk:
            flagged += _flush_stale(chunk)

        return {
            "tenant": tenant.code,
            "flagged": flagged,
            "threshold_days": days_threshold,
            "timestamp": timezone.now().isoformat(),
        }
    finally:
        clear_current_tenant()
