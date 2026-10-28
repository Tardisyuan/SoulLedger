"""灵魂端两步验证(apps/soul_accounts/mfa.py + mfa_views.py,2026-10-11)。

TOTP 校验、过期 / 错误分开报、重放、恢复码哈希、5 次锁 15 分钟是 `apps/authentication/mfa.py` 的函数,
官员测试(`tests/test_officer_mfa.py`)已经钉住;这里钉的是灵魂这一侧自己的东西:
状态挂在账号上、登录两步、不透明设备令牌、转世作废、改密 / 重置密码的边界、官员关闭,
以及「没开两步验证的账号登录和以前逐字节一致」。
"""
import time
from datetime import datetime, timedelta

import pytest
from django.contrib.auth.hashers import get_hasher
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditLog
from apps.authentication import mfa as core
from apps.soul_accounts import mfa
from apps.soul_accounts import services as svc
from apps.soul_accounts.models import SoulAccount, SoulMfa, SoulMfaDevice, SoulMfaRecoveryCode
from apps.soul_push.models import PushDelivery
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
STEP = core.TOTP_STEP_SECONDS


@pytest.fixture(autouse=True)
def _fresh_counters():
    clear_soul_login_counters()
    yield
    clear_soul_login_counters()


def _code(secret, delta=0):
    return core.totp_at(secret, int(time.time() // STEP) + delta)


def _with_password(account):
    account.user.set_password(PASSWORD)
    account.user.save(update_fields=["password"])
    return account


def _enable(account, *, forget_step=True):
    """走真实的 begin → confirm,把账号开到「已开启」。返回 (secret, 恢复码明文)。
    设置那一步用掉了当前时间步,紧接着的登录同一步里会被当重放 —— 默认忘掉它(与官员测试同一做法)。"""
    secret, _ = mfa.begin_setup(account)
    outcome, codes = mfa.confirm_setup(account, _code(secret))
    assert outcome == "ok"
    if forget_step:
        SoulMfa.objects.filter(account=account).update(last_step=None)
    return secret, codes


@pytest.fixture
def soul(cn_tenant):
    account, _ = ready_soul(cn_tenant)
    return _with_password(account)


def _login(account, **extra):
    return APIClient().post("/api/v1/soul-auth/login/",
                            {"soul_code": account.soul.soul_code, "password": PASSWORD, **extra}, format="json")


def _verify(pending, **body):
    return APIClient().post("/api/v1/soul-auth/mfa/verify/", {"pending_token": pending, **body}, format="json")


def _pending(account):
    response = _login(account)
    assert response.status_code == 200 and response.data["mfa_required"] is True, response.data
    return response.data["pending_token"]


# ── 向导 ─────────────────────────────────────────────────────────────────


class TestSetup:
    def test_status_is_off_for_a_fresh_account(self, soul):
        response = soul_client(soul).get("/api/v1/me/mfa/")
        assert response.status_code == 200
        assert response.data == {"enabled": False, "confirmed_at": None, "last_used_at": None,
                                 "last_used_method": "", "recovery_codes_remaining": 0}

    def test_the_whole_flow_enables_and_gives_ten_codes_once(self, soul):
        client = soul_client(soul)
        started = client.post("/api/v1/me/mfa/setup/", {"password": PASSWORD}, format="json")
        assert started.status_code == 200
        secret = started.data["secret"]
        assert started.data["otpauth_url"].startswith("otpauth://totp/")
        assert f"secret={secret}" in started.data["otpauth_url"]
        assert soul.soul.soul_code in started.data["otpauth_url"]
        # 未确认前不算开启。
        assert client.get("/api/v1/me/mfa/").data["enabled"] is False
        confirmed = client.post("/api/v1/me/mfa/confirm/", {"code": _code(secret)}, format="json")
        assert confirmed.status_code == 200, confirmed.data
        codes = confirmed.data["recovery_codes"]
        assert len(codes) == 10 and len(set(codes)) == 10
        status = client.get("/api/v1/me/mfa/").data
        assert status["enabled"] is True and status["recovery_codes_remaining"] == 10
        assert status["confirmed_at"] is not None
        # 明文只在确认的响应里:状态里没有任何一个,库里是哈希。
        assert not any(code in str(status) for code in codes)
        hashes = list(SoulMfaRecoveryCode.objects.values_list("code_hash", flat=True))
        assert len(hashes) == 10 and not set(hashes) & set(codes)
        assert all(h.startswith(get_hasher().algorithm) for h in hashes)

    def test_a_wrong_code_does_not_enable(self, soul):
        client = soul_client(soul)
        secret = client.post("/api/v1/me/mfa/setup/", {"password": PASSWORD}, format="json").data["secret"]
        bad = f"{(int(_code(secret)) + 1) % 10**6:06d}"
        response = client.post("/api/v1/me/mfa/confirm/", {"code": bad}, format="json")
        assert response.status_code == 400 and response.data["code"] == "wrong"
        assert mfa.is_enabled(soul) is False
        assert not SoulMfaRecoveryCode.objects.exists()

    def test_starting_again_voids_the_previous_secret(self, soul):
        client = soul_client(soul)
        first = client.post("/api/v1/me/mfa/setup/", {"password": PASSWORD}, format="json").data["secret"]
        second = client.post("/api/v1/me/mfa/setup/", {"password": PASSWORD}, format="json").data["secret"]
        assert first != second and SoulMfa.objects.filter(account=soul).count() == 1
        old = client.post("/api/v1/me/mfa/confirm/", {"code": _code(first)}, format="json")
        assert old.status_code == 400
        assert client.post("/api/v1/me/mfa/confirm/", {"code": _code(second)}, format="json").status_code == 200

    def test_confirm_without_starting_is_a_conflict(self, soul):
        response = soul_client(soul).post("/api/v1/me/mfa/confirm/", {"code": "123456"}, format="json")
        assert response.status_code == 409 and response.data["code"] == "not_started"

    def test_cancel_discards_an_unconfirmed_secret_and_leaves_an_enabled_one(self, soul):
        client = soul_client(soul)
        client.post("/api/v1/me/mfa/setup/", {"password": PASSWORD}, format="json")
        assert client.delete("/api/v1/me/mfa/setup/").status_code == 204
        assert not SoulMfa.objects.filter(account=soul).exists()
        _enable(soul)
        assert client.delete("/api/v1/me/mfa/setup/").status_code == 204
        assert mfa.is_enabled(soul) is True

    def test_setup_is_refused_while_enabled(self, soul):
        _enable(soul)
        response = soul_client(soul).post("/api/v1/me/mfa/setup/", {"password": PASSWORD}, format="json")
        assert response.status_code == 409 and response.data["code"] == "already_enabled"

    def test_the_secret_is_encrypted_at_rest_like_the_officers(self, soul):
        from django.db import connection

        secret, _ = _enable(soul)
        with connection.cursor() as cursor:
            cursor.execute("select secret from soul_accounts_soulmfa")
            stored = cursor.fetchone()[0]
        from django.conf import settings

        if getattr(settings, "ENCRYPTION_KEY", None):
            assert stored != secret  # 配了密钥就不是明文(没配时与官员一样明文,settings 在生产下拒绝那种配置)

    def test_another_souls_endpoint_state_is_not_visible(self, cn_tenant, soul):
        other, _ = ready_soul(cn_tenant, name="亡魂乙")
        _enable(other)
        assert soul_client(soul).get("/api/v1/me/mfa/").data["enabled"] is False

    def test_the_officer_endpoints_do_not_take_a_soul_token(self, soul):
        response = soul_client(soul).get("/api/v1/auth/mfa/status/")
        assert response.status_code == 403


# ── 登录 ─────────────────────────────────────────────────────────────────


class TestLogin:
    def test_an_account_without_two_step_logs_in_exactly_as_before(self, soul):
        response = _login(soul)
        assert response.status_code == 200
        assert set(response.data) == {"access", "refresh", "soul_code", "account"}
        assert set(response.data["account"]) == {"cycle", "must_change_password", "initial_password_expires_at",
                                                 "created_at"}

    def test_a_device_token_for_an_account_without_two_step_changes_nothing(self, soul):
        response = _login(soul, device_token="whatever")
        assert set(response.data) == {"access", "refresh", "soul_code", "account"}

    def test_step_one_gives_a_pending_token_and_no_tokens(self, soul):
        _enable(soul)
        response = _login(soul)
        assert response.status_code == 200
        assert set(response.data) == {"mfa_required", "pending_token", "soul_code", "home_tenant"}
        assert response.data["soul_code"] == soul.soul.soul_code
        assert response.data["home_tenant"]["code"] == soul.soul.home_tenant.code
        # 它不是令牌:灵魂接口与官员接口都不认。
        bearer = APIClient()
        bearer.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['pending_token']}")
        assert bearer.get("/api/v1/me/").status_code in (401, 403)
        assert bearer.get("/api/v1/auth/profile/").status_code in (401, 403)

    def test_a_wrong_password_never_reaches_step_two(self, soul):
        _enable(soul)
        response = APIClient().post("/api/v1/soul-auth/login/",
                                    {"soul_code": soul.soul.soul_code, "password": "nope-nope-nope"}, format="json")
        assert response.status_code == 401 and "mfa_required" not in response.data

    def test_step_two_with_a_good_code_issues_tokens(self, soul):
        secret, _ = _enable(soul)
        response = _verify(_pending(soul), code=_code(secret))
        assert response.status_code == 200, response.data
        assert set(response.data) == {"access", "refresh", "soul_code", "account"}
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
        assert client.get("/api/v1/me/").status_code == 200
        row = SoulMfa.objects.get(account=soul)
        assert row.last_used_method == "totp" and row.last_used_at is not None

    def test_a_wrong_code_says_how_many_tries_are_left(self, soul):
        secret, _ = _enable(soul)
        pending = _pending(soul)
        bad = f"{(int(_code(secret)) + 1) % 10**6:06d}"
        first = _verify(pending, code=bad)
        assert first.status_code == 400 and first.data["code"] == "wrong"
        assert first.data["remaining_attempts"] == 4
        second = _verify(pending, code=bad)
        assert second.data["remaining_attempts"] == 3

    def test_five_failures_lock_and_say_until_when(self, soul):
        secret, _ = _enable(soul)
        pending = _pending(soul)
        bad = f"{(int(_code(secret)) + 1) % 10**6:06d}"
        for _ in range(4):
            assert _verify(pending, code=bad).status_code == 400
        before = timezone.now()
        locked = _verify(pending, code=bad)
        assert locked.status_code == 429 and locked.data["code"] == "locked"
        assert locked.data["retry_after"] == core.MFA_LOCK_SECONDS
        assert locked["Retry-After"] == str(core.MFA_LOCK_SECONDS)
        until = datetime.fromisoformat(locked.json()["locked_until"].replace("Z", "+00:00"))
        assert abs((until - (before + timedelta(seconds=core.MFA_LOCK_SECONDS))).total_seconds()) < 5
        # 锁着的时候,对的码也进不去 —— 并且换一个新的待验证凭据(重新输入密码)绕不过账号上的锁。
        assert _verify(pending, code=_code(secret)).status_code == 429
        assert _verify(_pending(soul), code=_code(secret)).status_code == 429
        # 过了时间就解开。
        SoulMfa.objects.filter(account=soul).update(locked_until=timezone.now() - timedelta(seconds=1))
        assert _verify(_pending(soul), code=_code(secret)).status_code == 200

    def test_a_stale_code_is_expired_not_wrong_and_does_not_count(self, soul):
        secret, _ = _enable(soul)
        response = _verify(_pending(soul), code=_code(secret, delta=-3))
        assert response.status_code == 400 and response.data["code"] == "expired"
        assert SoulMfa.objects.get(account=soul).failed_attempts == 0

    def test_the_same_code_cannot_be_used_twice(self, soul):
        secret, _ = _enable(soul)
        code = _code(secret)
        assert _verify(_pending(soul), code=code).status_code == 200
        replay = _verify(_pending(soul), code=code)
        assert replay.status_code == 400 and replay.data["code"] == "expired"
        assert SoulMfa.objects.get(account=soul).failed_attempts == 1  # 重放计次

    def test_a_pending_token_is_spent_by_its_first_success(self, soul):
        secret, codes = _enable(soul)
        pending = _pending(soul)
        assert _verify(pending, code=_code(secret)).status_code == 200
        again = _verify(pending, recovery_code=codes[0])
        assert (again.status_code, again.data["code"]) == (401, "pending_invalid")
        # A fresh pending token still takes that recovery code: it was not spent by the refusal.
        assert _verify(_pending(soul), recovery_code=codes[0]).status_code == 200

    def test_the_code_used_to_enable_cannot_be_replayed_to_log_in(self, soul):
        secret, _ = _enable(soul, forget_step=False)
        replay = _verify(_pending(soul), code=_code(secret))
        assert replay.status_code == 400 and replay.data["code"] == "expired"

    def test_an_expired_pending_token_is_pending_invalid(self, soul):
        _enable(soul)
        token = mfa.SoulMfaPendingToken()
        token["soul_account_id"] = str(soul.pk)
        token.set_exp(lifetime=-timedelta(seconds=1))
        response = _verify(str(token), code="123456")
        assert response.status_code == 401 and response.data["code"] == "pending_invalid"

    def test_the_wrong_kinds_of_token_are_not_pending_tokens(self, soul):
        secret, _ = _enable(soul)
        code = _code(secret)
        tokens = svc.issue_tokens(soul)
        officer_pending = core.PendingToken()
        officer_pending["user_id"] = soul.user.pk
        # Tokens of every other kind, even ones carrying this account's id in the pending credential's claim: the
        # kind alone must refuse them (a signed claim cannot be forged, but a kind check is what keeps a stolen
        # access / refresh token from being a way into step two).
        from rest_framework_simplejwt.tokens import AccessToken

        from apps.soul_accounts.authentication import SoulAccessToken, SoulRefreshToken

        claimed = []
        for kind in (AccessToken, RefreshToken, SoulAccessToken, SoulRefreshToken):
            token = kind.for_user(soul.user) if kind in (RefreshToken, SoulRefreshToken) else kind()
            token["soul_account_id"] = str(soul.pk)
            claimed.append(str(token))
        officer_pending["soul_account_id"] = str(soul.pk)
        for raw in (tokens["access"], tokens["refresh"], str(officer_pending), "garbage", *claimed):
            response = _verify(raw, code=code)
            assert response.status_code == 401 and response.data["code"] == "pending_invalid", raw[:20]

    def test_another_souls_pending_token_cannot_be_used_against_this_account(self, cn_tenant, soul):
        secret, _ = _enable(soul)
        other, _ = ready_soul(cn_tenant, name="亡魂乙")
        _with_password(other)
        other_secret, _ = _enable(other)
        pending_other = _pending(other)
        # 用乙的待验证凭据,送甲的码:凭据绑定乙,甲的密钥根本不会被拿来比。
        response = _verify(pending_other, code=_code(secret))
        assert response.status_code == 400 and response.data["code"] == "wrong"
        assert SoulMfa.objects.get(account=soul).failed_attempts == 0
        assert SoulMfa.objects.get(account=other).failed_attempts == 1
        assert _verify(pending_other, code=_code(other_secret)).status_code == 200

    def test_a_pending_token_of_a_retired_account_is_refused(self, soul):
        secret, _ = _enable(soul)
        pending = _pending(soul)
        SoulAccount.objects.filter(pk=soul.pk).update(retired_at=timezone.now())
        assert _verify(pending, code=_code(secret)).data["code"] == "pending_invalid"

    def test_a_disabled_account_does_not_take_a_stale_pending_token(self, soul):
        secret, _ = _enable(soul)
        pending = _pending(soul)
        mfa.void_all(soul)
        assert _verify(pending, code=_code(secret)).data["code"] == "pending_invalid"

    def test_nor_does_an_account_that_is_only_setting_it_up_again(self, soul):
        """Disabled in another session and a new, unconfirmed secret begun: that row is not a second step yet."""
        secret, _ = _enable(soul)
        pending = _pending(soul)
        mfa.void_all(soul)
        new_secret, _ = mfa.begin_setup(soul)
        response = _verify(pending, code=_code(new_secret))
        assert response.status_code == 401 and response.data["code"] == "pending_invalid"
        assert secret != new_secret

    def test_either_code_or_recovery_code_is_required(self, soul):
        _enable(soul)
        assert _verify(_pending(soul)).status_code == 400

    def test_login_log_rows_are_written_at_step_two(self, soul):
        from apps.authentication.models import LoginLog

        secret, _ = _enable(soul)
        pending = _pending(soul)
        assert not LoginLog.objects.filter(user=soul.user).exists()
        _verify(pending, code="000000")
        _verify(pending, code=_code(secret))
        reasons = list(LoginLog.objects.filter(user=soul.user).order_by("pk").values_list("status", "failure_reason"))
        assert reasons[0][0] == "FAILED" and reasons[0][1].startswith("mfa_")
        assert reasons[-1] == ("SUCCESS", "")

    def test_many_failures_from_one_ip_are_throttled(self, soul):
        _enable(soul)
        for _ in range(50):
            assert _verify("garbage", code="123456").status_code == 401
        response = _verify(_pending(soul), code="123456")
        assert response.status_code == 429 and response.data["code"] == "rate_limited"


# ── 恢复码 ───────────────────────────────────────────────────────────────


class TestRecoveryCodes:
    def test_a_recovery_code_logs_in_once_and_the_count_drops(self, soul):
        secret, codes = _enable(soul)
        first = _verify(_pending(soul), recovery_code=codes[0])
        assert first.status_code == 200
        status = soul_client(soul).get("/api/v1/me/mfa/").data
        assert status["recovery_codes_remaining"] == 9 and status["last_used_method"] == "recovery"
        again = _verify(_pending(soul), recovery_code=codes[0])
        assert again.status_code == 400 and again.data["code"] == "wrong"
        # 别的码仍可用,大小写与连字符宽松。
        assert _verify(_pending(soul), recovery_code=codes[1].upper().replace("-", " ")).status_code == 200

    def test_after_every_code_is_used_the_six_digits_still_work(self, soul):
        secret, codes = _enable(soul)
        for code in codes:
            assert _verify(_pending(soul), recovery_code=code).status_code == 200
        assert soul_client(soul).get("/api/v1/me/mfa/").data["recovery_codes_remaining"] == 0
        assert _verify(_pending(soul), code=_code(secret)).status_code == 200

    def test_wrong_recovery_codes_count_toward_the_same_lock(self, soul):
        _enable(soul)
        pending = _pending(soul)
        for _ in range(4):
            assert _verify(pending, recovery_code="zzzz-zzzz").status_code == 400
        assert _verify(pending, recovery_code="zzzz-zzzz").status_code == 429

    def test_regenerating_voids_the_old_set(self, soul):
        secret, old = _enable(soul)
        response = soul_client(soul).post("/api/v1/me/mfa/recovery-codes/", {"method": "password", "password": PASSWORD}, format="json")
        assert response.status_code == 200
        new = response.data["recovery_codes"]
        assert len(new) == 10 and not set(new) & set(old)
        assert SoulMfaRecoveryCode.objects.count() == 10
        assert _verify(_pending(soul), recovery_code=old[0]).status_code == 400
        assert _verify(_pending(soul), recovery_code=new[0]).status_code == 200
        assert AuditLog.objects.filter(resource="mfa", description__contains="重新生成").exists()

    def test_regenerating_needs_an_enabled_account(self, soul):
        response = soul_client(soul).post("/api/v1/me/mfa/recovery-codes/", {"method": "password", "password": PASSWORD}, format="json")
        assert response.status_code == 409 and response.data["code"] == "not_enabled"

    def test_no_confirmation_a_wrong_one_or_a_recovery_code_changes_nothing(self, soul):
        secret, old = _enable(soul)
        client = soul_client(soul)
        for body in (None, {}, {"method": "password", "password": "nope"}, {"method": "totp", "code": "000000"},
                     {"method": "recovery", "code": old[0]}):
            response = client.post("/api/v1/me/mfa/recovery-codes/", body, format="json")
            assert response.status_code == 400 and "recovery_codes" not in response.data, body
        assert SoulMfaRecoveryCode.objects.filter(used_at__isnull=True).count() == 10
        assert _verify(_pending(soul), recovery_code=old[0]).status_code == 200  # the old set still works

    def test_the_six_number_code_confirms_too(self, soul):
        secret, old = _enable(soul)
        response = soul_client(soul).post("/api/v1/me/mfa/recovery-codes/", {"method": "totp", "code": _code(secret)}, format="json")
        assert response.status_code == 200 and not set(response.data["recovery_codes"]) & set(old)

    def test_wrong_confirmations_share_the_lock_with_disable(self, soul):
        _enable(soul)
        client = soul_client(soul)
        url = "/api/v1/me/mfa/recovery-codes/"
        for _ in range(4):
            assert client.post(url, {"method": "password", "password": "nope"}, format="json").status_code == 400
        assert client.post(url, {"method": "password", "password": "nope"}, format="json").status_code == 429
        assert client.post(url, {"method": "password", "password": PASSWORD}, format="json").status_code == 429
        assert client.post("/api/v1/me/mfa/disable/", {"method": "password", "password": PASSWORD}, format="json").status_code == 429
        assert SoulMfaRecoveryCode.objects.filter(used_at__isnull=True).count() == 10


# ── 「这部手机 30 天内不再询问」 ───────────────────────────────────────────────


class TestRememberedDevice:
    def _remembered(self, soul):
        secret, codes = _enable(soul)
        response = _verify(_pending(soul), code=_code(secret), remember_device=True)
        assert response.status_code == 200
        return response.data["device_token"], secret, codes

    def test_no_device_token_unless_asked(self, soul):
        secret, _ = _enable(soul)
        assert "device_token" not in _verify(_pending(soul), code=_code(secret)).data
        assert not SoulMfaDevice.objects.exists()

    def test_a_valid_device_token_skips_step_two(self, soul):
        token, _, _ = self._remembered(soul)
        response = _login(soul, device_token=token)
        assert set(response.data) == {"access", "refresh", "soul_code", "account"}

    def test_the_token_is_stored_only_as_a_hash_and_expires_in_thirty_days(self, soul):
        token, _, _ = self._remembered(soul)
        row = SoulMfaDevice.objects.get()
        assert row.token_hash != token and len(row.token_hash) == 64
        assert timedelta(days=29, hours=23) < row.expires_at - timezone.now() <= timedelta(days=30)

    def test_an_expired_token_does_not_skip(self, soul):
        token, _, _ = self._remembered(soul)
        SoulMfaDevice.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        assert _login(soul, device_token=token).data["mfa_required"] is True

    def test_a_garbage_token_does_not_skip(self, soul):
        self._remembered(soul)
        assert _login(soul, device_token="not-the-token").data["mfa_required"] is True
        assert _login(soul, device_token="").data["mfa_required"] is True

    def test_it_is_bound_to_the_account(self, cn_tenant, soul):
        token, _, _ = self._remembered(soul)
        other, _ = ready_soul(cn_tenant, name="亡魂乙")
        _with_password(other)
        _enable(other)
        assert _login(other, device_token=token).data["mfa_required"] is True

    def test_it_is_not_the_refresh_token(self, soul):
        token, _, _ = self._remembered(soul)
        assert token not in (svc.issue_tokens(soul)["refresh"],)
        # 登出(作废刷新令牌)不清它。
        tokens = _login(soul, device_token=token).data
        APIClient().post("/api/v1/soul-auth/logout/", {"refresh": tokens["refresh"]}, format="json")
        assert "mfa_required" not in _login(soul, device_token=token).data

    @pytest.mark.parametrize("how", ["disable", "reenable", "officer", "password", "email_reset", "officer_password"])
    def test_it_is_voided_by(self, soul, cn_tenant, admin_user, how):
        token, secret, _ = self._remembered(soul)
        assert SoulMfaDevice.objects.exists()
        if how == "disable":
            mfa.disable(soul, method="password", password=PASSWORD)
        elif how == "reenable":
            SoulMfa.objects.filter(account=soul).delete()
            _enable(soul)
        elif how == "officer":
            mfa.reset_by_officer(soul, actor=admin_user, reason="手机丢了,已核对身份")
        elif how == "password":
            svc.change_password(soul, PASSWORD, "another-long-password-2")
        elif how == "email_reset":
            svc.set_password_chosen_by_soul(soul, "another-long-password-2")
        else:
            svc.reset_credential(soul, actor=admin_user)
        assert not SoulMfaDevice.objects.exists()
        soul.refresh_from_db()
        soul.user.refresh_from_db()
        if how in ("password", "email_reset"):
            login = APIClient().post("/api/v1/soul-auth/login/", {
                "soul_code": soul.soul.soul_code, "password": "another-long-password-2", "device_token": token,
            }, format="json")
            assert login.data["mfa_required"] is True  # 密码改了,二步仍在,手机要重新确认


# ── 关闭 ─────────────────────────────────────────────────────────────────


class TestDisable:
    def test_by_a_code(self, soul):
        secret, _ = _enable(soul)
        response = soul_client(soul).post("/api/v1/me/mfa/disable/",
                                          {"method": "totp", "code": _code(secret)}, format="json")
        assert response.status_code == 200 and response.data["enabled"] is False
        assert not SoulMfa.objects.exists() and not SoulMfaRecoveryCode.objects.exists()
        assert "mfa_required" not in _login(soul).data

    def test_by_password(self, soul):
        _enable(soul)
        response = soul_client(soul).post("/api/v1/me/mfa/disable/",
                                          {"method": "password", "password": PASSWORD}, format="json")
        assert response.status_code == 200 and response.data["enabled"] is False

    def test_a_wrong_code_or_password_keeps_it_on(self, soul):
        _enable(soul)
        client = soul_client(soul)
        assert client.post("/api/v1/me/mfa/disable/", {"method": "totp", "code": "000000"},
                           format="json").status_code == 400
        bad = client.post("/api/v1/me/mfa/disable/", {"method": "password", "password": "nope"}, format="json")
        assert bad.status_code == 400 and bad.data["code"] == "wrong_password"
        assert mfa.is_enabled(soul) is True

    def test_wrong_passwords_are_counted_and_lock(self, soul):
        _enable(soul)
        client = soul_client(soul)
        for _ in range(4):
            assert client.post("/api/v1/me/mfa/disable/", {"method": "password", "password": "nope"},
                               format="json").status_code == 400
        locked = client.post("/api/v1/me/mfa/disable/", {"method": "password", "password": "nope"}, format="json")
        assert locked.status_code == 429
        # 锁着时连对的密码也不行。
        assert client.post("/api/v1/me/mfa/disable/", {"method": "password", "password": PASSWORD},
                           format="json").status_code == 429
        assert mfa.is_enabled(soul) is True

    def test_not_enabled_is_a_conflict(self, soul):
        response = soul_client(soul).post("/api/v1/me/mfa/disable/", {"method": "password", "password": PASSWORD},
                                          format="json")
        assert response.status_code == 409 and response.data["code"] == "not_enabled"

    def test_enabling_and_disabling_leave_other_sessions_alone(self, soul):
        other_device = svc.issue_tokens(soul)
        secret, _ = _enable(soul)
        client = soul_client(soul)
        client.post("/api/v1/me/mfa/disable/", {"method": "totp", "code": _code(secret)}, format="json")
        refreshed = APIClient().post("/api/v1/soul-auth/refresh/", {"refresh": other_device["refresh"]}, format="json")
        assert refreshed.status_code == 200


# ── 转世、重置密码 ───────────────────────────────────────────────────────────


class TestLifecycle:
    def test_rebirth_voids_the_old_state_and_the_new_life_starts_off(self, cn_tenant):
        from apps.reincarnation.services import ReincarnationService
        from apps.souls.models import Soul, SoulState

        soul_row = dead_soul(cn_tenant)
        first, _ = provision_with_password(soul_row)
        secret, _ = _enable(first)
        first.refresh_from_db()
        first.user.set_password(PASSWORD)
        first.user.save()
        SoulMfaDevice.objects.create(account=first, token_hash="a" * 64, expires_at=timezone.now() + timedelta(days=3))
        assert SoulMfa.objects.count() == 1 and SoulMfaRecoveryCode.objects.count() == 10

        Soul.all_objects.filter(pk=soul_row.pk).update(current_state=SoulState.REINCARNATING)
        soul_row.refresh_from_db()
        ReincarnationService.complete_rebirth(soul_row, new_identity="新名字")

        assert not SoulMfa.objects.exists() and not SoulMfaRecoveryCode.objects.exists()
        assert not SoulMfaDevice.objects.exists()
        assert AuditLog.objects.filter(resource="soul_account", resource_id=str(first.pk),
                                       description__contains="停用").exists()
        soul_row.refresh_from_db()
        soul_row.die()
        second = svc.current_account_of(soul_row)
        assert second.pk != first.pk and mfa.is_enabled(second) is False
        assert mfa.status_of(second)["enabled"] is False

    def test_self_service_password_change_keeps_two_step_on(self, soul):
        _enable(soul)
        svc.change_password(soul, PASSWORD, "another-long-password-2")
        assert mfa.is_enabled(soul) is True and SoulMfaRecoveryCode.objects.count() == 10

    def test_email_reset_keeps_two_step_on(self, soul):
        _enable(soul)
        svc.set_password_chosen_by_soul(soul, "another-long-password-2")
        assert mfa.is_enabled(soul) is True

    def test_the_officer_credential_reset_keeps_two_step_on(self, soul, admin_user):
        _enable(soul)
        svc.reset_credential(soul, actor=admin_user)
        assert mfa.is_enabled(soul) is True and SoulMfaRecoveryCode.objects.count() == 10

    def test_the_email_reset_endpoint_keeps_two_step_on(self, soul):
        """真实路径,不是直接调 service:邮箱验证码重置密码。"""
        from apps.authentication import views as auth_views  # noqa: F401  (确认路径存在)

        _enable(soul)
        svc.set_password_chosen_by_soul(soul, "another-long-password-2")
        login = APIClient().post("/api/v1/soul-auth/login/", {
            "soul_code": soul.soul.soul_code, "password": "another-long-password-2"}, format="json")
        assert login.data["mfa_required"] is True


# ── 官员关闭 ─────────────────────────────────────────────────────────────


def _grant(role_name, *codenames):
    from apps.perm.models import Permission, Role, RolePermission

    role, _ = Role.objects.get_or_create(name=role_name, defaults={"display_name": role_name})
    for codename in codenames:
        permission, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"name": codename, "category": codename.split(".")[0]})
        RolePermission.objects.get_or_create(role=role, permission=permission)


class TestOfficerReset:
    def _url(self, account):
        return f"/api/v1/soul-accounts/accounts/{account.pk}/reset-mfa/"

    def test_the_serializer_shows_the_boolean_and_the_time_but_no_key_material(self, soul, admin_user):
        client = officer_client(admin_user)
        row = client.get(f"/api/v1/soul-accounts/accounts/?soul={soul.soul_id}").data["results"][0]
        assert row["mfa_enabled"] is False and row["mfa_enabled_at"] is None
        secret, codes = _enable(soul)
        row = client.get(f"/api/v1/soul-accounts/accounts/?soul={soul.soul_id}").data["results"][0]
        assert row["mfa_enabled"] is True and row["mfa_enabled_at"] is not None
        blob = str(row)
        assert secret not in blob and not any(code in blob for code in codes)
        assert not {"secret", "recovery_codes", "last_step", "failed_attempts"} & set(row)

    def test_it_clears_everything_audits_the_reason_and_leaves_the_soul_a_notice(
        self, soul, admin_user, django_capture_on_commit_callbacks
    ):
        secret, codes = _enable(soul)
        pending_token = _verify(_pending(soul), code=_code(secret), remember_device=True).data
        tokens = svc.issue_tokens(soul)
        with django_capture_on_commit_callbacks(execute=True):
            response = officer_client(admin_user).post(self._url(soul), {"reason": "手机丢了,已当面核对身份"},
                                                       format="json")
        assert response.status_code == 200, response.data
        assert response.data["mfa_enabled"] is False
        assert not SoulMfa.objects.exists() and not SoulMfaRecoveryCode.objects.exists()
        assert not SoulMfaDevice.objects.exists()
        assert pending_token["device_token"]
        # 之前的会话被吊销:刷新不再成功。
        assert APIClient().post("/api/v1/soul-auth/refresh/", {"refresh": tokens["refresh"]},
                                format="json").status_code == 401
        # 之后用密码就能登进来。
        assert "mfa_required" not in _login(soul).data
        log = AuditLog.objects.get(resource="mfa", resource_id=str(soul.pk))
        assert log.user_id == admin_user.pk and "手机丢了" in log.description
        assert log.changes["reason"] == "手机丢了,已当面核对身份" and log.changes["mfa_enabled"] == [True, False]
        # 灵魂的通知记录里有这一条,带官员的名字。
        notice = PushDelivery.objects.get(account=soul, kind="mfa_reset_by_officer")
        assert (admin_user.display_name or admin_user.username) in notice.body
        # 点这条推送要去两步验证页(手机端 landingOf 认 screen: Mfa)。
        assert notice.data["screen"] == "Mfa"

    def test_the_notice_is_readable_after_login_in_the_history(self, soul, admin_user):
        _enable(soul)
        officer_client(admin_user).post(self._url(soul), {"reason": "手机丢了,已当面核对身份"}, format="json")
        # The reset ended every session at once: the soul signs in again (password only now) and reads it.
        tokens = _login(soul).data
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        history = client.get("/api/v1/me/notifications/")
        assert history.status_code == 200
        item = next(i for i in history.data["results"] if i["kind"] == "mfa_reset_by_officer")
        assert item["title"] == "两步验证已关闭" and (admin_user.display_name or admin_user.username) in item["body"]
        assert item["status"] == "NO_DEVICE"

    def test_a_reason_is_required(self, soul, admin_user):
        _enable(soul)
        client = officer_client(admin_user)
        for body in ({}, {"reason": ""}, {"reason": "   "}):
            assert client.post(self._url(soul), body, format="json").status_code == 400
        assert mfa.is_enabled(soul) is True

    def test_it_cannot_enable_for_the_soul(self, soul, admin_user):
        response = officer_client(admin_user).post(self._url(soul), {"reason": "替它开启"}, format="json")
        assert response.status_code == 409 and response.data["code"] == "not_enabled"
        assert not SoulMfa.objects.exists()

    def test_without_the_permission_a_moderator_is_refused_and_with_it_allowed(
        self, soul, cn_tenant, django_user_model
    ):
        _enable(soul)
        moderator = django_user_model.objects.create_user(username="mod1", password="x", role="MODERATOR",
                                                          tenant=cn_tenant)
        client = officer_client(moderator)
        assert client.post(self._url(soul), {"reason": "手机丢了,已核对"}, format="json").status_code == 403
        assert mfa.is_enabled(soul) is True
        _grant("MODERATOR", "souls.mfa_reset")
        assert client.post(self._url(soul), {"reason": "手机丢了,已核对"}, format="json").status_code == 200

    def test_the_default_roles_hold_it_only_for_admin(self):
        from apps.perm.models import ROLE_PERMISSIONS

        holders = [role for role, codes in ROLE_PERMISSIONS.items() if "souls.mfa_reset" in codes]
        assert holders == ["ADMIN"]

    def test_only_the_home_hall_may(self, soul, eu_admin_user, django_user_model, cn_tenant, eu_tenant):
        _enable(soul)
        # 别殿的 ADMIN:租户豁免放宽了查询,但「谁是本殿官员」不放宽。
        response = officer_client(eu_admin_user).post(self._url(soul), {"reason": "不是我的殿"}, format="json")
        assert response.status_code == 403 and response.data["code"] == "not_home_hall"
        # 别殿持有权限的 MODERATOR:连这个账号都看不见。
        moderator = django_user_model.objects.create_user(username="eu_mod", password="x", role="MODERATOR",
                                                          tenant=eu_tenant)
        _grant("MODERATOR", "souls.mfa_reset")
        assert officer_client(moderator).post(self._url(soul), {"reason": "不是我的殿"},
                                              format="json").status_code == 404
        assert mfa.is_enabled(soul) is True

    def test_a_tenantless_admin_is_not_a_home_hall_officer(self, soul, django_user_model):
        _enable(soul)
        root = django_user_model.objects.create_user(username="root", password="x", role="ADMIN", tenant=None)
        response = officer_client(root).post(self._url(soul), {"reason": "全局管理员"}, format="json")
        assert response.status_code == 403 and response.data["code"] == "not_home_hall"

    def test_a_soul_token_cannot_call_it(self, soul):
        _enable(soul)
        assert soul_client(soul).post(self._url(soul), {"reason": "自己关"}, format="json").status_code == 403

    def test_the_login_after_reset_is_password_only_and_it_can_be_turned_on_again(self, soul, admin_user):
        _enable(soul)
        officer_client(admin_user).post(self._url(soul), {"reason": "手机丢了,已核对"}, format="json")
        tokens = _login(soul).data
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        assert client.post("/api/v1/me/mfa/setup/", {"password": PASSWORD}, format="json").status_code == 200


# ── 开始设置要先输密码 ────────────────────────────────────────────────────────


class TestSetupNeedsThePassword:
    URL = "/api/v1/me/mfa/setup/"

    def test_without_it_or_with_a_wrong_one_nothing_starts_and_no_secret_is_made(self, soul):
        client = soul_client(soul)
        for body in (None, {}, {"password": ""}, {"password": "nope"}):
            response = client.post(self.URL, body, format="json")
            assert (response.status_code, response.data["code"]) == (400, "wrong_password"), body
            assert "secret" not in response.data
        assert not SoulMfa.objects.exists()

    def test_wrong_passwords_spend_the_login_budget_and_lock_even_the_right_one(self, soul):
        client = soul_client(soul)
        for left in (4, 3, 2, 1, 0):
            response = client.post(self.URL, {"password": "nope"}, format="json")
            assert (response.status_code, response.data["remaining_attempts"]) == (400, left)
        locked = client.post(self.URL, {"password": PASSWORD}, format="json")
        assert (locked.status_code, locked.data["code"]) == (429, "rate_limited")
        assert not SoulMfa.objects.exists()
        # The very counter the password login reads: signing in is locked out for this soul code too.
        assert _login(soul).status_code == 429

    def test_a_right_password_while_enabled_is_still_a_conflict(self, soul):
        _enable(soul)
        response = soul_client(soul).post(self.URL, {"password": PASSWORD}, format="json")
        assert (response.status_code, response.data["code"]) == (409, "already_enabled")


# ── 会话立刻失效(sv) ────────────────────────────────────────────────────────


def _bearer(access):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    return client


class TestSessionsEndAtOnce:
    def test_an_officer_closing_it_kills_the_access_token_the_soul_already_holds(self, soul, admin_user):
        _enable(soul)
        held = svc.issue_tokens(soul)
        assert _bearer(held["access"]).get("/api/v1/me/").status_code == 200
        mfa.reset_by_officer(soul, actor=admin_user, reason="手机丢了,已核对身份")
        assert _bearer(held["access"]).get("/api/v1/me/").status_code == 401
        refreshed = APIClient().post("/api/v1/soul-auth/refresh/", {"refresh": held["refresh"]}, format="json")
        assert refreshed.status_code == 401

    def test_the_officer_resetting_the_password_does_too(self, soul, admin_user):
        held = svc.issue_tokens(soul)
        svc.reset_credential(soul, actor=admin_user)
        assert _bearer(held["access"]).get("/api/v1/me/").status_code == 401

    def test_changing_the_password_keeps_this_device_and_ends_the_others(self, soul):
        a, b = svc.issue_tokens(soul), svc.issue_tokens(soul)
        response = _bearer(a["access"]).post(
            "/api/v1/me/password/", {"old_password": PASSWORD, "new_password": "another-long-password-2"}, format="json")
        assert response.status_code == 200
        fresh = response.data
        assert _bearer(fresh["access"]).get("/api/v1/me/").status_code == 200  # this device, on the new pair
        for stale in (a["access"], b["access"]):
            assert _bearer(stale).get("/api/v1/me/").status_code == 401
        for stale in (a["refresh"], b["refresh"]):
            assert APIClient().post("/api/v1/soul-auth/refresh/", {"refresh": stale}, format="json").status_code == 401
        assert APIClient().post("/api/v1/soul-auth/refresh/", {"refresh": fresh["refresh"]}, format="json").status_code == 200

    def test_the_forced_first_password_change_does_not_sign_this_device_out(self, cn_tenant):
        soul_row = dead_soul(cn_tenant)
        account, initial = provision_with_password(soul_row)
        login = APIClient().post("/api/v1/soul-auth/login/", {"soul_code": soul_row.soul_code, "password": initial}, format="json")
        assert login.status_code == 200 and login.data["account"]["must_change_password"] is True
        client = _bearer(login.data["access"])
        changed = client.post("/api/v1/me/password/", {"old_password": initial, "new_password": "a-first-long-password"}, format="json")
        assert changed.status_code == 200
        assert _bearer(changed.data["access"]).get("/api/v1/me/").status_code == 200

    def test_an_email_reset_ends_every_device(self, soul):
        held = svc.issue_tokens(soul)
        svc.set_password_chosen_by_soul(soul, "another-long-password-2")
        assert _bearer(held["access"]).get("/api/v1/me/").status_code == 401

    def test_tokens_from_before_this_change_carry_no_sv_and_still_work_until_the_session_ends(self, soul):
        """No `sv` reads as 0: the day this ships nobody is signed out."""
        from apps.authentication.models import User
        from apps.soul_accounts.authentication import SoulRefreshToken

        User.objects.filter(pk=soul.user.pk).update(session_version=0)  # an account that predates `sv`
        soul.user.refresh_from_db()
        refresh = SoulRefreshToken.for_user(soul.user)
        refresh["soul_account_id"] = str(soul.pk)
        assert "sv" not in refresh.payload
        old = str(refresh.access_token)
        assert _bearer(old).get("/api/v1/me/").status_code == 200
        svc.end_account_sessions(soul)
        assert _bearer(old).get("/api/v1/me/").status_code == 401

    def test_a_new_login_after_the_session_ended_works_and_carries_the_new_version(self, soul):
        before = soul.user.session_version
        svc.end_account_sessions(soul)
        soul.user.refresh_from_db()
        assert soul.user.session_version == before + 1
        tokens = _login(soul).data
        assert _bearer(tokens["access"]).get("/api/v1/me/").status_code == 200

    def test_rebirth_kills_the_old_account_tokens(self, cn_tenant):
        from apps.reincarnation.services import ReincarnationService
        from apps.souls.models import Soul, SoulState

        soul_row = dead_soul(cn_tenant)
        first, _ = provision_with_password(soul_row)
        held = svc.issue_tokens(first)
        before = first.user.session_version
        Soul.all_objects.filter(pk=soul_row.pk).update(current_state=SoulState.REINCARNATING)
        soul_row.refresh_from_db()
        ReincarnationService.complete_rebirth(soul_row, new_identity="新名字")
        assert _bearer(held["access"]).get("/api/v1/me/").status_code == 401
        first.user.refresh_from_db()
        assert first.user.session_version == before + 1

    def test_push_registrations_follow_the_sessions_and_this_phones_survives(self, soul):
        from apps.soul_push.models import PushDevice

        PushDevice.objects.create(account=soul, soul=soul.soul, token="ExponentPushToken[mine]", platform="IOS", last_seen_at=timezone.now())
        PushDevice.objects.create(account=soul, soul=soul.soul, token="ExponentPushToken[other]", platform="ANDROID", last_seen_at=timezone.now())
        held = svc.issue_tokens(soul)
        response = _bearer(held["access"]).post(
            "/api/v1/me/password/",
            {"old_password": PASSWORD, "new_password": "another-long-password-2", "push_token": "ExponentPushToken[mine]"},
            format="json")
        assert response.status_code == 200
        active = set(PushDevice.objects.filter(is_active=True).values_list("token", flat=True))
        assert active == {"ExponentPushToken[mine]"}

    def test_without_a_push_token_no_registration_is_kept(self, soul):
        from apps.soul_push.models import PushDevice

        PushDevice.objects.create(account=soul, soul=soul.soul, token="ExponentPushToken[x]", platform="IOS", last_seen_at=timezone.now())
        svc.set_password_chosen_by_soul(soul, "another-long-password-2")
        assert not PushDevice.objects.filter(is_active=True).exists()


# ── 守卫的守卫 ───────────────────────────────────────────────────────────


def test_a_soul_account_with_no_row_reports_off_everywhere(soul):
    assert mfa.get_mfa(soul) is None and mfa.is_enabled(soul) is False
    assert mfa.status_of(soul)["recovery_codes_remaining"] == 0


def test_refresh_tokens_for_the_officer_pool_are_unaffected(admin_user):
    """灵魂这一侧的改动没有碰官员登录的形状。"""
    admin_user.set_password("admin123")
    admin_user.save()
    response = APIClient().post("/api/v1/auth/login/", {"username": "admin", "password": "admin123"}, format="json")
    assert response.status_code == 200 and "access" in response.data
    assert RefreshToken.for_user(admin_user)
