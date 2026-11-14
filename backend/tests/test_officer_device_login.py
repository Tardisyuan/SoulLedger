"""官员 App 的指纹登录(2026-11-15 便捷度研究 O5;灵魂端 `test_soul_device_login.py` 的同形)。

钉住的东西:凭据只存哈希、开启要当前密码、登录响应与密码登录同形且是官员 App 的短令牌、
两步验证照常、别人的凭据配这个用户名(含别殿)不认、停用的账号不认;改密码(这台留着)/ 重置 / 强退这个人 /
停用 / 退出某一台 / 退出其他全部 / 这部手机自己关,各自让凭据失效并说原因;本人「退出登录」不让它失效。
"""
import pytest
from django.core.cache import cache
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication import signin_sessions
from apps.authentication.device_login import _hash_device
from apps.authentication.models import OfficerDeviceLogin, SignInSession
from apps.authentication.passwords import end_sessions

pytestmark = pytest.mark.django_db

OFFICER_LOGIN = "/api/v1/auth/officer-login/"
DEVICE_LOGIN = "/api/v1/auth/officer-device-login/"
ENABLE = "/api/v1/auth/device-login/enable/"
REVOKE = "/api/v1/auth/device-login/revoke/"
CHANGE = "/api/v1/auth/change-password/"
LOGOUT = "/api/v1/auth/logout/"
PASSWORD = "OldPass!123-x"
NEW = "N0t-Guessable!2026-b"

_ip = iter(range(10, 250))


@pytest.fixture(autouse=True)
def _clean():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def officer(django_user_model, cn_tenant):
    return django_user_model.objects.create_user(
        username="finger", email="finger@example.com", password=PASSWORD, role="JUDGE", tenant=cn_tenant)


def _client():
    return APIClient(REMOTE_ADDR=f"198.51.100.{next(_ip)}")


def _sign_in(username="finger", password=PASSWORD):
    res = _client().post(OFFICER_LOGIN, {"username": username, "password": password}, format="json")
    assert res.status_code == 200, res.content
    return res.data


def _as(tokens):
    c = _client()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    return c


def _enable(tokens, password=PASSWORD):
    return _as(tokens).post(ENABLE, {"password": password}, format="json")


def _device_login(credential, username="finger"):
    return _client().post(DEVICE_LOGIN, {"username": username, "credential": credential}, format="json")


def _session(tokens):
    return signin_sessions.session_of(RefreshToken(tokens["refresh"]))


def _on(officer):
    tokens = _sign_in()
    res = _enable(tokens)
    assert res.status_code == 201, res.content
    return tokens, res.data["credential"]


class TestEnable:
    def test_the_current_password_issues_a_credential_kept_only_as_a_hash(self, officer):
        tokens, credential = _on(officer)
        row = OfficerDeviceLogin.objects.get()
        assert row.user == officer and row.credential_hash == _hash_device(credential) != credential
        assert row.session == _session(tokens) and row.revoked_at is None

    def test_a_wrong_password_is_refused_and_counted_and_issues_nothing(self, officer):
        res = _enable(_sign_in(), password="wrong-one")
        assert res.status_code == 400 and res.data["code"] == "wrong_password"
        assert res.data["remaining_attempts"] == 4
        assert not OfficerDeviceLogin.objects.exists()

    def test_signed_out_callers_cannot_enable(self, officer):
        assert _client().post(ENABLE, {"password": PASSWORD}, format="json").status_code == 401
        assert not OfficerDeviceLogin.objects.exists()


class TestSignIn:
    def test_the_credential_signs_in_like_the_password_with_the_app_lifetime(self, officer):
        _, credential = _on(officer)
        res = _device_login(credential)
        assert res.status_code == 200, res.content
        assert set(res.data) == set(_sign_in())  # access / refresh / user, nothing more or less
        token = RefreshToken(res.data["refresh"])
        assert token.payload.get("officer_app") is True
        session = signin_sessions.session_of(token)
        assert session.method == "face"
        row = OfficerDeviceLogin.objects.get()
        assert row.session == session and row.last_used_at is not None

    def test_two_step_verification_is_still_asked_and_the_second_step_binds_the_session(self, officer, monkeypatch):
        from apps.authentication import mfa
        from tests.test_officer_mfa import _enable as enable_mfa

        _, credential = _on(officer)
        enable_mfa(officer)
        first = _device_login(credential)
        assert first.status_code == 200 and first.data["mfa_required"] is True and "access" not in first.data
        monkeypatch.setattr(mfa, "verify_login_code", lambda *a, **k: {"code": "ok"})
        done = _client().post("/api/v1/auth/mfa/verify/", {"pending_token": first.data["pending_token"], "code": "123456"},
                              format="json")
        assert done.status_code == 200, done.content
        session = signin_sessions.session_of(RefreshToken(done.data["refresh"]))
        assert session.method == "face" and OfficerDeviceLogin.objects.get().session == session

    def test_an_unknown_credential_and_another_officers_username_are_the_same_refusal(
            self, officer, django_user_model, eu_tenant):
        _, credential = _on(officer)
        django_user_model.objects.create_user(username="elsewhere", password=PASSWORD, role="JUDGE", tenant=eu_tenant)
        for res in (_device_login("not-a-credential"), _device_login(credential, username="elsewhere")):
            assert res.status_code == 401 and res.data["code"] == "device_login_invalid"
            assert "access" not in res.data

    def test_a_deactivated_account_cannot_sign_in(self, officer):
        _, credential = _on(officer)
        type(officer).objects.filter(pk=officer.pk).update(is_active=False)
        res = _device_login(credential)
        assert res.status_code == 401 and res.data["code"] == "device_login_invalid"

    def test_wrong_credentials_spend_the_password_login_budget(self, officer):
        client = APIClient(REMOTE_ADDR="198.51.100.250")
        for _ in range(5):
            client.post(DEVICE_LOGIN, {"username": "finger", "credential": "guess"}, format="json")
        assert client.post(DEVICE_LOGIN, {"username": "finger", "credential": "guess"}, format="json").status_code == 429
        assert client.post(OFFICER_LOGIN, {"username": "finger", "password": PASSWORD}, format="json").status_code == 429


def _refused_because(credential, reason):
    res = _device_login(credential)
    assert res.status_code == 401, res.content
    assert (res.data["code"], res.data["reason"]) == ("device_login_revoked", reason)


class TestInvalidation:
    def test_signing_out_here_keeps_it(self, officer):
        tokens, credential = _on(officer)
        assert _as(tokens).post(LOGOUT, {"refresh": tokens["refresh"]}, format="json").status_code == 200
        assert _device_login(credential).status_code == 200

    def test_a_password_change_on_another_device_ends_it(self, officer):
        _, credential = _on(officer)
        other = _sign_in()
        res = _as(other).post(CHANGE, {"old_password": PASSWORD, "new_password": NEW, "refresh": other["refresh"]},
                              format="json")
        assert res.status_code == 200, res.content
        _refused_because(credential, "password_changed")

    def test_a_password_change_on_this_device_keeps_this_one(self, officer):
        tokens, credential = _on(officer)
        res = _as(tokens).post(CHANGE, {"old_password": PASSWORD, "new_password": NEW, "refresh": tokens["refresh"]},
                               format="json")
        assert res.status_code == 200, res.content
        assert _device_login(credential).status_code == 200

    def test_a_reset_a_forced_sign_out_of_the_person_and_deactivation_end_it(self, officer):
        """邮箱重置、管理员重置、管理员强退这个人、停用、两步验证被管理员重置:全部经 `end_sessions`。"""
        _, credential = _on(officer)
        end_sessions(officer)
        _refused_because(credential, "password_changed")

    def test_deactivation_through_the_users_endpoint_ends_it(self, officer, admin_user):
        from tests.soul_account_support import officer_client

        _, credential = _on(officer)
        res = officer_client(admin_user).patch(f"/api/v1/users/{officer.pk}/", {"is_active": False}, format="json")
        assert res.status_code == 200, res.content
        assert OfficerDeviceLogin.objects.get().revoked_reason == "password_changed"

    def test_signing_that_device_out_ends_it_and_only_it(self, officer):
        tokens, credential = _on(officer)
        other_tokens, other_credential = _on(officer)
        signin_sessions.revoke(_session(tokens))
        _refused_because(credential, "signed_out")
        assert _device_login(other_credential).status_code == 200

    def test_signing_out_all_others_ends_theirs_and_keeps_this_one(self, officer):
        tokens, credential = _on(officer)
        mine, kept = _on(officer)
        res = _as(mine).post("/api/v1/auth/sessions/revoke-others/", format="json")
        assert res.status_code == 200, res.content
        _refused_because(credential, "signed_out")
        assert _device_login(kept).status_code == 200

    def test_turning_it_off_needs_only_the_credential_and_is_idempotent(self, officer):
        _, credential = _on(officer)
        for _ in range(2):
            assert _client().post(REVOKE, {"credential": credential}, format="json").status_code == 204
        assert _client().post(REVOKE, {"credential": "unknown"}, format="json").status_code == 204
        _refused_because(credential, "turned_off")
        assert SignInSession.objects.filter(user=officer).exists()  # the sessions themselves untouched
