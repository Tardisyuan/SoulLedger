from celery import shared_task


@shared_task(name="workflow.process_timeouts_for_tenant")
def process_timeouts_for_tenant(tenant_id: str):
    """Fire the due per-node timeouts of exactly one tenant. Scheduled every
    5 minutes per active tenant (apps/scheduler/registry.py); the same body as
    `manage.py process_workflow_timeouts`, which loops over the tenants."""
    from apps.tenants.models import Tenant
    from apps.workflow.timeouts import process_due_for_tenant

    return process_due_for_tenant(Tenant.objects.get(id=tenant_id))
