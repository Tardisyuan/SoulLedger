"""
Celery tasks for death sync housekeeping.
"""
from celery import shared_task
from django.utils import timezone


@shared_task(name="death_sync.cleanup_old_requests")
def cleanup_old_requests(days=90, batch_size=1000):
    """
    Fan out one cleanup subtask per active tenant. This is a DELETE, the
    highest-stakes of the four tasks fixed here: unscoped, a single batch
    could straddle several tenants' rows and one tenant generating a large
    backlog would starve others' cleanup within the same batch loop. See
    cleanup_old_requests_for_tenant.
    """
    from apps.tenants.models import Tenant

    tenant_ids = list(Tenant.objects.filter(is_active=True).values_list("id", flat=True))
    total_dispatched = 0
    for tenant_id in tenant_ids:
        cleanup_old_requests_for_tenant.delay(str(tenant_id), days, batch_size)
        total_dispatched += 1

    return {"tenants_dispatched": total_dispatched, "timestamp": timezone.now().isoformat()}


@shared_task(name="death_sync.cleanup_old_requests_for_tenant")
def cleanup_old_requests_for_tenant(tenant_id: str, days=90, batch_size=1000):
    """
    Delete DeathRegistrationRequest records older than N days, for exactly
    one tenant, in batches.
    """
    import time

    from apps.death_sync.models import DeathRegistrationRequest
    from apps.tenants.managers import clear_current_tenant, set_current_tenant
    from apps.tenants.models import Tenant

    tenant = Tenant.objects.get(id=tenant_id)
    # Not load-bearing for the query below — that's the explicit tenant_id=
    # filter two lines down. TenantManager no longer consumes this
    # contextvar for filtering (see apps/tenants/managers.py); it's set
    # here purely so apps.audit.signals can attribute the deletions below
    # to this tenant instead of leaving them tenant-less.
    set_current_tenant(tenant)
    try:
        cutoff = timezone.now() - timezone.timedelta(days=days)
        total_deleted = 0

        while True:
            # Get a batch of IDs to delete, scoped to this tenant
            batch_ids = list(
                DeathRegistrationRequest.objects.filter(
                    tenant_id=tenant_id,
                    request_timestamp__lt=cutoff,
                ).values_list("id", flat=True)[:batch_size]
            )
            if not batch_ids:
                break

            deleted, _ = DeathRegistrationRequest.objects.filter(id__in=batch_ids).delete()
            total_deleted += deleted

            # Brief pause between batches to avoid lock contention
            time.sleep(0.1)

        return {"tenant": tenant.code, "deleted": total_deleted}
    finally:
        clear_current_tenant()
