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


# ── 按每台设备(有会话关联的登记) ─────────────────────────────────────────────
# 没有会话关联的老登记走上面的按人判断(过渡期,不回填)。


def _session(user, **kw):
    return SignInSession.objects.create(user=user, **kw)


def test_each_device_expires_on_its_own_session_even_when_the_user_has_another_live_one(officer, monkeypatch):
    user, device = officer
    old = _session(user)
    SignInSession.objects.filter(pk=old.pk).update(last_seen_at=_ago(hours=25))
    other = _session(user)  # 同一个人另一台设备还在用
    push.register_device(user, OFFICER_TOKEN, "IOS", session=old)
    live, _ = push.register_device(user, "ExponentPushToken[officer0000000000000y]", "IOS", session=other)
    assert _officer_sends(user, monkeypatch) == 1
    assert FakeSender.batches[0][0]["to"] == live.token
    assert prune_expired_push_registrations()["officer"] == 1
    device.refresh_from_db()
    assert device.is_active is False


def test_revoking_a_session_deactivates_the_registrations_made_under_it(officer):
    from apps.authentication import signin_sessions

    user, _ = officer
    s1, s2 = _session(user), _session(user)
    d1, _ = push.register_device(user, "ExponentPushToken[officer0000000000000s1]", "IOS", session=s1)
    d2, _ = push.register_device(user, "ExponentPushToken[officer0000000000000s2]", "IOS", session=s2)
    signin_sessions.revoke(s1)
    d1.refresh_from_db()
    d2.refresh_from_db()
    assert (d1.is_active, d2.is_active) == (False, True)
    signin_sessions.revoke_all(user)
    d2.refresh_from_db()
    assert d2.is_active is False


def test_soul_revoke_deactivates_the_registration_of_that_session(cn_tenant, push_on):  # noqa: F811
    from apps.authentication import signin_sessions

    account, _client = ready_soul(cn_tenant, name="亡魂丁")
    session = _session(account.user)
    device, _ = services.register_device(account, TOKEN_A, "IOS", session=session)
    signin_sessions.revoke(session)
    device.refresh_from_db()
    assert device.is_active is False


def test_soul_device_expires_on_its_own_session(cn_tenant, push_on):  # noqa: F811
    account, _client = ready_soul(cn_tenant, name="亡魂戊")
    old = _session(account.user)
    SignInSession.objects.filter(pk=old.pk).update(last_seen_at=timezone.now() - timedelta(days=8))
    _session(account.user)
    services.register_device(account, TOKEN_A, "IOS", session=old)
    assert services._record(account, "JUDGMENT_CONCLUDED", "judgment", "judgment_result", "k-3", {}) == []
    assert prune_expired_push_registrations()["soul"] == 1


def test_register_endpoint_stores_the_sid_of_the_request_token(cn_tenant, push_on):  # noqa: F811
    from rest_framework.test import APIClient

    from apps.soul_accounts import services as svc

    account, _client = ready_soul(cn_tenant, name="亡魂己")
    session = _session(account.user)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {svc.issue_tokens(account, session)['access']}")
    resp = client.post("/api/v1/me/push-tokens/", {"token": TOKEN_A, "platform": "IOS"}, format="json")
    assert resp.status_code == 201
    assert PushDevice.objects.get(token=TOKEN_A).session_id == session.pk


def test_soul_logout_ends_the_session_and_its_registration(cn_tenant, push_on):  # noqa: F811
    """退出登录在服务端结束这台设备的会话(2026-10-23 前只拉黑令牌):App 离线退出时注销推送的请求发不出去，
    下次联网补发 logout 即可停推,不必再靠已经不在的 access token 去注销。"""
    from rest_framework.test import APIClient

    from apps.soul_accounts import services as svc

    account, _client = ready_soul(cn_tenant, name="亡魂庚")
    session = _session(account.user)
    device, _ = services.register_device(account, TOKEN_A, "IOS", session=session)
    refresh = svc.issue_tokens(account, session)["refresh"]
    assert APIClient().post("/api/v1/soul-auth/logout/", {"refresh": refresh}, format="json").status_code == 204
    device.refresh_from_db()
    session.refresh_from_db()
    assert device.is_active is False and session.revoked_at is not None


def test_officer_logout_ends_the_session_and_its_registration(officer):
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    from apps.authentication import signin_sessions

    user, _ = officer
    session = _session(user)
    device, _ = push.register_device(user, "ExponentPushToken[officer0000000000000lo]", "IOS", session=session)
    refresh = RefreshToken.for_user(user)
    signin_sessions.attach(refresh, session)
    client = APIClient()
    client.force_authenticate(user)
    assert client.post("/api/v1/auth/logout/", {"refresh": str(refresh)}, format="json").status_code == 200
    device.refresh_from_db()
    session.refresh_from_db()
    assert device.is_active is False and session.revoked_at is not None
