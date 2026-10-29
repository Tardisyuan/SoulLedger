"""`apps/core/retention.py`: the operational tables age out, the business record does not."""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.authentication.models import MfaRememberedDevice, User
from apps.core.retention import prune_retained_data
from apps.events.models import EventType, EventWebhookDelivery, EventWebhookStatus, SoulEvent
from apps.notifications.models import NotificationEmail, UserNotification
from apps.officer_app.models import OfficerPushDevice
from apps.tenants.models import Tenant


@pytest.fixture
def user(db):
    cn, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    return User.objects.create_user(username="ret_user", password="x", role="MODERATOR", tenant=cn)


def _age(obj, field, days):
    type(obj).objects.model._base_manager.filter(pk=obj.pk).update(**{field: timezone.now() - timedelta(days=days)})


def test_read_notifications_age_out_unread_ones_never(user):
    old_read = UserNotification.objects.create(user=user, title="a", message="a", is_read=True)
    old_unread = UserNotification.objects.create(user=user, title="b", message="b", is_read=False)
    young_read = UserNotification.objects.create(user=user, title="c", message="c", is_read=True)
    NotificationEmail.objects.create(notification=old_read, sent=True)  # a child: must not block the delete
    _age(old_read, "created_at", 181)
    _age(old_unread, "created_at", 1000)

    result = prune_retained_data()

    assert result["user_notifications"] == 1
    left = set(UserNotification.all_objects.values_list("pk", flat=True))
    assert left == {old_unread.pk, young_read.pk}
    assert not NotificationEmail.objects.exists()


def test_a_zero_setting_keeps_everything(user, settings):
    settings.USER_NOTIFICATION_READ_RETENTION_DAYS = 0
    old = UserNotification.objects.create(user=user, title="a", message="a", is_read=True)
    _age(old, "created_at", 5000)
    assert "user_notifications" not in prune_retained_data()
    assert UserNotification.objects.filter(pk=old.pk).exists()


def test_webhook_deliveries_keep_pending_and_fresh_ones(user):
    from apps.death_sync.models import ExternalApiKey, WebhookConfig

    key = ExternalApiKey.objects.create(tenant=user.tenant, name="k", system_type="CUSTOM", key_hash="abc", key_prefix="slk_abc")
    hook = WebhookConfig.objects.create(tenant=user.tenant, api_key=key, url="https://example.invalid/x", signing_secret="s")

    def make(status):
        return EventWebhookDelivery.objects.create(
            webhook=hook, tenant=user.tenant, domain="soul", event_type="x", payload_json={}, status=status
        )

    done, pending, fresh = make(EventWebhookStatus.SUCCESS), make(EventWebhookStatus.PENDING), make(EventWebhookStatus.FAILED)
    _age(done, "create_time", 91)
    _age(pending, "create_time", 400)

    assert prune_retained_data()["event_webhook_deliveries"] == 1
    assert set(EventWebhookDelivery.all_objects.values_list("pk", flat=True)) == {pending.pk, fresh.pk}


def test_inactive_devices_and_expired_mfa_rows_go(user):
    now = timezone.now()
    stale = OfficerPushDevice.objects.create(user=user, token="a", platform="ios", is_active=False,
                                             last_seen_at=now - timedelta(days=31))
    live = OfficerPushDevice.objects.create(user=user, token="b", platform="ios", is_active=True,
                                            last_seen_at=now - timedelta(days=300))
    recent = OfficerPushDevice.objects.create(user=user, token="c", platform="ios", is_active=False,
                                              last_seen_at=now - timedelta(days=2))
    expired = MfaRememberedDevice.objects.create(user=user, token_hash="e" * 64, expires_at=now - timedelta(days=2))
    valid = MfaRememberedDevice.objects.create(user=user, token_hash="f" * 64, expires_at=now + timedelta(days=2))

    result = prune_retained_data()

    assert result["officer_push_devices"] == 1 and result["mfa_remembered_devices"] == 1
    assert set(OfficerPushDevice.objects.values_list("pk", flat=True)) == {live.pk, recent.pk}
    assert list(MfaRememberedDevice.objects.values_list("pk", flat=True)) == [valid.pk]
    assert stale.pk and expired.pk


def test_soul_events_are_never_touched(user):
    from apps.souls.models import Soul

    soul = Soul.objects.create(name="魂", tenant=user.tenant)
    event = SoulEvent.objects.create(soul=soul, tenant=user.tenant, event_type=list(EventType.values)[0])
    SoulEvent.objects.filter(pk=event.pk).update(create_time=timezone.now() - timedelta(days=5000))
    prune_retained_data()
    assert SoulEvent.objects.filter(pk=event.pk).exists()


def test_the_job_is_registered_and_runnable():
    from apps.scheduler import registry

    assert registry.get("audit.prune_retained_data") is not None
    from apps.audit.tasks import prune_retained_data as task

    assert task.name == "audit.prune_retained_data"


def test_assist_usage_ages_out_and_a_zero_setting_keeps_it(user, settings):
    from apps.soul_assist.models import AssistUsage
    from apps.soul_assist.usage import record

    record("officer", user.tenant, "ok")
    record("officer", user.tenant, "ok")
    old, young = AssistUsage.objects.order_by("id")
    AssistUsage.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=731))

    settings.ASSIST_USAGE_RETENTION_DAYS = 0
    assert "assist_usage" not in prune_retained_data()
    assert AssistUsage.objects.count() == 2

    settings.ASSIST_USAGE_RETENTION_DAYS = 730
    assert prune_retained_data()["assist_usage"] == 1
    assert list(AssistUsage.objects.values_list("pk", flat=True)) == [young.pk]


def test_expired_django_sessions_go_live_ones_stay(db):
    from django.contrib.sessions.backends.db import SessionStore
    from django.contrib.sessions.models import Session

    live = SessionStore()
    live["k"] = 1
    live.create()
    dead = SessionStore()
    dead["k"] = 1
    dead.create()
    Session.objects.filter(pk=dead.session_key).update(expire_date=timezone.now() - timedelta(seconds=1))

    assert prune_retained_data()["expired_sessions"] == 1
    assert list(Session.objects.values_list("pk", flat=True)) == [live.session_key]
