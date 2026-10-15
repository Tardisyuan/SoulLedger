"""推送登记的几条规矩:换 token 时旧登记停用、不带会话的登记不抹掉已记的会话、账号的有效设备有上限、
共用一部手机时 token 转给新登录的人。官员端与灵魂端各一遍。

每条都断言「不该停用的仍然有效」,不只断言「该停用的停用了」。
"""
import pytest

from apps.authentication.models import SignInSession, User
from apps.officer_app import push
from apps.officer_app.models import OfficerPushDevice
from apps.soul_push import services
from apps.soul_push.models import PushDevice
from tests.soul_account_support import ready_soul

pytestmark = pytest.mark.django_db

T1, T2, T3 = (f"ExponentPushToken[{n:023d}]" for n in (1, 2, 3))


def _officer(tenant, name="push_o"):
    return User.objects.create_user(username=name, password="x", role="MODERATOR", tenant=tenant)


def test_officer_token_rotation_in_one_session_deactivates_the_old_registration(cn_tenant):
    """变异:去掉 `register_device` 里 `.exclude(pk=device.pk).update(is_active=False)` → 旧 token 仍有效,红。"""
    user = _officer(cn_tenant)
    mine = SignInSession.objects.create(user=user)
    other = SignInSession.objects.create(user=user)
    old, _ = push.register_device(user, T1, "IOS", session=mine)
    elsewhere, _ = push.register_device(user, T3, "ANDROID", session=other)
    new, _ = push.register_device(user, T2, "IOS", session=mine)
    for row in (old, elsewhere, new):
        row.refresh_from_db()
    assert (old.is_active, new.is_active) == (False, True)
    assert elsewhere.is_active is True  # 另一个会话(另一部手机)的登记不动


def test_officer_registration_without_a_session_keeps_the_recorded_one(cn_tenant):
    """变异:去掉 `if session is not None or …` 守卫 → 会话被抹成 None,红。"""
    user = _officer(cn_tenant)
    session = SignInSession.objects.create(user=user)
    push.register_device(user, T1, "IOS", session=session)
    device, _ = push.register_device(user, T1, "IOS", session=None)
    device.refresh_from_db()
    assert device.session_id == session.pk


def test_officer_token_taken_over_by_another_login_drops_the_old_session(cn_tenant):
    a, b = _officer(cn_tenant, "a"), _officer(cn_tenant, "b")
    push.register_device(a, T1, "IOS", session=SignInSession.objects.create(user=a))
    device, _ = push.register_device(b, T1, "IOS", session=None)
    device.refresh_from_db()
    assert device.user_id == b.pk and device.session_id is None
    assert not OfficerPushDevice.objects.filter(user=a, is_active=True).exists()  # A 不再收到


def test_soul_token_rotation_in_one_session_deactivates_the_old_registration(cn_tenant):
    account, _ = ready_soul(cn_tenant, name="换码")
    mine = SignInSession.objects.create(user=account.user)
    other = SignInSession.objects.create(user=account.user)
    old, _ = services.register_device(account, T1, "IOS", session=mine)
    elsewhere, _ = services.register_device(account, T3, "ANDROID", session=other)
    new, _ = services.register_device(account, T2, "IOS", session=mine)
    for row in (old, elsewhere, new):
        row.refresh_from_db()
    assert (old.is_active, new.is_active, elsewhere.is_active) == (False, True, True)


def test_soul_registration_without_a_session_keeps_the_recorded_one(cn_tenant):
    account, _ = ready_soul(cn_tenant, name="留会话")
    session = SignInSession.objects.create(user=account.user)
    services.register_device(account, T1, "IOS", session=session)
    device, _ = services.register_device(account, T1, "IOS", session=None)
    device.refresh_from_db()
    assert device.session_id == session.pk


def test_a_soul_account_keeps_at_most_ten_active_devices_the_newest_ones(cn_tenant):
    """变异:去掉 cap 那段 → 12 个全有效,红;把排序改成升序 → 留下的是最旧的,红。"""
    account, _ = ready_soul(cn_tenant, name="多机")
    rows = [services.register_device(account, f"ExponentPushToken[{100 + i:023d}]", "IOS")[0] for i in range(12)]
    active = set(PushDevice.objects.filter(account=account, is_active=True).values_list("pk", flat=True))
    assert len(active) == services.MAX_ACTIVE_DEVICES
    assert rows[-1].pk in active and rows[0].pk not in active


def test_a_shared_phone_token_moves_to_whoever_signed_in_last_and_stops_for_the_first(cn_tenant):
    """A 离线退出、服务器没被告知;B 在同一部手机登录登记同一个 token:A 名下不再有这个有效 token。"""
    a, _ = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    services.register_device(a, T1, "IOS")
    services.register_device(b, T1, "IOS")
    assert not PushDevice.objects.filter(account=a, token=T1, is_active=True).exists()
    assert PushDevice.objects.filter(account=b, token=T1, is_active=True).count() == 1
