"""管理员账号操作加固(2026-10-29 用户决定第 8、9、15 条;rbac-be3 H-2 / M-2 / M-3 / L-6 / L-11)。

- 第 8 条:对另一位 ADMIN 的重置密码 / 重置两步验证 / 停用 / 删除 / 改资料或角色,只许没绑殿的 ADMIN,
  且带操作人自己的第二因素(与关闭两步验证同一把锁)。重置密码不回明文,改发 24 小时一次性设置链接。
- 第 9 条:停用 = 退出全部设备;`PATCH is_active=false` 与 DELETE 收口到同一套(交接闸 409、收尾),不能删 / 停自己。
- 第 15 条:代看期间的读请求不替被看的人留下痕迹。
- L-6:退出只拉黑本人的刷新令牌。L-11:Django admin 改角色 / 密码同样结束会话。
"""
import time

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from apps.authentication import mfa, officer_invite
from apps.authentication.models import OfficerMfa, SignInSession, User
from apps.officer_app.models import OfficerPushDevice
from tests.test_password_change_ends_other_sessions import OLD, _get, _login, _refresh

pytestmark = pytest.mark.django_db

USERS = "/api/v1/users/"
ACCEPT = "/api/v1/auth/officer-invite/accept/"
NEW = "N0t-Guessable!2026-b"


@pytest.fixture(autouse=True)
def _clean():
    cache.clear()
    yield
    cache.clear()


def _client(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


def _enable_mfa(user):
    row = mfa.begin_setup(user)
    outcome, codes = mfa.confirm_setup(row, mfa.totp_at(row.secret, int(time.time() // mfa.TOTP_STEP_SECONDS)))
    assert outcome == "ok"
    mfa.complete_setup(row)
    row.last_step = None  # setup used this window; a code in the same 30 s would read as a replay
    row.save(update_fields=["last_step"])
    return row, codes


def _code(row, delta=0):
    return mfa.totp_at(row.secret, int(time.time() // mfa.TOTP_STEP_SECONDS) + delta)


def _wrong(row):
    near = {_code(row, d) for d in (-4, -3, -2, -1, 0, 1)}
    return next(c for c in ("000000", "111111", "222222") if c not in near)


@pytest.fixture
def hall_admin(django_user_model, cn_tenant):
    return django_user_model.objects.create_user(username="hall_admin", password=OLD, role="ADMIN", tenant=cn_tenant)


@pytest.fixture
def other_admin(django_user_model, cn_tenant):
    return django_user_model.objects.create_user(
        username="other_admin", email="other@example.com", password=OLD, role="ADMIN", tenant=cn_tenant)


@pytest.fixture
def officer(django_user_model, cn_tenant):
    return django_user_model.objects.create_user(
        username="two_devices", email="two@example.com", password=OLD, role="JUDGE", tenant=cn_tenant)


def _admin_actions(target):
    pk = target.pk
    return [
        ("post", f"{USERS}{pk}/reset_password/", {}),
        ("post", f"{USERS}{pk}/reset-mfa/", {"reason": "lost phone"}),
        ("post", f"{USERS}{pk}/deactivate/", {}),
        ("delete", f"{USERS}{pk}/", {}),
        ("post", f"{USERS}{pk}/assign_roles/", {"role": "JUDGE"}),
        ("patch", f"{USERS}{pk}/", {"email": "taken@example.com"}),
    ]


def _call(client, method, url, body):
    return getattr(client, method)(url, body, format="json")


class TestAdminOnAdmin:
    def test_a_hall_admin_may_not_act_on_another_admin_of_its_hall(self, hall_admin, other_admin):
        _enable_mfa(other_admin)
        row, _ = _enable_mfa(hall_admin)
        from tests.soul_account_support import officer_client

        c = officer_client(hall_admin)  # a hall-bound user needs its hall claim
        for method, url, body in _admin_actions(other_admin):
            res = _call(c, method, url, {**body, "mfa_code": _code(row)})
            assert res.status_code == 403 and res.data["code"] == "admin_target_global_only", (url, res.data)
        other_admin.refresh_from_db()
        assert other_admin.is_active and other_admin.role == "ADMIN" and other_admin.check_password(OLD)
        assert other_admin.email == "other@example.com" and mfa.is_enabled(other_admin)

    def test_the_global_admin_needs_its_own_second_factor_turned_on(self, admin_user, other_admin):
        for method, url, body in _admin_actions(other_admin):
            res = _call(_client(admin_user), method, url, body)
            assert res.status_code == 403 and res.data["code"] == "second_factor_unavailable", (url, res.data)
        other_admin.refresh_from_db()
        assert other_admin.is_active and other_admin.check_password(OLD)

    def test_without_a_code_it_is_refused_and_nothing_changes(self, admin_user, other_admin):
        _enable_mfa(admin_user)
        for method, url, body in _admin_actions(other_admin):
            res = _call(_client(admin_user), method, url, body)
            assert res.status_code == 403 and res.data["code"] == "second_factor_required", (url, res.data)
        other_admin.refresh_from_db()
        assert other_admin.is_active and other_admin.role == "ADMIN" and other_admin.check_password(OLD)

    def test_wrong_codes_count_toward_the_same_lock_as_turning_mfa_off(self, admin_user, other_admin):
        row, _ = _enable_mfa(admin_user)
        url = f"{USERS}{other_admin.pk}/reset_password/"
        for left in range(mfa.MFA_MAX_ATTEMPTS - 1, 0, -1):
            res = _client(admin_user).post(url, {"mfa_code": _wrong(row)}, format="json")
            assert res.status_code == 400 and res.data["remaining_attempts"] == left, res.data
        res = _client(admin_user).post(url, {"mfa_code": _wrong(row)}, format="json")
        assert res.status_code == 429 and res.data["code"] == "locked"
        # Locked: even the right code is refused now, and the lock is the one `disable` reads.
        res = _client(admin_user).post(url, {"mfa_code": _code(row)}, format="json")
        assert res.status_code == 429
        assert OfficerMfa.objects.get(user=admin_user).locked_until > timezone.now()
        other_admin.refresh_from_db()
        assert other_admin.check_password(OLD)

    def test_with_its_own_code_the_global_admin_may_reset_another_admin(self, admin_user, other_admin):
        row, codes = _enable_mfa(admin_user)
        res = _client(admin_user).post(f"{USERS}{other_admin.pk}/reset_password/", {"mfa_code": _code(row)},
                                       format="json")
        assert res.status_code == 200, res.data
        other_admin.refresh_from_db()
        assert not other_admin.has_usable_password()
        # A recovery code works too, and is spent.
        res = _client(admin_user).post(f"{USERS}{other_admin.pk}/assign_roles/",
                                       {"role": "MODERATOR", "mfa_method": "recovery", "mfa_code": codes[0]},
                                       format="json")
        assert res.status_code == 200, res.data
        assert row.recovery_codes.filter(used_at__isnull=False).count() == 1

    def test_a_non_admin_target_needs_no_code(self, admin_user, officer):
        res = _client(admin_user).post(f"{USERS}{officer.pk}/assign_roles/", {"role": "GUARDIAN"}, format="json")
        assert res.status_code == 200, res.data
        officer.refresh_from_db()
        assert officer.role == "GUARDIAN"


class TestResetLink:
    def test_the_link_sets_a_password_once(self, admin_user, officer):
        device = _login()
        _ = OfficerPushDevice.objects.create(user=officer, token="T-1", platform="IOS", last_seen_at=timezone.now())
        res = _client(admin_user).post(f"{USERS}{officer.pk}/reset_password/")
        assert res.status_code == 200 and "password" not in res.data
        assert _get(device["access"]) == 401 and _refresh(device["refresh"]) == 401
        assert not OfficerPushDevice.objects.filter(user=officer).exists()

        query = res.data["link"].split("?", 1)[1]
        params = dict(p.split("=", 1) for p in query.split("&"))
        from urllib.parse import unquote

        body = {"uid": params["uid"], "token": unquote(params["token"]), "new_password": NEW}
        assert params["kind"] == "reset"
        first = APIClient().post(ACCEPT, body, format="json")
        assert first.status_code == 200, first.data
        officer.refresh_from_db()
        assert officer.check_password(NEW) and officer.must_change_password is False
        assert not officer.email_verified  # the admin handed the link over; it proves no mailbox
        again = APIClient().post(ACCEPT, {**body, "new_password": "An0ther-Pass!2026"}, format="json")
        assert again.status_code == 400 and again.data["code"] == "invite_link_invalid"

    def test_the_link_expires_after_a_day_and_an_invite_token_is_not_one(self, admin_user, officer, monkeypatch):
        _client(admin_user).post(f"{USERS}{officer.pk}/reset_password/")
        officer.refresh_from_db()
        token = officer_invite.setup_tokens.make_token(officer)
        assert officer_invite.setup_tokens.check_token(officer, token)
        later = officer_invite.setup_tokens._num_seconds(officer_invite.setup_tokens._now()) + 24 * 3600 + 5
        monkeypatch.setattr(officer_invite.SetupLinkTokenGenerator, "_num_seconds", lambda self, dt: later)
        assert not officer_invite.setup_tokens.check_token(officer, token)
        # Different salt: an invite token does not open the reset link, nor the other way round.
        assert not officer_invite.invite_tokens.check_token(officer, officer_invite.setup_tokens.make_token(officer))

    def test_a_second_reset_voids_the_first_link(self, admin_user, officer):
        first = _client(admin_user).post(f"{USERS}{officer.pk}/reset_password/").data["link"]
        _client(admin_user).post(f"{USERS}{officer.pk}/reset_password/")
        params = dict(p.split("=", 1) for p in first.split("?", 1)[1].split("&"))
        from urllib.parse import unquote

        res = APIClient().post(ACCEPT, {"uid": params["uid"], "token": unquote(params["token"]), "new_password": NEW},
                               format="json")
        assert res.status_code == 400


class TestDeactivationEndsEverything:
    def _assert_out(self, officer, device):
        assert _get(device["access"]) == 401
        assert not OfficerPushDevice.objects.filter(user=officer).exists()
        assert not SignInSession.objects.filter(user=officer, revoked_at__isnull=True).exists()
        # Re-activation must not bring the old devices back (M-3).
        User.all_objects.filter(pk=officer.pk).update(is_active=True, is_deleted=False)
        assert _refresh(device["refresh"]) == 401

    def _signed_in(self, officer):
        device = _login()
        OfficerPushDevice.objects.create(user=officer, token="T-1", platform="IOS", last_seen_at=timezone.now())
        assert SignInSession.objects.filter(user=officer, revoked_at__isnull=True).exists()
        return device

    def test_deactivate(self, admin_user, officer):
        device = self._signed_in(officer)
        assert _client(admin_user).post(f"{USERS}{officer.pk}/deactivate/").status_code == 200
        self._assert_out(officer, device)

    def test_batch_deactivate(self, admin_user, officer):
        device = self._signed_in(officer)
        res = _client(admin_user).post(f"{USERS}batch_deactivate/", {"user_ids": [officer.pk]}, format="json")
        assert res.status_code == 200 and res.data["updated"] == 1
        self._assert_out(officer, device)

    def test_patch_is_active_false(self, admin_user, officer):
        device = self._signed_in(officer)
        res = _client(admin_user).patch(f"{USERS}{officer.pk}/", {"is_active": False}, format="json")
        assert res.status_code == 200, res.data
        self._assert_out(officer, device)

    def test_delete(self, admin_user, officer):
        device = self._signed_in(officer)
        assert _client(admin_user).delete(f"{USERS}{officer.pk}/").status_code == 204
        assert not User.objects.filter(pk=officer.pk).exists()
        self._assert_out(officer, device)

    def test_a_patch_that_keeps_the_account_active_signs_nobody_out(self, admin_user, officer):
        device = self._signed_in(officer)
        res = _client(admin_user).patch(f"{USERS}{officer.pk}/", {"position": "录事"}, format="json")
        assert res.status_code == 200
        assert _get(device["access"]) == 200 and OfficerPushDevice.objects.filter(user=officer).exists()

    def test_open_work_holds_patch_and_delete_like_deactivate(self, admin_user, officer, monkeypatch):
        from apps.authentication import views

        monkeypatch.setattr(views, "_open_work", lambda user: {"judgments": 2})
        for method, url, body in [("patch", f"{USERS}{officer.pk}/", {"is_active": False}),
                                  ("delete", f"{USERS}{officer.pk}/", {})]:
            res = _call(_client(admin_user), method, url, body)
            assert res.status_code == 409 and res.data["code"] == "officer_has_open_work", url
        officer.refresh_from_db()
        assert officer.is_active and not officer.is_deleted

    def test_nobody_deletes_or_deactivates_themselves(self, admin_user):
        for method, url, body, code in [
            ("delete", f"{USERS}{admin_user.pk}/", {}, "cannot_delete_self"),
            ("post", f"{USERS}{admin_user.pk}/deactivate/", {}, "cannot_deactivate_self"),
            ("patch", f"{USERS}{admin_user.pk}/", {"is_active": False}, "cannot_deactivate_self"),
        ]:
            res = _call(_client(admin_user), method, url, body)
            assert res.status_code == 400 and res.data["code"] == code, url
        admin_user.refresh_from_db()
        assert admin_user.is_active and not admin_user.is_deleted


class TestLogoutOnlyEndsOwnToken:
    def test_someone_elses_refresh_token_is_refused_and_stays_valid(self, officer, django_user_model, cn_tenant):
        victim = _login()
        intruder = django_user_model.objects.create_user(username="intruder", password=OLD, role="JUDGE",
                                                         tenant=cn_tenant)
        res = _client(intruder).post("/api/v1/auth/logout/", {"refresh": victim["refresh"]}, format="json")
        assert res.status_code == 400
        assert _refresh(victim["refresh"]) == 200

    def test_own_token_is_blacklisted(self, officer):
        device = _login()
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {device['access']}")
        assert c.post("/api/v1/auth/logout/", {"refresh": device["refresh"]}, format="json").status_code == 200
        assert _refresh(device["refresh"]) == 401


class TestDjangoAdminEndsSessions:
    def test_changing_the_role_in_the_admin_signs_the_user_out(self, officer, admin_user):
        from django.contrib import admin as django_admin
        from django.test import RequestFactory

        device = _login()
        model_admin = django_admin.site._registry[User]
        request = RequestFactory().post("/admin/")
        request.user = admin_user
        officer.role = "VIEWER"

        class Form:
            changed_data = ["role"]

        model_admin.save_model(request, officer, Form(), change=True)
        assert _get(device["access"]) == 401 and _refresh(device["refresh"]) == 401

    def test_an_unrelated_admin_edit_keeps_the_sessions(self, officer, admin_user):
        from django.contrib import admin as django_admin
        from django.test import RequestFactory

        device = _login()
        request = RequestFactory().post("/admin/")
        request.user = admin_user
        officer.first_name = "Meng"

        class Form:
            changed_data = ["first_name"]

        django_admin.site._registry[User].save_model(request, officer, Form(), change=True)
        assert _get(device["access"]) == 200


class TestImpersonatedReadsLeaveNoTrace:
    def test_viewing_as_someone_does_not_create_their_social_profile(self, admin_user, officer):
        from apps.social.models import UserProfile
        from tests.soul_account_support import officer_client

        start = officer_client(admin_user).post("/api/v1/auth/impersonate/", {"user_id": officer.pk, "reason": "x"},
                                                format="json")
        assert start.status_code == 201, start.content
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {start.data['access']}")
        res = c.get("/api/v1/social/profiles/me/")
        assert res.status_code == 200, res.content
        assert not UserProfile.objects.filter(user=officer).exists()
        # Control: the officer's own read does create it.
        assert officer_client(officer).get("/api/v1/social/profiles/me/").status_code == 200
        assert UserProfile.objects.filter(user=officer).exists()

    def test_reading_letters_as_someone_writes_no_audit_and_no_reconcile(self, monkeypatch):
        from types import SimpleNamespace

        from apps.chat import services

        calls = []
        fake = SimpleNamespace(service_user="@svc:x", recent_messages=lambda room, limit: [],
                               messages_before=lambda *a, **k: [])
        monkeypatch.setattr(services, "get_client", lambda: fake)
        monkeypatch.setattr(services, "reconcile_inbox", lambda *a: calls.append("reconcile"))
        monkeypatch.setattr(services, "audit", lambda *a, **k: calls.append("audit"))
        monkeypatch.setattr("apps.chat.images.officer_views", lambda *a, **k: {})
        conversation = SimpleNamespace(soul_a=None, room_id="!r")
        monkeypatch.setattr(services.ChatIdentity.objects, "filter", lambda **k: SimpleNamespace(
            select_related=lambda *a: []))

        services.officer_messages(conversation, None, request=SimpleNamespace(impersonation=object()))
        assert calls == []
        services.officer_messages(conversation, None, request=SimpleNamespace())
        assert calls == ["reconcile", "audit"]
