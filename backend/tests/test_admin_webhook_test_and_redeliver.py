"""「发测试事件」与「重投」(审计 2026-10-17 第 14 条):`POST admin-webhooks/<id>/test/`、
`POST webhook-deliveries/<id>/redeliver/`。

两个都走真投递同一条路:先写一行 `EventWebhookDelivery`,**提交后**才入队(事务回滚时什么都不发)。
重投新写一行、原行不动;只收不会再自动重试的失败(ABANDONED,或 FAILED 且已到次数上限),
还在重试的 409 `not_finished` —— 否则就是重复投递。停用的 webhook 两个都 409 `webhook_inactive`。
只给 ADMIN(与这两扇门的其余动作同一个守卫)。
"""
from unittest.mock import patch

import pytest
from rest_framework import status

from apps.events.models import EventWebhookDelivery, EventWebhookStatus
from tests.test_admin_webhooks import _key, _webhook
from tests.test_death_sync import _jwt_client

ADMIN_URL = "/api/v1/death-sync/admin-webhooks/"
DELIVERIES_URL = "/api/v1/death-sync/webhook-deliveries/"
DELAY = "apps.events.tasks.deliver_event_webhook.delay"


@pytest.fixture
def hall(db):
    from django.contrib.auth import get_user_model

    from apps.tenants.models import Tenant

    tenant = Tenant.objects.get_or_create(code="WHT_CN", defaults={"display_name": "WHT"})[0]
    User = get_user_model()
    admin = User.objects.create_user(username="wht_admin", password="x", role="ADMIN", tenant=tenant)
    judge = User.objects.create_user(username="wht_judge", password="x", role="JUDGE", tenant=tenant)
    hook = _webhook(tenant, _key(tenant, "WHT key")[0], max_retries=3)
    return {"tenant": tenant, "admin": _jwt_client(admin, tenant), "judge": _jwt_client(judge, tenant), "hook": hook}


def _delivery(hall, **extra):
    return EventWebhookDelivery.objects.create(
        webhook=hall["hook"], tenant=hall["tenant"], domain="death_sync", event_type="DEATH_SYNC_PROCESSED",
        payload_json={"event_type": "DEATH_SYNC_PROCESSED", "payload": {"soul_id": "s"}}, **extra,
    )


def test_send_test_records_a_webhook_test_delivery_and_enqueues_it_after_commit(hall, django_capture_on_commit_callbacks):
    with patch(DELAY) as delay, django_capture_on_commit_callbacks(execute=False) as callbacks:
        resp = hall["admin"].post(f"{ADMIN_URL}{hall['hook'].pk}/test/")
        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        delay.assert_not_called()  # 还没提交
    row = EventWebhookDelivery.objects.get(pk=resp.data["id"])
    assert (row.event_type, row.status, row.webhook_id) == ("WEBHOOK_TEST", EventWebhookStatus.PENDING, hall["hook"].pk)
    assert row.payload_json["payload"]["test"] is True
    assert "payload_json" not in resp.data
    with patch(DELAY) as delay:
        for callback in callbacks:
            callback()
    delay.assert_called_once_with(str(row.pk))


def test_send_test_refuses_a_disabled_webhook_and_a_non_admin(hall):
    assert hall["judge"].post(f"{ADMIN_URL}{hall['hook'].pk}/test/").status_code == status.HTTP_403_FORBIDDEN
    hall["hook"].is_active = False
    hall["hook"].save(update_fields=["is_active"])
    resp = hall["admin"].post(f"{ADMIN_URL}{hall['hook'].pk}/test/")
    assert resp.status_code == status.HTTP_409_CONFLICT and resp.data["code"] == "webhook_inactive"
    assert not EventWebhookDelivery.objects.filter(event_type="WEBHOOK_TEST").exists()


@pytest.mark.parametrize("state, attempt", [(EventWebhookStatus.ABANDONED, 3), (EventWebhookStatus.FAILED, 3)])
def test_redeliver_a_finished_failure_writes_a_new_row_and_leaves_the_old_one(
    hall, state, attempt, django_capture_on_commit_callbacks,
):
    old = _delivery(hall, status=state, attempt=attempt, error="RuntimeError: HTTP 502")
    with patch(DELAY) as delay, django_capture_on_commit_callbacks(execute=True):
        resp = hall["admin"].post(f"{DELIVERIES_URL}{old.pk}/redeliver/")
    assert resp.status_code == status.HTTP_201_CREATED, resp.data
    new = EventWebhookDelivery.objects.get(pk=resp.data["id"])
    assert new.pk != old.pk and new.payload_json == old.payload_json and new.event_type == old.event_type
    assert (new.status, new.attempt) == (EventWebhookStatus.PENDING, 0)
    old.refresh_from_db()
    assert (old.status, old.attempt, old.error) == (state, attempt, "RuntimeError: HTTP 502")
    delay.assert_called_once_with(str(new.pk))


@pytest.mark.parametrize("state, attempt", [
    (EventWebhookStatus.FAILED, 1),  # 还会自动重试
    (EventWebhookStatus.SUCCESS, 1),
    (EventWebhookStatus.PENDING, 0),
])
def test_redeliver_refuses_what_is_not_a_finished_failure(hall, state, attempt):
    row = _delivery(hall, status=state, attempt=attempt)
    with patch(DELAY) as delay:
        resp = hall["admin"].post(f"{DELIVERIES_URL}{row.pk}/redeliver/")
    assert resp.status_code == status.HTTP_409_CONFLICT and resp.data["code"] == "not_finished"
    assert EventWebhookDelivery.objects.filter(webhook=hall["hook"]).count() == 1
    delay.assert_not_called()


def test_redeliver_refuses_a_disabled_webhook_and_a_non_admin(hall):
    row = _delivery(hall, status=EventWebhookStatus.ABANDONED, attempt=3)
    assert hall["judge"].post(f"{DELIVERIES_URL}{row.pk}/redeliver/").status_code == status.HTTP_403_FORBIDDEN
    hall["hook"].is_active = False
    hall["hook"].save(update_fields=["is_active"])
    resp = hall["admin"].post(f"{DELIVERIES_URL}{row.pk}/redeliver/")
    assert resp.status_code == status.HTTP_409_CONFLICT and resp.data["code"] == "webhook_inactive"
