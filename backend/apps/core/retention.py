"""Retention for the high-volume operational tables that nothing else ever cleans.

Each window is a setting (config/settings.py, next to the audit ones); 0 = keep, the sweep skips that table.

What is deliberately NOT here:
  * `SoulEvent` -- the event log is part of the business record (CLAUDE.md, 2026-10-10): never pruned.
  * soft-deleted business records and uploaded attachments / images -- other lifecycle, out of scope.
  * unread `UserNotification` -- an unread notice is still an open item for someone; only read ones age out.
  * `PENDING` webhook deliveries -- `events.retry_pending_webhooks` still owns them.
  * `QUEUED` / `SENDING` push deliveries -- the push sweep owns them.

Deletes are `_raw_delete` in batches (see apps/audit/retention.py: `.delete()` would write an audit row per
row for the audited models). `_raw_delete` does not cascade, so children are removed first, by hand.
None of these tables has a tenant column the sweep could fan out on; the job is GLOBAL.
"""
import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.audit.retention import BATCH_SIZE, _days, _purge

logger = logging.getLogger(__name__)


def _purge_with_children(queryset, children, batch_size):
    """`_purge` for a parent whose children `_raw_delete` would orphan: `children(pks)` yields their querysets."""
    deleted = 0
    while True:
        pks = list(queryset.order_by("pk").values_list("pk", flat=True)[:batch_size])
        if not pks:
            return deleted
        with transaction.atomic():
            for child in children(pks):
                child._raw_delete(child.db)
            deleted += queryset.filter(pk__in=pks)._raw_delete(queryset.db)


def prune_retained_data(*, now=None, batch_size: int = BATCH_SIZE) -> dict:
    from apps.authentication.models import MfaRememberedDevice
    from apps.events.models import EventWebhookDelivery, EventWebhookStatus
    from apps.notifications.models import NotificationEmail, UserNotification
    from apps.officer_app.models import OfficerPushDelivery, OfficerPushDevice
    from apps.soul_accounts.models import SoulMfaDevice
    from apps.soul_push.models import PushDelivery, PushDevice, PushStatus

    now = now or timezone.now()

    def cutoff(setting):
        days = _days(setting)
        return now - timedelta(days=days) if days else None

    result = {}

    if c := cutoff("EVENT_WEBHOOK_DELIVERY_RETENTION_DAYS"):
        rows = EventWebhookDelivery.all_objects.filter(create_time__lt=c).exclude(status=EventWebhookStatus.PENDING)
        result["event_webhook_deliveries"] = _purge(rows, batch_size)

    if c := cutoff("USER_NOTIFICATION_READ_RETENTION_DAYS"):
        rows = UserNotification.all_objects.filter(is_read=True, created_at__lt=c)
        result["user_notifications"] = _purge_with_children(
            rows, lambda pks: [NotificationEmail.objects.filter(notification_id__in=pks)], batch_size
        )

    if c := cutoff("PUSH_DELIVERY_RETENTION_DAYS"):
        rows = PushDelivery.objects.filter(created_at__lt=c).exclude(status__in=(PushStatus.QUEUED, PushStatus.SENDING))
        result["push_deliveries"] = _purge(rows, batch_size)
        result["officer_push_deliveries"] = _purge(OfficerPushDelivery.objects.filter(created_at__lt=c), batch_size)

    if c := cutoff("INACTIVE_PUSH_DEVICE_RETENTION_DAYS"):
        result["push_devices"] = _purge_with_children(
            PushDevice.objects.filter(is_active=False, last_seen_at__lt=c),
            lambda pks: [PushDelivery.objects.filter(device_id__in=pks)], batch_size,
        )
        result["officer_push_devices"] = _purge_with_children(
            OfficerPushDevice.objects.filter(is_active=False, last_seen_at__lt=c),
            lambda pks: [OfficerPushDelivery.objects.filter(device_id__in=pks)], batch_size,
        )

    if c := cutoff("EXPIRED_MFA_DEVICE_GRACE_DAYS"):
        result["mfa_remembered_devices"] = _purge(MfaRememberedDevice.objects.filter(expires_at__lt=c), batch_size)
        result["soul_mfa_devices"] = _purge(SoulMfaDevice.objects.filter(expires_at__lt=c), batch_size)

    logger.info("data retention: %s", result)
    return result
