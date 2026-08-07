"""
Celery tasks for Judgment app.
"""
from datetime import timedelta

from celery import shared_task
from django.utils import timezone


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
    set_current_tenant(tenant)
    try:
        threshold = timezone.now() - timedelta(days=days_threshold)
        stale_judgments = Judgment.objects.filter(
            tenant_id=tenant_id,
            is_final=False,
            verdict__isnull=True,
            created_at__lt=threshold,
        ).select_related("soul")

        flagged = 0
        for judgment in stale_judgments:
            # Log the stale judgment for admin review
            judgment.notes = (judgment.notes or "") + f"\n[SYSTEM] Flagged as stale on {timezone.now().isoformat()}"
            judgment.save(update_fields=["notes"])
            flagged += 1

        return {
            "tenant": tenant.code,
            "flagged": flagged,
            "threshold_days": days_threshold,
            "timestamp": timezone.now().isoformat(),
        }
    finally:
        clear_current_tenant()
