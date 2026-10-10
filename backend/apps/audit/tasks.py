from celery import shared_task


@shared_task(name="audit.prune_logs_for_tenant")
def prune_logs_for_tenant(tenant_id: str):
    """One tenant's audit and login rows past their retention window. Registered in apps/scheduler/registry.py."""
    from apps.audit.retention import prune_logs
    from apps.tenants.managers import clear_current_tenant, set_current_tenant
    from apps.tenants.models import Tenant

    tenant = Tenant.objects.get(id=tenant_id)
    set_current_tenant(tenant)
    try:
        return prune_logs(tenant)
    finally:
        clear_current_tenant()


@shared_task(name="audit.prune_untenanted_logs")
def prune_untenanted_logs():
    """The rows no tenant owns (audit `tenant=NULL`; login rows with no user or a tenant-less one)."""
    from apps.audit.retention import prune_logs

    return prune_logs(None)
