from celery import shared_task


@shared_task(name="workflow.process_timeouts_for_tenant")
def process_timeouts_for_tenant(tenant_id: str):
    """Fire the due per-node timeouts of exactly one tenant. Scheduled every
    5 minutes per active tenant (apps/scheduler/registry.py); the same body as
    `manage.py process_workflow_timeouts`, which loops over the tenants."""
    from apps.tenants.models import Tenant
    from apps.workflow.timeouts import process_due_for_tenant

    return process_due_for_tenant(Tenant.objects.get(id=tenant_id))


@shared_task(name="workflow.pick_reminders_for_tenant")
def pick_reminders_for_tenant(tenant_id: str):
    """第四十三批:本殿发起、停在外域门口等选站的流程 —— 每天提醒那个域一次,满 3 天告诉本殿管理员一次
    (`apps/workflow/segments.py::remind_due`)。每天一次,每个活跃租户一行(apps/scheduler/registry.py)。"""
    from apps.tenants.managers import clear_current_tenant, set_current_tenant
    from apps.tenants.models import Tenant
    from apps.workflow.segments import remind_due

    tenant = Tenant.objects.get(id=tenant_id)
    set_current_tenant(tenant)
    try:
        return remind_due(tenant)
    finally:
        clear_current_tenant()
