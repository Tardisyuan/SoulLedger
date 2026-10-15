"""手机上的登录到期、又没人重新登录:推送登记不再留着(发送路径跳过 + 每日清理停用)。

官员端刷新令牌 24 小时,灵魂端 `JWT_REFRESH_LIFETIME`;登记之后超过这么久没再登记,**且**用户没有任何
未退出、在有效期内活动过的登录,才算到期。
"""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.authentication.models import SignInSession, User
from apps.authentication.tasks import prune_expired_push_registrations
from apps.officer_app import push, todo
from apps.officer_app.models import OfficerPushDevice
from apps.scheduler import registry
from apps.soul_push import services
from apps.soul_push.models import PushDevice
from tests.soul_account_support import ready_soul
from tests.soul_push_support import TOKEN_A, FakeSender, push_on  # noqa: F401

pytestmark = pytest.mark.django_db

OFFICER_TOKEN = "ExponentPushToken[officer0000000000000z]"


def _ago(**kw):
    return timezone.now() - timedelta(**kw)


@pytest.fixture
def officer(cn_tenant):
    user = User.objects.create_user(username="expiring", password="x", role="MODERATOR", tenant=cn_tenant)
    device, _ = push.register_device(user, OFFICER_TOKEN, "IOS")
    return user, device


def _officer_sends(user, monkeypatch):
    monkeypatch.setattr(todo, "total", lambda u: 3)
    FakeSender.reset()
    return push.send_to_user(user, sender=FakeSender())


def test_officer_registration_past_24h_with_no_live_sign_in_is_not_pushed_and_is_pruned(officer, monkeypatch):
    user, device = officer
    OfficerPushDevice.objects.filter(pk=device.pk).update(last_seen_at=_ago(hours=25))
    assert _officer_sends(user, monkeypatch) == 0 and FakeSender.batches == []
    assert prune_expired_push_registrations()["officer"] == 1
    device.refresh_from_db()
    assert device.is_active is False


def test_officer_registration_is_kept_while_the_sign_in_is_alive(officer, monkeypatch):
    user, device = officer
    OfficerPushDevice.objects.filter(pk=device.pk).update(last_seen_at=_ago(hours=25))
    SignInSession.objects.create(user=user, label="官员 App · iPhone")  # last_seen_at = now(刷新会更新它)
    assert _officer_sends(user, monkeypatch) == 1
    prune_expired_push_registrations()
    device.refresh_from_db()
    assert device.is_active is True


def test_a_revoked_sign_in_does_not_keep_the_registration_alive(officer, monkeypatch):
    user, device = officer
    OfficerPushDevice.objects.filter(pk=device.pk).update(last_seen_at=_ago(hours=25))
    SignInSession.objects.create(user=user, revoked_at=timezone.now())
    assert _officer_sends(user, monkeypatch) == 0


def test_a_fresh_registration_is_pushed_without_any_session_row(officer, monkeypatch):
    user, _ = officer
    assert _officer_sends(user, monkeypatch) == 1


def test_soul_registration_past_the_refresh_lifetime_is_not_recorded_and_is_pruned(cn_tenant, push_on, settings):  # noqa: F811
    account, _client = ready_soul(cn_tenant, name="亡魂乙")
    device, _ = services.register_device(account, TOKEN_A, "IOS")
    lifetime = settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"]
    PushDevice.objects.filter(pk=device.pk).update(last_seen_at=timezone.now() - lifetime - timedelta(hours=1))
    assert services._record(account, "JUDGMENT_CONCLUDED", "judgment", "judgment_result", "k-1", {}) == []
    assert prune_expired_push_registrations()["soul"] == 1
    device.refresh_from_db()
    assert device.is_active is False


def test_soul_registration_is_kept_while_the_sign_in_is_alive(cn_tenant, push_on, settings):  # noqa: F811
    account, _client = ready_soul(cn_tenant, name="亡魂丙")
    device, _ = services.register_device(account, TOKEN_A, "IOS")
    lifetime = settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"]
    PushDevice.objects.filter(pk=device.pk).update(last_seen_at=timezone.now() - lifetime - timedelta(hours=1))
    SignInSession.objects.create(user=account.user)
    assert len(services._record(account, "JUDGMENT_CONCLUDED", "judgment", "judgment_result", "k-2", {})) == 1
    prune_expired_push_registrations()
    device.refresh_from_db()
    assert device.is_active is True


def test_the_prune_is_registered_with_the_scheduler():
    assert registry.get("authentication.prune_expired_push_registrations") is not None
