"""
Celery tasks for Disposition app.

Same shape as `ledger.recalculate_*` and `judgment.auto_conclude_stale*`: the
scheduler registers the per-tenant subtask once per active tenant
(apps/scheduler/registry.py), and the fan-out parent exists for an on-demand
run over every tenant. The per-tenant body sets the tenant contextvar for the
duration of the run so apps.audit.signals attributes the UPDATE rows the
expiry writes to this tenant — Celery has no TenantMiddleware.
"""
from celery import shared_task
from django.utils import timezone


@shared_task(name="disposition.expire_due")
def expire_due_dispositions():
    """Fan out one expiry subtask per active tenant. Not scheduled itself —
    the registry schedules the per-tenant subtask; see module docstring."""
    from apps.tenants.models import Tenant

    tenant_ids = list(Tenant.objects.filter(is_active=True).values_list("id", flat=True))
    for tenant_id in tenant_ids:
        expire_due_dispositions_for_tenant.delay(tenant_id=str(tenant_id))

    return {"tenants_dispatched": len(tenant_ids), "timestamp": timezone.now().isoformat()}


@shared_task(name="disposition.expire_due_for_tenant")
def expire_due_dispositions_for_tenant(tenant_id: str):
    """Mark every disposition of exactly one tenant whose term has ended.

    Idempotent — see apps.disposition.expiry.expire_for_tenant."""
    from apps.disposition.expiry import expire_for_tenant
    from apps.tenants.managers import clear_current_tenant, set_current_tenant
    from apps.tenants.models import Tenant

    tenant = Tenant.objects.get(id=tenant_id)
    set_current_tenant(tenant)
    try:
        return {**expire_for_tenant(tenant), "timestamp": timezone.now().isoformat()}
    finally:
        clear_current_tenant()
