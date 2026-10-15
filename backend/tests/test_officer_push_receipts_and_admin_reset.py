"""官员端推送回执(设备未注册 → 停用)、保留期清理、管理员重置密码收尾(退出登录 + 删推送登记)。"""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.core.retention import prune_retained_data
from apps.officer_app import push
from apps.officer_app.models import OfficerPushDelivery, OfficerPushDevice
from apps.soul_push.models import PushStatus
from tests.test_password_change_ends_other_sessions import OLD, _get, _login, _refresh

pytestmark = pytest.mark.django_db


class FakeSender:
    def __init__(self, receipts):
        self._receipts = receipts

    def receipts(self, ids):
        return {i: self._receipts[i] for i in ids if i in self._receipts}


@pytest.fixture
def officer(django_user_model, cn_tenant):
    return django_user_model.objects.create_user(
        username="two_devices", email="two@example.com", password=OLD, role="JUDGE", tenant=cn_tenant)


def _device(user, token):
    return OfficerPushDevice.objects.create(user=user, token=token, platform="IOS", last_seen_at=timezone.now())


def _delivery(device, ticket, minutes_ago=30):
    row = OfficerPushDelivery.objects.create(device=device, ticket_id=ticket)
    OfficerPushDelivery.objects.filter(pk=row.pk).update(created_at=timezone.now() - timedelta(minutes=minutes_ago))
    return row


def test_not_registered_receipt_deactivates_only_that_device(officer, settings):
    settings.SOUL_PUSH_ENABLED = True
    dead, alive = _device(officer, "T-dead"), _device(officer, "T-alive")
    d1, d2 = _delivery(dead, "tk-dead"), _delivery(alive, "tk-alive")
    sender = FakeSender({"tk-dead": {"status": "error", "details": {"error": "DeviceNotRegistered"}},
                         "tk-alive": {"status": "ok"}})

    assert push.check_receipts(sender=sender) == 2

    dead.refresh_from_db(), alive.refresh_from_db(), d1.refresh_from_db(), d2.refresh_from_db()
    assert dead.is_active is False and alive.is_active is True
    assert (d1.status, d2.status) == (PushStatus.FAILED, PushStatus.DELIVERED)


def test_other_errors_and_unrelated_receipts_leave_devices_alone(officer, settings):
    settings.SOUL_PUSH_ENABLED = True
    dev = _device(officer, "T-1")
    _delivery(dev, "tk-1")
    fresh = _delivery(dev, "tk-fresh", minutes_ago=1)  # 不满 15 分钟:不查
    sender = FakeSender({"tk-1": {"status": "error", "details": {"error": "MessageRateExceeded"}},
                         "tk-fresh": {"status": "error", "details": {"error": "DeviceNotRegistered"}},
                         "tk-someone-else": {"status": "error", "details": {"error": "DeviceNotRegistered"}}})

    push.check_receipts(sender=sender)

    dev.refresh_from_db(), fresh.refresh_from_db()
    assert dev.is_active is True and fresh.status == PushStatus.SENT


def test_nothing_is_checked_when_push_is_disabled(officer, settings):
    settings.SOUL_PUSH_ENABLED = False
    _delivery(_device(officer, "T-1"), "tk-1")
    assert push.check_receipts(sender=FakeSender({})) == 0


def test_send_records_a_delivery_for_each_ok_ticket(officer, monkeypatch):
    _device(officer, "T-1")
    monkeypatch.setattr(push.todo, "total", lambda u: 3)

    class S:
        def send(self, messages):
            return [{"status": "ok", "id": "tk-9"}]

    assert push.send_to_user(officer, sender=S()) == 1
    assert list(OfficerPushDelivery.objects.values_list("ticket_id", flat=True)) == ["tk-9"]


def test_retention_prunes_old_officer_deliveries_and_a_purged_devices_children(officer):
    dev = _device(officer, "T-1")
    old, new = _delivery(dev, "old"), _delivery(dev, "new")
    OfficerPushDelivery.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=400))
    gone = _device(officer, "T-gone")
    OfficerPushDevice.objects.filter(pk=gone.pk).update(is_active=False, last_seen_at=timezone.now() - timedelta(days=400))
    _delivery(gone, "child")

    result = prune_retained_data()

    assert result["officer_push_deliveries"] == 1
    assert list(OfficerPushDelivery.objects.values_list("pk", flat=True)) == [new.pk]
    assert not OfficerPushDevice.objects.filter(pk=gone.pk).exists()


def test_admin_reset_ends_sessions_and_push_registrations(officer, admin_user):
    device = _login()
    _device(officer, "T-1")
    assert _get(device["access"]) == 200

    c = APIClient()
    c.force_authenticate(admin_user)
    res = c.post(f"/api/v1/users/{officer.pk}/reset_password/")
    assert res.status_code == 200, res.content

    assert _get(device["access"]) == 401
    assert _refresh(device["refresh"]) == 401
    assert not OfficerPushDevice.objects.filter(user=officer).exists()
    log = AuditLog.objects.filter(resource="auth", resource_id=str(officer.pk), description__contains="管理员重置").get()
    assert log.changes["sessions_revoked"] is True and log.changes["by"] == str(admin_user.pk)
