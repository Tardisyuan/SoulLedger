"""
Celery tasks for death sync webhook delivery.
"""
import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(name="death_sync.deliver_webhook", bind=True, max_retries=5)
def deliver_webhook(self, delivery_log_id, tenant_id=None):
    """
    Deliver a webhook payload to a registered endpoint.
    Retry with exponential backoff on failure.

    `tenant_id` is optional (this task's current caller is always
    retry_failed_webhooks_for_tenant, which has already scoped the log to
    one tenant) but is validated when present, refusing a delivery_log_id
    that turns out to belong to another tenant rather than trusting the
    caller.
    """
    from apps.death_sync.models import WebhookDeliveryLog, WebhookDeliveryStatus
    from apps.death_sync.webhook_service import WebhookService

    try:
        delivery_log = WebhookDeliveryLog.objects.select_related("webhook", "registration").get(
            id=delivery_log_id
        )
    except WebhookDeliveryLog.DoesNotExist:
        logger.error(f"Webhook delivery log {delivery_log_id} not found")
        return

    if tenant_id is not None and str(delivery_log.webhook.tenant_id) != str(tenant_id):
        logger.error(f"Webhook delivery log {delivery_log_id} does not belong to tenant {tenant_id}")
        return

    # Skip if already successful
    if delivery_log.status == WebhookDeliveryStatus.SUCCESS:
        return

    # Skip if max retries exceeded
    if delivery_log.attempt >= delivery_log.webhook.max_retries:
        logger.warning(f"Webhook {delivery_log_id} max retries exceeded")
        return

    # Attempt delivery
    result = WebhookService.deliver_webhook(
        webhook=delivery_log.webhook,
        registration=delivery_log.registration,
    )

    if result and result.status == WebhookDeliveryStatus.FAILED:
        # Schedule retry
        WebhookService.schedule_retry(result)
        logger.info(f"Webhook {delivery_log_id} scheduled for retry (attempt {result.attempt})")


@shared_task(name="death_sync.retry_failed_webhooks")
def retry_failed_webhooks():
    """
    Fan out one retry-dispatch subtask per active tenant. WebhookDeliveryLog
    has no direct tenant column (it reaches one transitively through
    `webhook.tenant`), so the per-tenant subtask filters on
    `webhook__tenant_id` — see retry_failed_webhooks_for_tenant.
    """
    from apps.tenants.models import Tenant

    tenant_ids = list(Tenant.objects.filter(is_active=True).values_list("id", flat=True))
    for tenant_id in tenant_ids:
        retry_failed_webhooks_for_tenant.delay(str(tenant_id))

    return {"tenants_dispatched": len(tenant_ids), "timestamp": timezone.now().isoformat()}


@shared_task(name="death_sync.retry_failed_webhooks_for_tenant")
def retry_failed_webhooks_for_tenant(tenant_id: str):
    """
    Retry failed webhook deliveries for exactly one tenant where
    next_retry_at has passed. Uses .iterator() to avoid loading all of a
    tenant's retries into memory.
    """
    from apps.death_sync.models import WebhookDeliveryLog, WebhookDeliveryStatus
    from apps.tenants.managers import clear_current_tenant, set_current_tenant
    from apps.tenants.models import Tenant

    tenant = Tenant.objects.get(id=tenant_id)
    # Not load-bearing for the query below — that's the explicit
    # webhook__tenant_id= filter two lines down. TenantManager no longer
    # consumes this contextvar for filtering (see
    # apps/tenants/managers.py); it's set here purely so
    # apps.audit.signals can attribute any rows this run touches to this
    # tenant instead of leaving them tenant-less.
    set_current_tenant(tenant)
    try:
        now = timezone.now()
        pending_retries = WebhookDeliveryLog.objects.filter(
            webhook__tenant_id=tenant_id,
            status=WebhookDeliveryStatus.RETRYING,
            next_retry_at__lte=now,
        ).select_related("webhook", "registration")

        count = 0
        for delivery_log in pending_retries.iterator(chunk_size=100):
            deliver_webhook.delay(str(delivery_log.id), tenant_id=tenant_id)
            count += 1

        return {"tenant": tenant.code, "dispatched": count}
    finally:
        clear_current_tenant()


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
