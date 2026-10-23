"""
Celery tasks for Disposition app.

The scheduler registers the per-tenant subtask once per active tenant
(apps/scheduler/registry.py). An on-demand run over every tenant is
`manage.py expire_dispositions`; the fan-out task `disposition.expire_due` was
never scheduled and was removed on 2026-10-23. The per-tenant body sets the
tenant contextvar for the duration of the run so apps.audit.signals attributes
the UPDATE rows the expiry writes to this tenant — Celery has no
TenantMiddleware.
"""
from celery import shared_task
from django.utils import timezone


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
