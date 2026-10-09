"""官员两步验证(A12,apps/authentication/mfa.py + mfa_views.py)。

写于 2026-10-09,**没有在本机跑过**(用户指令:只写不跑)。每条都读退出码不读输出的那种断言:
状态码、`code` 字段、库里的行数。
"""
import time
from datetime import timedelta

import pytest
from django.contrib.auth.hashers import get_hasher
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.authentication import mfa
from apps.authentication.models import MfaRecoveryCode, MfaRememberedDevice, OfficerMfa

SECRET = "JBSWY3DPEHPK3PXP"  # 公开示例密钥,只在这里用
STEP = mfa.TOTP_STEP_SECONDS


def _now_step():
    return int(time.time() // STEP)


def _code(secret=SECRET, delta=0):
    return mfa.totp_at(secret, _now_step() + delta)


def _enable(user):
    """直接把一个官员开到「已开启」:密钥 + 10 个恢复码。返回 (row, codes)。"""
    row = mfa.begin_setup(user)
    outcome, codes = mfa.confirm_setup(row, _code(row.secret))
    assert outcome == "ok"
    mfa.complete_setup(row)
    row.refresh_from_db()
    return row, codes


# ── 纯函数:窗口、过期、重放 ─────────────────────────────────────────────────────


class TestClassifyCode:
    def test_current_and_adjacent_steps_are_ok(self):
        now = 1_700_000_000
        for delta in (-1, 0, 1):
            outcome, step = mfa.classify_code(SECRET, mfa.totp_at(SECRET, now // STEP + delta), now=now)
            assert (outcome, step) == ("ok", now // STEP + delta)

    def test_two_to_four_steps_back_is_expired_not_wrong(self):
        now = 1_700_000_000
        for delta in (2, 3, 4):
            assert mfa.classify_code(SECRET, mfa.totp_at(SECRET, now // STEP - delta), now=now) == ("expired", None)

    def test_five_steps_back_and_the_future_are_wrong(self):
        now = 1_700_000_000
        assert mfa.classify_code(SECRET, mfa.totp_at(SECRET, now // STEP - 5), now=now) == ("wrong", None)
        assert mfa.classify_code(SECRET, mfa.totp_at(SECRET, now // STEP + 2), now=now) == ("wrong", None)

    def test_a_replayed_step_is_expired(self):
        now = 1_700_000_000
        step = now // STEP
        assert mfa.classify_code(SECRET, mfa.totp_at(SECRET, step), now=now, last_step=step) == ("expired", None)
        # 前一步也不行:last_step 之前的一律不收。
        assert mfa.classify_code(SECRET, mfa.totp_at(SECRET, step - 1), now=now, last_step=step) == ("expired", None)
        assert mfa.classify_code(SECRET, mfa.totp_at(SECRET, step + 1), now=now, last_step=step)[0] == "ok"

    def test_pasted_spaces_and_dashes_are_stripped(self):
        now = 1_700_000_000
        code = mfa.totp_at(SECRET, now // STEP)
        assert mfa.classify_code(SECRET, f"{code[:3]} {code[3:]}", now=now)[0] == "ok"
        assert mfa.classify_code(SECRET, f"{code[:3]}-{code[3:]}", now=now)[0] == "ok"

    def test_garbage_is_wrong_without_raising(self):
        assert mfa.classify_code(SECRET, "")[0] == "wrong"
        assert mfa.classify_code(SECRET, "12345")[0] == "wrong"
        assert mfa.classify_code(SECRET, "abcdef")[0] == "wrong"

    def test_rfc6238_vector(self):
        # RFC 6238 附录 B,SHA-1,T=59 → 8 位 94287082;6 位取末六位。
        assert mfa.totp_at("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59 // 30) == "287082"


# ── 向导 ─────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestSetupWizard:
    def test_only_complete_turns_it_on_and_leaving_voids_it(self, api_client, admin_user):
        api_client.force_authenticate(admin_user)
        r = api_client.post("/api/v1/auth/mfa/setup/")
        assert r.status_code == 200
        assert r.data["otpauth_url"].startswith("otpauth://totp/SoulLedger%3Aadmin?secret=")
        secret = r.data["secret"]
        # 没验码就「完成」:409。
        assert api_client.post("/api/v1/auth/mfa/complete/").status_code == 409
        r = api_client.post("/api/v1/auth/mfa/confirm/", {"code": _code(secret)}, format="json")
        assert r.status_code == 200
        assert len(r.data["recovery_codes"]) == mfa.RECOVERY_CODE_COUNT
        # 验过码仍然没开启。
        assert api_client.get("/api/v1/auth/mfa/status/").data["enabled"] is False
        # 中途退出:密钥作废,恢复码一起没了。
        assert api_client.delete("/api/v1/auth/mfa/setup/").status_code == 200
        assert OfficerMfa.objects.filter(user=admin_user).count() == 0
        assert MfaRecoveryCode.objects.count() == 0

    def test_complete_enables_and_audits(self, api_client, admin_user):
        api_client.force_authenticate(admin_user)
        secret = api_client.post("/api/v1/auth/mfa/setup/").data["secret"]
        api_client.post("/api/v1/auth/mfa/confirm/", {"code": _code(secret)}, format="json")
        r = api_client.post("/api/v1/auth/mfa/complete/")
        assert r.status_code == 200
        assert r.data["enabled"] is True
        assert r.data["recovery_codes_remaining"] == 10
        assert AuditLog.objects.filter(resource="mfa", resource_id=str(admin_user.pk), action="UPDATE",
                                       changes={"mfa_enabled": [False, True]}).count() == 1
        # 开着的时候再 setup:409,密钥不动。
        assert api_client.post("/api/v1/auth/mfa/setup/").status_code == 409
        assert OfficerMfa.objects.get(user=admin_user).secret == secret

    def test_confirm_with_a_wrong_code_says_so(self, api_client, admin_user):
        api_client.force_authenticate(admin_user)
        api_client.post("/api/v1/auth/mfa/setup/")
        r = api_client.post("/api/v1/auth/mfa/confirm/", {"code": "000000"}, format="json")
        assert r.status_code == 400
        assert r.data["code"] == "wrong"

    def test_secret_is_not_stored_in_the_clear_when_a_key_is_configured(self, settings, admin_user):
        from cryptography.fernet import Fernet

        settings.ENCRYPTION_KEY = Fernet.generate_key().decode()
        row = mfa.begin_setup(admin_user)
        raw = OfficerMfa.objects.filter(pk=row.pk).values_list("secret", flat=True)[0]
        # ORM 读出来已经解密了;直接看 SQL 列。
        from django.db import connection

        with connection.cursor() as c:
            c.execute("select secret from authentication_officermfa where id = %s", [row.pk])
            stored = c.fetchone()[0]
        assert stored != row.secret
        assert raw == row.secret


# ── 登录第二步 ─────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestLoginSecondStep:
    def test_login_without_mfa_keeps_the_old_shape(self, api_client, admin_user):
        r = api_client.post("/api/v1/auth/login/", {"username": "admin", "password": "admin123"}, format="json")
        assert r.status_code == 200
        assert {"access", "refresh", "user"} <= set(r.data)
        assert "mfa_required" not in r.data
        assert r.data["user"]["mfa_enabled"] is False
        assert r.data["user"]["mfa_required"] is True  # ADMIN 始终被要求 —— 但照样登进来了

    def test_login_with_mfa_returns_a_pending_token_and_no_tokens(self, api_client, admin_user):
        _enable(admin_user)
        r = api_client.post("/api/v1/auth/login/", {"username": "admin", "password": "admin123"}, format="json")
        assert r.status_code == 200
        assert r.data["mfa_required"] is True
        assert "access" not in r.data and "refresh" not in r.data
        # 待验证令牌打不开任何接口。
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['pending_token']}")
        assert api_client.get("/api/v1/auth/profile/").status_code == 401

    def test_verify_exchanges_the_pending_token_for_tokens(self, api_client, admin_user):
        row, _ = _enable(admin_user)
        pending = api_client.post("/api/v1/auth/login/", {"username": "admin", "password": "admin123"}, format="json").data["pending_token"]
        r = api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": pending, "code": _code(row.secret)}, format="json")
        assert r.status_code == 200
        assert {"access", "refresh", "user"} <= set(r.data)
        assert mfa.DEVICE_COOKIE not in r.cookies
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
        assert api_client.get("/api/v1/auth/profile/").status_code == 200
        row.refresh_from_db()
        assert row.last_used_method == "totp" and row.last_step == _now_step()

    def test_the_same_code_cannot_be_used_twice(self, api_client, admin_user):
        row, _ = _enable(admin_user)
        code = _code(row.secret)
        login = lambda: api_client.post("/api/v1/auth/login/", {"username": "admin", "password": "admin123"}, format="json").data["pending_token"]  # noqa: E731
        assert api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": login(), "code": code}, format="json").status_code == 200
        r = api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": login(), "code": code}, format="json")
        assert r.status_code == 400
        assert r.data["code"] == "expired"
        # A replay counts toward the lock; a merely old code does not (next test).
        row.refresh_from_db()
        assert row.failed_attempts == 1

    def test_expired_is_told_apart_from_wrong(self, api_client, admin_user):
        row, _ = _enable(admin_user)
        row.last_step = None
        row.save(update_fields=["last_step"])
        pending = api_client.post("/api/v1/auth/login/", {"username": "admin", "password": "admin123"}, format="json").data["pending_token"]
        r = api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": pending, "code": _code(row.secret, -3)}, format="json")
        assert (r.status_code, r.data["code"]) == (400, "expired")
        assert r.data["remaining_attempts"] == mfa.MFA_MAX_ATTEMPTS  # expired is not counted
        r = api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": pending, "code": "000000"}, format="json")
        assert (r.status_code, r.data["code"]) == (400, "wrong")
        assert r.data["remaining_attempts"] == mfa.MFA_MAX_ATTEMPTS - 1
        assert r.data["lock_minutes"] == mfa.MFA_LOCK_SECONDS // 60

    def test_five_failures_lock_for_fifteen_minutes_and_audit(self, api_client, admin_user):
        row, _ = _enable(admin_user)
        pending = api_client.post("/api/v1/auth/login/", {"username": "admin", "password": "admin123"}, format="json").data["pending_token"]
        for i in range(mfa.MFA_MAX_ATTEMPTS - 1):
            r = api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": pending, "code": "000000"}, format="json")
            assert (r.status_code, r.data["code"], r.data["remaining_attempts"]) == (400, "wrong", mfa.MFA_MAX_ATTEMPTS - 1 - i)
        r = api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": pending, "code": "000000"}, format="json")
        assert r.status_code == 429
        assert r.data["code"] == "locked"
        assert 0 < r.data["retry_after"] <= mfa.MFA_LOCK_SECONDS
        assert r["Retry-After"] == str(r.data["retry_after"])
        # 锁着的时候对的码也不收;输入与按钮在前端是禁用的,后端也不认。
        r = api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": pending, "code": _code(row.secret)}, format="json")
        assert r.status_code == 429
        failed = AuditLog.objects.filter(resource="mfa", resource_id=str(admin_user.pk), action="LOGIN")
        assert failed.filter(description__contains="不通过(wrong)").count() == mfa.MFA_MAX_ATTEMPTS - 1
        assert failed.filter(description__contains="锁定").count() == 1
        # 锁到期后再来:解开,计数从零起。
        row.refresh_from_db()
        row.locked_until = timezone.now() - timedelta(seconds=1)
        row.save(update_fields=["locked_until"])
        r = api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": pending, "code": _code(row.secret)}, format="json")
        assert r.status_code == 200

    def test_pending_token_expires_and_other_token_types_are_refused(self, api_client, admin_user):
        from rest_framework_simplejwt.tokens import RefreshToken

        row, _ = _enable(admin_user)
        pending = mfa.PendingToken.for_user(admin_user)
        pending.set_exp(from_time=timezone.now() - mfa.PENDING_TOKEN_LIFETIME - timedelta(seconds=5))
        r = api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": str(pending), "code": _code(row.secret)}, format="json")
        assert (r.status_code, r.data["code"]) == (401, "pending_invalid")
        # 一张 access 令牌不是待验证令牌。
        access = str(RefreshToken.for_user(admin_user).access_token)
        r = api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": access, "code": _code(row.secret)}, format="json")
        assert (r.status_code, r.data["code"]) == (401, "pending_invalid")

    def test_remember_claim_survives_the_second_step(self, api_client, admin_user):
        from apps.authentication.tokens import REMEMBER_CLAIM, RefreshToken

        row, _ = _enable(admin_user)
        pending = api_client.post("/api/v1/auth/login/", {"username": "admin", "password": "admin123", "remember": True}, format="json").data["pending_token"]
        r = api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": pending, "code": _code(row.secret)}, format="json")
        assert RefreshToken(r.data["refresh"]).payload.get(REMEMBER_CLAIM) is True

    def test_login_log_is_written_at_the_second_step_not_the_first(self, api_client, admin_user):
        from apps.authentication.models import LoginLog

        row, _ = _enable(admin_user)
        pending = api_client.post("/api/v1/auth/login/", {"username": "admin", "password": "admin123"}, format="json").data["pending_token"]
        assert LoginLog.objects.filter(username="admin").count() == 0
        api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": pending, "code": "000000"}, format="json")
        assert LoginLog.objects.filter(username="admin", status="FAILED", failure_reason="mfa_wrong").count() == 1
        api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": pending, "code": _code(row.secret)}, format="json")
        assert LoginLog.objects.filter(username="admin", status="SUCCESS").count() == 1


# ── 恢复码 ───────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestRecoveryCodes:
    def test_codes_are_hashed_like_passwords_and_single_use(self, api_client, admin_user):
        _, codes = _enable(admin_user)
        assert len(codes) == 10 and all(len(c) == 9 and c[4] == "-" for c in codes)
        prefix = get_hasher().algorithm
        assert all(h.startswith(prefix) for h in MfaRecoveryCode.objects.values_list("code_hash", flat=True))
        assert not MfaRecoveryCode.objects.filter(code_hash__in=codes).exists()

        login = lambda: api_client.post("/api/v1/auth/login/", {"username": "admin", "password": "admin123"}, format="json").data["pending_token"]  # noqa: E731
        # 大小写不敏感、连字符可有可无。
        r = api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": login(), "recovery_code": codes[0].upper().replace("-", " ")}, format="json")
        assert r.status_code == 200
        assert MfaRecoveryCode.objects.filter(used_at__isnull=True).count() == 9
        r = api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": login(), "recovery_code": codes[0]}, format="json")
        assert (r.status_code, r.data["code"]) == (400, "wrong")
        api_client.force_authenticate(admin_user)
        status = api_client.get("/api/v1/auth/mfa/status/").data
        assert status["recovery_codes_remaining"] == 9
        assert status["last_used_method"] == "recovery"

    def test_regenerate_voids_the_old_set_and_audits(self, api_client, admin_user):
        _, old = _enable(admin_user)
        api_client.force_authenticate(admin_user)
        r = api_client.post("/api/v1/auth/mfa/recovery-codes/")
        assert r.status_code == 200
        new = r.data["recovery_codes"]
        assert len(new) == 10 and not set(new) & set(old)
        assert MfaRecoveryCode.objects.count() == 10
        assert AuditLog.objects.filter(resource="mfa", description__contains="恢复码已重新生成").count() == 1
        api_client.force_authenticate(None)
        pending = api_client.post("/api/v1/auth/login/", {"username": "admin", "password": "admin123"}, format="json").data["pending_token"]
        assert api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": pending, "recovery_code": old[1]}, format="json").status_code == 400


# ── 设备令牌 ───────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestRememberedDevice:
    def test_device_cookie_skips_the_second_step_and_is_not_the_refresh_token(self, api_client, admin_user):
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

        row, _ = _enable(admin_user)
        pending = api_client.post("/api/v1/auth/login/", {"username": "admin", "password": "admin123"}, format="json").data["pending_token"]
        r = api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": pending, "code": _code(row.secret), "remember_device": True}, format="json")
        assert r.status_code == 200
        cookie = r.cookies[mfa.DEVICE_COOKIE]
        assert cookie["httponly"] and cookie["samesite"] == "Lax" and cookie["path"] == mfa.DEVICE_COOKIE_PATH
        assert int(cookie["max-age"]) == 30 * 86400
        device = MfaRememberedDevice.objects.get(user=admin_user)
        assert device.token_hash != cookie.value and len(device.token_hash) == 64
        assert cookie.value != r.data["refresh"]

        # 登出(刷新令牌进黑名单)之后,「不再询问」照样有效。
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
        assert api_client.post("/api/v1/auth/logout/", {"refresh": r.data["refresh"]}, format="json").status_code == 200
        assert BlacklistedToken.objects.count() == 1
        api_client.credentials()
        api_client.cookies[mfa.DEVICE_COOKIE] = cookie.value
        r = api_client.post("/api/v1/auth/login/", {"username": "admin", "password": "admin123"}, format="json")
        assert r.status_code == 200 and "access" in r.data and "mfa_required" not in r.data

    def test_an_expired_or_foreign_device_token_does_not_skip(self, api_client, admin_user, judge_user):
        _enable(admin_user)
        raw = mfa.remember_device(judge_user)  # 别人的设备令牌
        api_client.cookies[mfa.DEVICE_COOKIE] = raw
        r = api_client.post("/api/v1/auth/login/", {"username": "admin", "password": "admin123"}, format="json")
        assert r.data.get("mfa_required") is True
        raw = mfa.remember_device(admin_user)
        MfaRememberedDevice.objects.filter(user=admin_user).update(expires_at=timezone.now() - timedelta(seconds=1))
        api_client.cookies[mfa.DEVICE_COOKIE] = raw
        r = api_client.post("/api/v1/auth/login/", {"username": "admin", "password": "admin123"}, format="json")
        assert r.data.get("mfa_required") is True


# ── 关闭与管理员重置 ────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestDisableAndReset:
    def test_disable_by_code_or_password_clears_everything(self, api_client, admin_user):
        row, _ = _enable(admin_user)
        mfa.remember_device(admin_user)
        api_client.force_authenticate(admin_user)
        r = api_client.post("/api/v1/auth/mfa/disable/", {"method": "password", "password": "nope"}, format="json")
        assert (r.status_code, r.data["code"]) == (400, "wrong_password")
        r = api_client.post("/api/v1/auth/mfa/disable/", {"method": "totp", "code": _code(row.secret)}, format="json")
        assert r.status_code == 200 and r.data["enabled"] is False
        assert OfficerMfa.objects.count() == MfaRecoveryCode.objects.count() == MfaRememberedDevice.objects.count() == 0
        assert AuditLog.objects.filter(resource="mfa", changes={"mfa_enabled": [True, False]}).count() == 1
        _enable(admin_user)
        r = api_client.post("/api/v1/auth/mfa/disable/", {"method": "password", "password": "admin123"}, format="json")
        assert r.status_code == 200 and r.data["enabled"] is False

    def test_admin_reset_clears_secret_codes_devices_and_revokes_sessions(self, api_client, admin_user, judge_user):
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
        from rest_framework_simplejwt.tokens import RefreshToken

        _enable(judge_user)
        mfa.remember_device(judge_user)
        RefreshToken.for_user(judge_user)
        assert OutstandingToken.objects.filter(user=judge_user).count() == 1
        api_client.force_authenticate(admin_user)
        # 理由必填。
        assert api_client.post(f"/api/v1/users/{judge_user.pk}/reset-mfa/", {"reason": " "}, format="json").status_code == 400
        r = api_client.post(f"/api/v1/users/{judge_user.pk}/reset-mfa/", {"reason": "手机丢了"}, format="json")
        assert r.status_code == 200
        assert OfficerMfa.objects.filter(user=judge_user).count() == 0
        assert MfaRecoveryCode.objects.count() == 0
        assert MfaRememberedDevice.objects.filter(user=judge_user).count() == 0
        assert BlacklistedToken.objects.filter(token__user=judge_user).count() == 1
        log = AuditLog.objects.get(resource="mfa", resource_id=str(judge_user.pk), action="EXECUTE")
        assert log.user == admin_user and log.changes["reason"] == "手机丢了"
        # 没开启的账号:409,什么也不清。
        assert api_client.post(f"/api/v1/users/{judge_user.pk}/reset-mfa/", {"reason": "x"}, format="json").status_code == 409

    def test_reset_needs_user_manage(self, api_client, admin_user, judge_user):
        _enable(admin_user)
        api_client.force_authenticate(judge_user)
        assert api_client.post(f"/api/v1/users/{admin_user.pk}/reset-mfa/", {"reason": "x"}, format="json").status_code == 403
        assert OfficerMfa.objects.filter(user=admin_user).exists()


# ── 角色要求、列表列、殿设置 ────────────────────────────────────────────────────


@pytest.mark.django_db
class TestRequiredRolesAndListing:
    def test_required_flag_follows_the_tenant_setting(self, api_client, judge_user, cn_tenant):
        assert mfa.is_required(judge_user) is False
        cn_tenant.settings = {"mfa_required_roles": ["JUDGE"]}
        cn_tenant.save(update_fields=["settings"])
        judge_user.refresh_from_db()
        assert mfa.is_required(judge_user) is True
        api_client.force_authenticate(judge_user)
        assert api_client.get("/api/v1/auth/profile/").data["mfa_required"] is True
        r = api_client.post("/api/v1/auth/login/", {"username": "judge", "password": "judge123"}, format="json")
        # 被要求也不挡登录。
        assert r.status_code == 200 and "access" in r.data and r.data["user"]["mfa_required"] is True

    def test_tenant_settings_patch_and_role_rows(self, api_client, admin_user, judge_user, cn_tenant):
        _enable(judge_user)
        api_client.force_authenticate(admin_user)
        r = api_client.patch(f"/api/v1/tenants/{cn_tenant.code}/settings/", {"mfa_required_roles": ["JUDGE", "NOPE"]}, format="json")
        assert r.status_code == 400
        r = api_client.patch(f"/api/v1/tenants/{cn_tenant.code}/settings/", {"mfa_required_roles": ["JUDGE", "JUDGE", "GUARDIAN"]}, format="json")
        assert r.status_code == 200
        cn_tenant.refresh_from_db()
        assert cn_tenant.settings["mfa_required_roles"] == ["GUARDIAN", "JUDGE"]
        rows = {row["role"]: row for row in api_client.get(f"/api/v1/tenants/{cn_tenant.code}/mfa-roles/").data}
        assert rows["ADMIN"]["always"] is True and rows["ADMIN"]["required"] is True
        assert rows["JUDGE"] == {"role": "JUDGE", "required": True, "always": False, "total": 1, "enabled": 1}
        assert rows["ADMIN"]["total"] == 1 and rows["ADMIN"]["enabled"] == 0
        assert "SOUL" not in rows

    def test_users_list_column_and_filter(self, api_client, admin_user, judge_user, cn_tenant):
        _enable(judge_user)
        api_client.force_authenticate(admin_user)
        by_name = {u["username"]: u["mfa"] for u in api_client.get("/api/v1/users/").data["results"]}
        assert by_name["judge"]["enabled"] is True and by_name["judge"]["confirmed_at"] is not None
        assert by_name["admin"] == {"enabled": False, "required": True, "confirmed_at": None, "last_used_at": None}
        assert {u["username"] for u in api_client.get("/api/v1/users/", {"mfa": "enabled"}).data["results"]} == {"judge"}
        assert {u["username"] for u in api_client.get("/api/v1/users/", {"mfa": "disabled"}).data["results"]} == {"admin"}
        assert {u["username"] for u in api_client.get("/api/v1/users/", {"mfa": "missing"}).data["results"]} == {"admin"}
        cn_tenant.settings = {"mfa_required_roles": ["JUDGE"]}
        cn_tenant.save(update_fields=["settings"])
        mfa.disable(judge_user)
        assert {u["username"] for u in api_client.get("/api/v1/users/", {"mfa": "missing"}).data["results"]} == {"admin", "judge"}


# ── 灵魂账号不受影响 ────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestSoulAccountsUnaffected:
    def test_soul_users_cannot_reach_the_endpoints_and_are_never_required(self, api_client, django_user_model, cn_tenant):
        from apps.soul_accounts.authentication import SoulRefreshToken

        soul = django_user_model.objects.create_user(username="soul-1", password="x", role="SOUL", tenant=cn_tenant)
        assert mfa.is_required(soul) is False
        cn_tenant.settings = {"mfa_required_roles": ["SOUL"]}
        cn_tenant.save(update_fields=["settings"])
        assert mfa.is_required(soul) is False
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {SoulRefreshToken.for_user(soul).access_token}")
        assert api_client.post("/api/v1/auth/mfa/setup/").status_code == 403
        assert api_client.get("/api/v1/auth/mfa/status/").status_code == 403
        # 就算有人给灵魂用户造了一行并把待验证令牌签出来,第二步也不认。
        row = mfa.begin_setup(soul)
        row.confirmed_at = timezone.now()
        row.save(update_fields=["confirmed_at"])
        api_client.credentials()
        r = api_client.post("/api/v1/auth/mfa/verify/", {"pending_token": str(mfa.PendingToken.for_user(soul)), "code": _code(row.secret)}, format="json")
        assert (r.status_code, r.data["code"]) == (401, "pending_invalid")
