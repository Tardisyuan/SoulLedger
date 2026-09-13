"""
Celery tasks for Ledger app.

The `name=` strings are explicit and decoupled from this module's path, so
renaming the app would not have renamed them — but a stored schedule points at
a task *name*, and django_celery_beat happily keeps dispatching to a name
nothing answers to, silently. Renaming these is therefore a data change, not
just a code change; ledger/migrations/0001 rewrites the PeriodicTask rows that
setup_ledger_tasks wrote.
"""
from celery import shared_task
from django.utils import timezone


@shared_task(name="ledger.recalculate_all")
def recalculate_all_ledgers():
    """
    Fan out one recalculation subtask per active tenant, rather than
    iterating every soul in a single run. Celery has no per-request tenant
    context the way HTTP does (TenantMiddleware never runs here), so a
    task that just does `Soul.objects.iterator()` touches every tenant's
    data in one execution: a failure or retry affects tenants that had
    nothing to do with it, and every audit-log row this produces has no
    tenant to attribute to (apps.audit.signals reads
    apps.tenants.managers.get_current_tenant(), which stays None for the
    whole run). Dispatching one subtask per tenant fixes both — see
    recalculate_tenant_ledgers.
    """
    from apps.tenants.models import Tenant

    tenant_ids = list(Tenant.objects.filter(is_active=True).values_list("id", flat=True))
    for tenant_id in tenant_ids:
        recalculate_tenant_ledgers.delay(str(tenant_id))

    return {"tenants_dispatched": len(tenant_ids), "timestamp": timezone.now().isoformat()}


@shared_task(name="ledger.recalculate_tenant")
def recalculate_tenant_ledgers(tenant_id: str):
    """
    Recalculate the ledger for every soul belonging to exactly one tenant.

    Sets the tenant contextvar for the duration of the run so that
    apps.audit.signals attributes the resulting audit-log rows to this
    tenant instead of leaving them tenant-less — the same contextvar
    apps.tenants.middleware sets per-request for HTTP, since Celery has no
    equivalent of its own.
    """
    from apps.ledger.services import LedgerService
    from apps.souls.models import Soul
    from apps.tenants.managers import clear_current_tenant, set_current_tenant
    from apps.tenants.models import Tenant

    tenant = Tenant.objects.get(id=tenant_id)
    set_current_tenant(tenant)
    try:
        updated = 0
        for soul in Soul.objects.filter(tenant_id=tenant_id).iterator(chunk_size=500):
            LedgerService.recalculate_soul_ledger(soul)
            updated += 1
        return {"tenant": tenant.code, "updated": updated, "timestamp": timezone.now().isoformat()}
    finally:
        clear_current_tenant()

# `recalculate_soul_ledger_task` (celery name `ledger.recalculate_single`)
# lived here — deleted 2026-09-13 (DB-03). Its own docstring said "this task
# has no current caller"; grepping the tree confirmed it, and no
# `setup_ledger_tasks`/PeriodicTask schedule ever pointed at
# `ledger.recalculate_single` either (only `ledger.recalculate_all` is
# scheduled). `LedgerService.recalculate_soul_ledger` — the logic this task
# only wrapped — is unaffected and is still what `recalculate_tenant_ledgers`
# above calls per soul.
