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


# ── token 从另一个账号转过来:通知旧账号 + 审计(2026-11-11 用户决定,审计 A2-04)────────────────


def test_a_soul_token_taken_by_another_account_tells_the_old_one_and_is_audited(cn_tenant):
    """变异:`_register` 去掉 `_tell_previous_owner(...)` → 甲没有通知、也没有审计,红。
    同一账号重复登记不再发、不再记(变异:条件改成恒真 → 第二次多一行,红)。"""
    from apps.audit.models import AuditLog
    from apps.soul_push import messages
    from apps.soul_push.models import PushDelivery, PushStatus

    a, _ = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    services.register_device(a, T1, "IOS")
    services.register_device(a, T2, "ANDROID")  # 甲还有一部手机,通知推到那一部
    services.register_device(b, T1, "IOS")

    (notice,) = PushDelivery.objects.filter(kind="push_device_claimed")
    assert notice.account_id == a.pk and notice.device.token == T2 and notice.status == PushStatus.QUEUED
    assert (notice.title, notice.body) == messages.render("zh-Hans", "push_device_claimed")
    assert not PushDelivery.objects.filter(account=b).exists(), "新主人不该收到这条"
    (log,) = AuditLog.objects.filter(resource="soul_push_device")
    assert log.user_id == b.user_id and log.tenant_id == a.soul.home_tenant_id
    assert log.resource_id == str(PushDevice.objects.get(token=T1).pk)
    assert log.changes["account"] == [str(a.pk), str(b.pk)]

    services.register_device(b, T1, "IOS")  # 同一账号再登记一次
    assert PushDelivery.objects.filter(kind="push_device_claimed").count() == 1
    assert AuditLog.objects.filter(resource="soul_push_device").count() == 1


def test_a_soul_token_the_old_account_had_already_given_up_is_audited_but_not_announced(cn_tenant):
    """旧账号已注销这部手机(登记无效)时它本来就收不到这部手机的推送:只记审计,不发通知。"""
    from apps.audit.models import AuditLog
    from apps.soul_push.models import PushDelivery

    a, _ = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    services.register_device(a, T1, "IOS")
    services.unregister_device(a, T1)
    services.register_device(b, T1, "IOS")
    assert not PushDelivery.objects.filter(kind="push_device_claimed").exists()
    assert AuditLog.objects.filter(resource="soul_push_device").count() == 1


def test_an_officer_token_taken_by_another_officer_tells_the_old_one_and_is_audited(
    cn_tenant, django_capture_on_commit_callbacks
):
    """变异:官员端 `_register` 去掉 `_tell_previous_owner(...)` → 旧官员没有站内通知、也没有审计,红。"""
    from apps.audit.models import AuditLog
    from apps.notifications import messages
    from apps.notifications.models import UserNotification

    a, b = _officer(cn_tenant, "push_a"), _officer(cn_tenant, "push_b")
    push.register_device(a, T1, "IOS")
    with django_capture_on_commit_callbacks(execute=True):
        push.register_device(b, T1, "IOS")

    (note,) = UserNotification.objects.filter(user=a)
    assert note.notification_type == "SYSTEM" and note.params == {"kind": "push_device_claimed"}
    assert (note.title, note.message) == messages.render("zh-Hans", "push_device_claimed", {})
    assert not UserNotification.objects.filter(user=b).exists(), "新主人不该收到这条"
    (log,) = AuditLog.objects.filter(resource="officer_push_device")
    assert log.user_id == b.pk and log.tenant_id == cn_tenant.pk
    assert log.resource_id == str(OfficerPushDevice.objects.get(token=T1).pk)
    assert log.changes["user"] == [a.pk, b.pk]

    with django_capture_on_commit_callbacks(execute=True):
        push.register_device(b, T1, "IOS")  # 同一位官员再登记一次
    assert UserNotification.objects.filter(user=a).count() == 1
    assert AuditLog.objects.filter(resource="officer_push_device").count() == 1
