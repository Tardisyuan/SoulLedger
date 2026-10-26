"""「以此人身份查看」(W6):只读代看。规则与实现见 `apps/authentication/impersonation.py`。

每条都同时断言**有**与**没有**:被拒的写操作要看数据没变,被放行的读要看确实读到了被看者而不是管理员。
"""
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.audit.models import AuditAction, AuditLog
from apps.authentication.impersonation_models import Impersonation
from apps.notifications import categories
from apps.notifications.models import NotificationType, UserNotification
from apps.notifications.tasks import email_action_needed_for_tenant
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

START = "/api/v1/auth/impersonate/"
END = "/api/v1/auth/impersonate/end/"
PROFILE = "/api/v1/auth/profile/"


@pytest.fixture
def target(django_user_model, cn_tenant):
    return django_user_model.objects.create_user(
        username="mengpo", password="x", role="JUDGE", tenant=cn_tenant, display_name="孟婆", email="mengpo@example.com",
    )


def _start(admin, target, reason="她说看不到「移交」菜单", **extra):
    return officer_client(admin).post(START, {"user_id": target.pk, "reason": reason, **extra}, format="json")


def _viewing(admin, target):
    response = _start(admin, target)
    assert response.status_code == 201, response.content
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
    return client, response.data


# ── 谁能发起 ───────────────────────────────────────────────────────────────


def test_only_an_admin_can_start(admin_user, judge_user, target, api_client):
    assert _start(admin_user, target).status_code == 201  # 对照:管理员留下一行记录、一条审计、一条通知
    assert _start(judge_user, target).status_code == 403
    assert api_client.post(START, {"user_id": target.pk, "reason": "x"}, format="json").status_code == 401
    assert Impersonation.objects.count() == 1
    assert AuditLog.objects.filter(action=AuditAction.IMPERSONATE_START).count() == 1
    assert UserNotification.objects.filter(notification_type=NotificationType.IMPERSONATION_STARTED).count() == 1


def test_admin_starts_and_gets_an_access_token_without_a_refresh_token(admin_user, target):
    response = _start(admin_user, target)
    assert response.status_code == 201
    assert "refresh" not in response.data
    claims = AccessToken(response.data["access"])
    assert claims["user_id"] == str(target.pk) and claims["imp_by"] == admin_user.pk
    assert claims["imp_id"] == response.data["impersonation_id"]
    assert claims["tenant_code"] == target.tenant.code
    assert response.data["target"]["name"] == "孟婆"
    record = Impersonation.objects.get()
    assert abs(record.expires_at - record.started_at - timedelta(minutes=30)) < timedelta(seconds=2)


def test_cannot_view_another_admin_or_oneself(admin_user, django_user_model, cn_tenant):
    other = django_user_model.objects.create_user(username="admin2", password="x", role="ADMIN", tenant=cn_tenant)
    for victim, code in ((other, "impersonate_admin"), (admin_user, "impersonate_self")):
        response = _start(admin_user, victim)
        assert response.status_code == 400 and response.data["code"] == code
    assert Impersonation.objects.count() == 0 and not UserNotification.objects.exists()


def test_cannot_view_a_soul_account_or_a_deactivated_user(admin_user, django_user_model, cn_tenant, target):
    soul = django_user_model.objects.create_user(username="s1", password="x", role="SOUL", tenant=cn_tenant)
    target.is_active = False
    target.save()
    assert _start(admin_user, soul).status_code == 400
    assert _start(admin_user, target).status_code == 400
    assert Impersonation.objects.count() == 0


@pytest.mark.parametrize("reason", ["", "   ", None])
def test_a_reason_is_required(admin_user, target, reason):
    body = {"user_id": target.pk} if reason is None else {"user_id": target.pk, "reason": reason}
    assert officer_client(admin_user).post(START, body, format="json").status_code == 400
    assert Impersonation.objects.count() == 0


# ── 只读 ──────────────────────────────────────────────────────────────────

WRITES = [
    ("post", "/api/v1/souls/"),
    ("post", "/api/v1/users/"),
    ("patch", "/api/v1/auth/profile/"),
    ("patch", "/api/v1/auth/profile/preferences/"),
    ("post", "/api/v1/auth/change-password/"),
    ("post", "/api/v1/auth/logout/"),
    ("post", START),  # 代看里不能再开代看
    ("put", "/api/v1/auth/profile/"),
    ("delete", "/api/v1/auth/profile/"),
]


@pytest.mark.parametrize("method,url", WRITES)
def test_every_unsafe_method_is_refused_on_the_server(admin_user, target, method, url):
    viewing, _ = _viewing(admin_user, target)
    before = (AuditLog.objects.count(), UserNotification.objects.count())
    response = getattr(viewing, method)(url, {"user_id": admin_user.pk, "reason": "x"}, format="json")
    assert response.status_code == 403, (method, url, response.status_code)
    assert response.data["code"] == "impersonation_read_only"
    assert (AuditLog.objects.count(), UserNotification.objects.count()) == before


def test_the_same_write_is_not_refused_that_way_for_the_admins_own_token(admin_user):
    response = officer_client(admin_user).patch("/api/v1/auth/profile/preferences/", {"onboarded": True}, format="json")
    assert response.status_code == 200


@pytest.mark.parametrize("url", ["/api/v1/audit-logs/export/", "/api/v1/souls/export/", "/api/v1/users/export_csv/", "/api/v1/perm/export/"])
def test_exports_are_refused(admin_user, target, url):
    viewing, _ = _viewing(admin_user, target)
    rows = AuditLog.objects.filter(action=AuditAction.EXPORT).count()
    response = viewing.get(url)
    assert response.status_code == 403 and response.data["code"] == "impersonation_read_only"
    assert AuditLog.objects.filter(action=AuditAction.EXPORT).count() == rows


def test_record_export_itself_refuses_an_impersonation_token(target):
    from rest_framework.exceptions import PermissionDenied

    from apps.core.exports import record_export

    request = MagicMock(auth={"imp_id": 1}, user=target)
    with patch.object(AuditLog.objects, "create") as create, pytest.raises(PermissionDenied):
        record_export(request, resource="soul", rows=1)
    create.assert_not_called()


def test_reads_work_as_the_target_and_distinct_pages_are_counted(admin_user, target):
    viewing, _ = _viewing(admin_user, target)
    for page in ("/souls", "/souls", "/judgments", "/souls"):
        response = viewing.get(PROFILE, HTTP_X_IMP_PAGE=page)
        assert response.status_code == 200
        assert response.data["username"] == "mengpo" and response.data["username"] != admin_user.username
    viewing.get(PROFILE)  # 没带页面的请求不计
    assert sorted(Impersonation.objects.get().pages) == ["/judgments", "/souls"]
    assert AuditLog.objects.exclude(action__in=[AuditAction.IMPERSONATE_START]).count() == 0  # 浏览不另记审计


# ── 到点与结束 ─────────────────────────────────────────────────────────────


def test_an_expired_session_is_refused_and_closed_with_an_end_row(admin_user, target):
    viewing, _ = _viewing(admin_user, target)
    Impersonation.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    response = viewing.get(PROFILE)
    assert response.status_code == 403 and response.data["code"] == "impersonation_expired"
    end = AuditLog.objects.get(action=AuditAction.IMPERSONATE_END)
    assert end.changes["how"] == "expired" and end.user_id == admin_user.pk


def test_end_writes_one_row_with_duration_and_pages_and_kills_the_token(admin_user, target):
    viewing, _ = _viewing(admin_user, target)
    Impersonation.objects.update(started_at=timezone.now() - timedelta(minutes=14))
    for page in ("/a", "/b", "/c"):
        viewing.get(PROFILE, HTTP_X_IMP_PAGE=page)

    response = viewing.post(END)
    assert response.status_code == 200 and response.data == {"ended": True, "minutes": 14, "pages": 3}
    end = AuditLog.objects.get(action=AuditAction.IMPERSONATE_END)
    assert (end.user_id, end.resource_id) == (admin_user.pk, str(target.pk))
    assert end.changes["minutes"] == 14 and end.changes["pages"] == 3
    assert "14 分钟" in end.description and "3 个页面" in end.description

    again = viewing.get(PROFILE)
    assert again.status_code == 403 and again.data["code"] == "impersonation_ended"
    assert viewing.post(END).status_code == 403
    assert AuditLog.objects.filter(action=AuditAction.IMPERSONATE_END).count() == 1


def test_the_admin_can_end_it_with_their_own_token_and_keeps_working(admin_user, target):
    _viewing(admin_user, target)
    admin = officer_client(admin_user)
    assert admin.get(PROFILE).data["username"] == admin_user.username
    assert admin.post(END).data["ended"] is True
    assert admin.post(END).data["ended"] is False
    assert AuditLog.objects.filter(action=AuditAction.IMPERSONATE_END).count() == 1


def test_start_writes_one_row_and_a_new_session_supersedes_the_old(admin_user, target, django_user_model, cn_tenant):
    _viewing(admin_user, target)
    start = AuditLog.objects.get(action=AuditAction.IMPERSONATE_START)
    assert (start.user_id, start.resource_id) == (admin_user.pk, str(target.pk))
    assert start.changes["reason"] == "她说看不到「移交」菜单"
    other = django_user_model.objects.create_user(username="cui", password="x", role="JUDGE", tenant=cn_tenant)
    _viewing(admin_user, other)
    assert Impersonation.objects.filter(ended_at__isnull=True).count() == 1
    assert AuditLog.objects.filter(action=AuditAction.IMPERSONATE_END, changes__how="superseded").count() == 1


def test_the_session_dies_if_the_admin_loses_the_role(admin_user, target):
    viewing, _ = _viewing(admin_user, target)
    admin_user.role = "JUDGE"
    admin_user.save()
    assert viewing.get(PROFILE).status_code == 403


# ── 被看的人 ───────────────────────────────────────────────────────────────


def test_the_target_is_notified_in_app_and_by_mail_and_cannot_mute_it(admin_user, target, cn_tenant):
    _start(admin_user, target)
    note = UserNotification.objects.get(user=target, notification_type=NotificationType.IMPERSONATION_STARTED)
    assert admin_user.username in note.message or "admin" in note.message
    assert "她说看不到「移交」菜单" in note.message
    assert categories.category_of("IMPERSONATION_STARTED") == "account_security"
    assert categories.LOCKED["account_security"] == ("site", "mail")

    # 即使存过「关」,送达处也不看
    target.preferences = {"notifications": {"account_security": {"site": False, "mail": False}}}
    target.save()
    assert categories.wants(target, "account_security", "site") and categories.wants(target, "account_security", "mail")
    email_action_needed_for_tenant(str(cn_tenant.id))
    assert [m.to for m in mail.outbox] == [["mengpo@example.com"]]

    muted = officer_client(target).patch(
        "/api/v1/auth/profile/preferences/", {"notifications": {"account_security": {"site": False}}}, format="json"
    )
    assert muted.status_code == 400


# ── 其它入口不收 ───────────────────────────────────────────────────────────


def test_websocket_handshakes_refuse_the_impersonation_token(admin_user, target):
    from apps.core.ws_auth import JWTAuthMiddleware

    _, data = _viewing(admin_user, target)
    middleware = JWTAuthMiddleware(None)
    assert middleware._authenticate_token_sync(data["access"]) is None
    assert middleware._authenticate_token_sync(str(AccessToken.for_user(target))).pk == target.pk


def test_notification_consumer_refuses_the_impersonation_token(admin_user, target):
    from apps.notifications.consumers import NotificationConsumer

    _, data = _viewing(admin_user, target)
    authenticate = NotificationConsumer.__dict__["_authenticate_token"].func  # database_sync_to_async 里的同步函数
    assert authenticate(NotificationConsumer(), data["access"]) is None
    assert authenticate(NotificationConsumer(), str(AccessToken.for_user(target))).pk == target.pk


def test_officer_app_endpoints_refuse_the_impersonation_token(admin_user, target):
    viewing, _ = _viewing(admin_user, target)
    response = viewing.get("/api/v1/officer-app/todo/")
    assert response.status_code == 403
    assert officer_client(target).get("/api/v1/officer-app/todo/").status_code != 403


def test_officer_app_views_with_their_own_permission_classes_refuse_it_too(admin_user, target):
    """`SignerCandidatesView` / `CosignView` 覆盖了 `permission_classes`,曾丢掉 `NotImpersonating`(审查 #5)。"""
    viewing, _ = _viewing(admin_user, target)
    for url in ("/api/v1/officer-app/signer-candidates/",
                "/api/v1/officer-app/items/judgment/00000000-0000-0000-0000-000000000000/cosigners/"):
        response = viewing.get(url)
        assert response.status_code == 403 and "代看令牌" in str(response.data.get("detail")), (
            url, response.status_code, response.data)


# ── 管理员自己的会话结束,代看跟着结束(安全审查 2026-10-27 #3) ─────────────────


def test_the_session_dies_when_the_admins_own_sessions_are_ended(admin_user, target):
    from apps.authentication.passwords import end_sessions

    viewing, _ = _viewing(admin_user, target)
    assert viewing.get(PROFILE).status_code == 200
    end_sessions(admin_user)  # 改密码 / 退出全部
    response = viewing.get(PROFILE)
    assert response.status_code == 403 and response.data["code"] == "impersonation_ended"
    assert Impersonation.objects.get(actor=admin_user).ended_at is not None


def test_the_session_dies_when_the_device_that_started_it_is_signed_out(admin_user, target):
    from rest_framework_simplejwt.tokens import RefreshToken

    from apps.authentication import signin_sessions
    from apps.authentication.models import SignInSession

    device = SignInSession.objects.create(user=admin_user, label="laptop")
    refresh = RefreshToken.for_user(admin_user)
    refresh["sid"] = str(device.pk)
    admin = APIClient()
    admin.credentials(HTTP_AUTHORIZATION=f"Bearer {refresh.access_token}")
    response = admin.post(START, {"user_id": target.pk, "reason": "看菜单"}, format="json")
    assert response.status_code == 201, response.content
    viewing = APIClient()
    viewing.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
    assert viewing.get(PROFILE).status_code == 200
    signin_sessions.revoke(device)
    assert viewing.get(PROFILE).status_code == 403
