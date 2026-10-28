"""面容 / 指纹登录的服务端一半 + 打印交付单(2026-10-11,Design 第二十批)。

钉住的东西:凭据只存哈希、开启要当前密码并与密码登录共用计数、登录响应与密码登录同形、
两步验证照常要求、五种吊销时机各带各的原因、转生后旧凭据得到原因而不是「不认识」、
打印交付单不改状态也不带密码。
"""
import time

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.authentication import mfa as core
from apps.soul_accounts import mfa
from apps.soul_accounts import services as svc
from apps.soul_accounts.models import CredentialStatus, InitialCredential, SoulDeviceLogin
from tests.soul_account_support import (
    clear_soul_login_counters,
    dead_soul,
    officer_client,
    provision_with_password,
    ready_soul,
    soul_client,
)

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _diyu_has_a_city_god(cn_tenant):
    """地府开案要有城隍收案(用户 2026-10-29):本殿先有一位兜底城隍。"""
    from tests.city_god_support import default_city_god

    default_city_god(cn_tenant)


PASSWORD = "a-long-test-password-1"
NEW_PASSWORD = "another-long-password-2"

REVOKE = "/api/v1/soul-auth/device-login/revoke/"


@pytest.fixture(autouse=True)
def _fresh_counters():
    clear_soul_login_counters()
    yield
    clear_soul_login_counters()


@pytest.fixture
def soul(cn_tenant):
    account, _ = ready_soul(cn_tenant)
    account.user.set_password(PASSWORD)
    account.user.save(update_fields=["password"])
    return account


def _enable(account, password=PASSWORD):
    response = soul_client(account).post("/api/v1/me/device-login/", {"password": password}, format="json")
    assert response.status_code == 201, response.data
    return response.data["credential"]


def _device_login(account, credential, **extra):
    return APIClient().post("/api/v1/soul-auth/device-login/",
                            {"soul_code": account.soul.soul_code, "credential": credential, **extra}, format="json")


def _password_login(account):
    return APIClient().post("/api/v1/soul-auth/login/",
                            {"soul_code": account.soul.soul_code, "password": PASSWORD}, format="json")


def _enable_mfa(account):
    secret, _ = mfa.begin_setup(account)
    assert mfa.confirm_setup(account, core.totp_at(secret, int(time.time() // core.TOTP_STEP_SECONDS)))[0] == "ok"


def _reasons():
    return sorted(SoulDeviceLogin.objects.values_list("revoked_reason", flat=True))


# ── 开启 / 关闭 ────────────────────────────────────────────────────────────


class TestEnableAndTurnOff:
    def test_enabling_returns_the_credential_once_and_stores_only_a_hash(self, soul):
        credential = _enable(soul)
        row = SoulDeviceLogin.objects.get()
        assert row.account_id == soul.pk and row.revoked_at is None
        assert credential not in row.credential_hash and len(row.credential_hash) == 64
        assert AuditLog.objects.filter(resource="device_login", action="UPDATE").exists()
        assert credential not in "".join(AuditLog.objects.values_list("description", flat=True))

    def test_a_wrong_password_is_refused_and_creates_nothing(self, soul):
        response = soul_client(soul).post("/api/v1/me/device-login/", {"password": "nope"}, format="json")
        assert response.status_code == 400
        assert response.data["code"] == "wrong_password" and response.data["remaining_attempts"] == 4
        assert not SoulDeviceLogin.objects.exists()
        assert soul_client(soul).post("/api/v1/me/device-login/", {}, format="json").data["code"] == "wrong_password"

    def test_wrong_passwords_spend_the_login_budget_and_then_429(self, soul):
        client = soul_client(soul)
        for _ in range(5):
            assert client.post("/api/v1/me/device-login/", {"password": "nope"}, format="json").status_code == 400
        locked = client.post("/api/v1/me/device-login/", {"password": PASSWORD}, format="json")
        assert locked.status_code == 429 and locked.data["code"] == "rate_limited"
        assert not SoulDeviceLogin.objects.exists()
        # 同一份预算:密码登录页也被同一个编号的失败顶满。
        assert _password_login(soul).status_code == 429

    def test_turning_off_revokes_with_turned_off_and_is_idempotent(self, soul):
        credential = _enable(soul)
        client = soul_client(soul)
        assert client.post(REVOKE, {"credential": credential}, format="json").status_code == 204
        assert client.post(REVOKE, {"credential": credential}, format="json").status_code == 204
        assert client.post(REVOKE, {"credential": "unknown"}, format="json").status_code == 204
        assert _reasons() == ["turned_off"]
        refused = _device_login(soul, credential)
        assert refused.status_code == 401
        assert refused.data["code"] == "device_login_revoked" and refused.data["reason"] == "turned_off"

    def test_the_phone_can_turn_it_off_after_signing_out(self, soul):
        """登录页的「换一个账号」:没有令牌,只有凭据。"""
        credential = _enable(soul)
        assert APIClient().post(REVOKE, {"credential": credential}, format="json").status_code == 204
        assert _reasons() == ["turned_off"]

    def test_a_credential_nobody_holds_turns_nothing_off(self, soul):
        _enable(soul)
        assert APIClient().post(REVOKE, {"credential": "not-the-credential"}, format="json").status_code == 204
        assert SoulDeviceLogin.objects.get().revoked_at is None


# ── 登录 ─────────────────────────────────────────────────────────────────


class TestLogin:
    def test_response_has_exactly_the_shape_of_the_password_login(self, soul):
        credential = _enable(soul)
        by_password, by_face = _password_login(soul), _device_login(soul, credential)
        assert by_face.status_code == 200
        assert set(by_face.data) == set(by_password.data) == {"access", "refresh", "soul_code", "account"}
        assert by_face.data["account"] == by_password.data["account"]
        assert soul_client_from(by_face).get("/api/v1/me/").status_code == 200
        assert SoulDeviceLogin.objects.get().last_used_at is not None

    def test_the_code_is_case_and_space_insensitive_like_the_password_login(self, soul):
        credential = _enable(soul)
        response = APIClient().post("/api/v1/soul-auth/device-login/", {
            "soul_code": f" {soul.soul.soul_code.lower()} ", "credential": credential}, format="json")
        assert response.status_code == 200

    def test_two_step_verification_is_still_required(self, soul):
        credential = _enable(soul)
        _enable_mfa(soul)
        response = _device_login(soul, credential)
        assert response.status_code == 200
        assert response.data["mfa_required"] is True and "access" not in response.data
        assert response.data["soul_code"] == soul.soul.soul_code and response.data["home_tenant"]["code"] == "CN_DIYU"
        pending = response.data["pending_token"]
        assert APIClient().post("/api/v1/soul-auth/mfa/verify/", {"pending_token": pending, "code": "000000"},
                                format="json").status_code == 400

    def test_a_remembered_phone_skips_the_second_step(self, soul):
        credential = _enable(soul)
        _enable_mfa(soul)
        device_token = mfa.remember_device(soul)
        response = _device_login(soul, credential, device_token=device_token)
        assert response.status_code == 200 and "access" in response.data

    def test_unknown_credential_and_unknown_code_answer_identically(self, soul):
        real = _device_login(soul, "not-a-credential")
        ghost = APIClient().post("/api/v1/soul-auth/device-login/",
                                 {"soul_code": "ZZZZZZZZZZ", "credential": "not-a-credential"}, format="json")
        assert real.status_code == ghost.status_code == 401
        assert real.data == ghost.data == {"detail": "灵魂编号或凭据错误。", "code": "device_login_invalid"}

    def test_a_credential_only_works_with_its_own_soul_code(self, soul, cn_tenant):
        other, _ = ready_soul(cn_tenant, name="亡魂乙")
        credential = _enable(soul)
        assert _device_login(other, credential).data["code"] == "device_login_invalid"

    def test_guesses_are_counted_with_the_password_login_and_lock_at_five(self, soul):
        credential = _enable(soul)
        for _ in range(5):
            assert _device_login(soul, "guess").status_code == 401
        locked = _device_login(soul, credential)
        assert locked.status_code == 429 and locked.data["code"] == "rate_limited"
        assert _password_login(soul).status_code == 429

    def test_a_revoked_credential_is_not_a_guess_and_does_not_count(self, soul):
        credential = _enable(soul)
        soul_client(soul).post(REVOKE, {"credential": credential}, format="json")
        for _ in range(6):
            assert _device_login(soul, credential).data["code"] == "device_login_revoked"
        assert _password_login(soul).status_code == 200

    def test_failures_and_successes_reach_the_login_log(self, soul):
        from apps.authentication.models import LoginLog

        credential = _enable(soul)
        _device_login(soul, "guess")
        _device_login(soul, credential)
        reasons = list(LoginLog.objects.filter(status="FAILED").values_list("failure_reason", flat=True))
        assert reasons == ["device_login_invalid"]
        assert LoginLog.objects.filter(status="SUCCESS", user=soul.user).count() == 1


def soul_client_from(response):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
    return client


# ── 吊销时机 ───────────────────────────────────────────────────────────────


class TestRevocation:
    def test_changing_the_password_on_this_phone_keeps_this_phones_credential(self, soul):
        mine, theirs = _enable(soul), _enable(soul)
        response = soul_client(soul).post("/api/v1/me/password/", {
            "old_password": PASSWORD, "new_password": NEW_PASSWORD, "device_credential": mine}, format="json")
        assert response.status_code == 200, response.data
        assert _device_login(soul, mine).status_code == 200
        refused = _device_login(soul, theirs)
        assert refused.data["code"] == "device_login_revoked" and refused.data["reason"] == "password_changed"
        assert _reasons() == ["", "password_changed"]

    def test_changing_the_password_without_a_credential_revokes_all(self, soul):
        mine = _enable(soul)
        soul_client(soul).post("/api/v1/me/password/", {"old_password": PASSWORD, "new_password": NEW_PASSWORD},
                               format="json")
        assert _device_login(soul, mine).data["reason"] == "password_changed"

    def test_someone_elses_credential_does_not_save_mine(self, soul, cn_tenant):
        other, _ = ready_soul(cn_tenant, name="亡魂乙")
        other.user.set_password(PASSWORD)
        other.user.save(update_fields=["password"])
        mine, others = _enable(soul), _enable(other)
        soul_client(soul).post("/api/v1/me/password/", {
            "old_password": PASSWORD, "new_password": NEW_PASSWORD, "device_credential": others}, format="json")
        assert _device_login(soul, mine).data["reason"] == "password_changed"
        assert SoulDeviceLogin.objects.get(account=other).revoked_at is None

    def test_a_password_set_elsewhere_revokes_everything(self, soul):
        """邮箱重置走的就是这个函数,不带任何要保留的凭据。"""
        first, second = _enable(soul), _enable(soul)
        svc.set_password_chosen_by_soul(soul, NEW_PASSWORD)
        assert _reasons() == ["password_changed", "password_changed"]
        assert _device_login(soul, first).data["reason"] == "password_changed"
        assert _device_login(soul, second).data["reason"] == "password_changed"

    def test_the_email_reset_endpoint_revokes_everything(self, soul):
        from django.core.cache import cache

        email = "face@example.com"
        soul.user.email = email
        soul.user.save(update_fields=["email"])
        credential = _enable(soul)
        client = APIClient()
        client.post("/api/v1/auth/reset-password/", {"email": email}, format="json")
        res = client.post("/api/v1/auth/set-new-password/", {
            "email": email, "code": cache.get(f"pwd_reset:{email}"), "new_password": NEW_PASSWORD}, format="json")
        assert res.status_code == 200, res.data
        assert _device_login(soul, credential).data["reason"] == "password_changed"

    def test_an_officer_reset_revokes_with_its_own_reason(self, soul, admin_user):
        credential = _enable(soul)
        response = officer_client(admin_user).post(f"/api/v1/soul-accounts/accounts/{soul.pk}/reset-credential/",
                                                   {}, format="json")
        assert response.status_code == 200, response.data
        assert _reasons() == ["password_reset_by_officer"]
        refused = _device_login(soul, credential)
        assert refused.data["code"] == "device_login_revoked"
        assert refused.data["reason"] == "password_reset_by_officer"

    def test_rebirth_revokes_and_the_old_credential_gets_its_reason_not_unknown(self, cn_tenant):
        from apps.reincarnation.services import ReincarnationService
        from apps.souls.models import Soul, SoulState

        soul_row = dead_soul(cn_tenant)
        first, _ = provision_with_password(soul_row)
        first.must_change_password = False
        first.save(update_fields=["must_change_password"])
        first.user.set_password(PASSWORD)
        first.user.save(update_fields=["password"])
        credential = _enable(first)

        Soul.all_objects.filter(pk=soul_row.pk).update(current_state=SoulState.REINCARNATING)
        soul_row.refresh_from_db()
        ReincarnationService.complete_rebirth(soul_row, new_identity="新名字")
        assert _reasons() == ["account_reincarnated"]
        # 新一世开号之前、之后,同一条凭据答的都是转生。
        refused = _device_login(first, credential)
        assert refused.status_code == 401 and refused.data["reason"] == "account_reincarnated"
        soul_row.refresh_from_db()
        soul_row.die()
        second = svc.current_account_of(soul_row)
        assert second.pk != first.pk
        refused = _device_login(first, credential)
        assert refused.data["code"] == "device_login_revoked" and refused.data["reason"] == "account_reincarnated"

    def test_a_remembered_phone_of_the_old_life_does_not_carry_to_the_new_one(self, cn_tenant):
        from apps.reincarnation.services import ReincarnationService
        from apps.souls.models import Soul, SoulState

        soul_row = dead_soul(cn_tenant)
        first, _ = provision_with_password(soul_row)
        old_token = mfa.remember_device(first)
        Soul.all_objects.filter(pk=soul_row.pk).update(current_state=SoulState.REINCARNATING)
        soul_row.refresh_from_db()
        ReincarnationService.complete_rebirth(soul_row, new_identity="新名字")
        soul_row.refresh_from_db()
        soul_row.die()
        second = svc.current_account_of(soul_row)
        _enable_mfa(second)
        assert mfa.device_remembered(second, old_token) is False

    def test_a_credential_on_a_retired_account_that_was_never_marked_still_answers_reincarnated(self, soul):
        credential = _enable(soul)
        SoulDeviceLogin.objects.update(revoked_at=None, revoked_reason="")
        type(soul).objects.filter(pk=soul.pk).update(retired_at=timezone.now())
        assert _device_login(soul, credential).data["reason"] == "account_reincarnated"


# ── 打印交付单 ─────────────────────────────────────────────────────────────


class TestPrintSlip:
    def _credential(self, cn_tenant):
        account, password = provision_with_password(dead_soul(cn_tenant))
        return account, InitialCredential.objects.get(account=account), password

    def _print(self, user, credential):
        return officer_client(user).post(f"/api/v1/soul-accounts/credentials/{credential.pk}/print-slip/")

    @pytest.mark.parametrize("status", [CredentialStatus.PENDING, CredentialStatus.REVEALED, CredentialStatus.DELIVERED])
    def test_printable_statuses_print_without_changing_anything(self, cn_tenant, admin_user, status):
        account, credential, _ = self._credential(cn_tenant)
        InitialCredential.objects.filter(pk=credential.pk).update(status=status, last_error="smtp down")
        before = InitialCredential.objects.values().get(pk=credential.pk)
        response = self._print(admin_user, credential)
        assert response.status_code == 200, response.data
        assert InitialCredential.objects.values().get(pk=credential.pk) == before
        assert set(response.data) == {"soul_name", "soul_code", "home_tenant", "expires_at", "officer_name", "printed_at"}
        assert response.data["soul_code"] == account.soul.soul_code and response.data["soul_name"] == account.soul.name
        assert response.data["home_tenant"]["code"] == "CN_DIYU"
        assert response.data["officer_name"] == (admin_user.display_name or admin_user.username)
        assert response["Cache-Control"] == "no-store"

    def test_the_response_never_contains_the_password(self, cn_tenant, admin_user):
        _, credential, password = self._credential(cn_tenant)
        assert credential.secret == password and len(password) >= 12
        assert password.encode() not in self._print(admin_user, credential).content  # 待交付:明文还在库里
        officer_client(admin_user).post(f"/api/v1/soul-accounts/credentials/{credential.pk}/reveal/")
        assert password.encode() not in self._print(admin_user, credential).content  # 已查看
        assert "password" not in self._print(admin_user, credential).data

    def test_printing_is_audited_without_a_reason_or_the_password(self, cn_tenant, admin_user):
        _, credential, password = self._credential(cn_tenant)
        assert self._print(admin_user, credential).status_code == 200
        row = AuditLog.objects.get(resource="soul_account", changes__action="credentials.print_slip")
        assert row.user == admin_user and row.action == "EXECUTE" and row.resource_id == str(credential.pk)
        assert password not in row.description and password not in str(row.changes)

    @pytest.mark.parametrize("status,code", [(CredentialStatus.VOID, "credential_void"),
                                             (CredentialStatus.SENT, "credential_not_printable"),
                                             (CredentialStatus.QUEUED, "credential_not_printable")])
    def test_other_statuses_are_409_and_leave_no_audit_row(self, cn_tenant, admin_user, status, code):
        _, credential, _ = self._credential(cn_tenant)
        InitialCredential.objects.filter(pk=credential.pk).update(status=status)
        response = self._print(admin_user, credential)
        assert response.status_code == 409 and response.data["code"] == code
        assert not AuditLog.objects.filter(changes__action="credentials.print_slip").exists()

    @pytest.mark.parametrize("status", [CredentialStatus.PENDING, CredentialStatus.DELIVERED])
    def test_an_expired_slip_is_409_even_when_the_row_was_not_yet_voided(self, cn_tenant, admin_user, status):
        _, credential, _ = self._credential(cn_tenant)
        InitialCredential.objects.filter(pk=credential.pk).update(status=status, expires_at=timezone.now())
        response = self._print(admin_user, credential)
        assert response.status_code == 409
        assert response.data["code"] in ("credential_expired", "credential_void")

    def test_it_needs_the_same_permission_and_tenant_scope_as_reveal(self, cn_tenant, eu_tenant, admin_user,
                                                                      judge_user):
        from apps.authentication.models import User

        _, credential, _ = self._credential(cn_tenant)
        eu_moderator = User.objects.create_user(username="eu-mod", password="x", role="MODERATOR", tenant=eu_tenant)
        for user in (judge_user, eu_moderator):  # reveal 被拒时不会动状态,可以拿来对照
            refused = officer_client(user).post(f"/api/v1/soul-accounts/credentials/{credential.pk}/reveal/")
            assert refused.status_code in (403, 404)
            assert self._print(user, credential).status_code == refused.status_code
        other, _ = ready_soul(cn_tenant, name="乙")
        assert soul_client(other).post(
            f"/api/v1/soul-accounts/credentials/{credential.pk}/print-slip/").status_code in (401, 403)
        assert not AuditLog.objects.filter(changes__action="credentials.print_slip").exists()
        assert self._print(admin_user, credential).status_code == 200
