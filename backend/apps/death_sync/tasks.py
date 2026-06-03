"""
Celery tasks for death sync webhook delivery.
"""
import logging
from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(name="death_sync.deliver_webhook", bind=True, max_retries=5)
def deliver_webhook(self, delivery_log_id):
    """
    Deliver a webhook payload to a registered endpoint.
    Retry with exponential backoff on failure.
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
    Retry failed webhook deliveries where next_retry_at has passed.
    Runs periodically via Celery Beat.
    Uses .iterator() to avoid loading all retries into memory.
    """
    from apps.death_sync.models import WebhookDeliveryLog, WebhookDeliveryStatus

    now = timezone.now()
    pending_retries = WebhookDeliveryLog.objects.filter(
        status=WebhookDeliveryStatus.RETRYING,
        next_retry_at__lte=now,
    ).select_related("webhook", "registration")

    count = 0
    for delivery_log in pending_retries.iterator(chunk_size=100):
        deliver_webhook.delay(str(delivery_log.id))
        count += 1

    return count


@shared_task(name="death_sync.cleanup_old_requests")
def cleanup_old_requests(days=90, batch_size=1000):
    """
    Delete DeathRegistrationRequest records older than N days in batches.
    Runs weekly via Celery Beat.
    """
    import time
    from apps.death_sync.models import DeathRegistrationRequest

    cutoff = timezone.now() - timezone.timedelta(days=days)
    total_deleted = 0

    while True:
        # Get a batch of IDs to delete
        batch_ids = list(
            DeathRegistrationRequest.objects.filter(
                request_timestamp__lt=cutoff
            ).values_list("id", flat=True)[:batch_size]
        )
        if not batch_ids:
            break

        deleted, _ = DeathRegistrationRequest.objects.filter(id__in=batch_ids).delete()
        total_deleted += deleted

        # Brief pause between batches to avoid lock contention
        time.sleep(0.1)

    return total_deleted
