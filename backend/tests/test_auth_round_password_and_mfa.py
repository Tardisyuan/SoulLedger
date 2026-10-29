"""认证一轮(2026-10-15):重置码不泄露账号是否存在、两步验证加行锁、官员密码策略。

每一组都对应一条审计发现(A1 A2 A3 A15 A17 A18 A21)或用户定的密码策略(历史 / 最长使用 / 首登改密 / 管理员 12 位)。
"""
import time
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.core import mail
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from apps.authentication import mfa
from apps.authentication.models import OfficerMfa, PasswordHistory
from apps.authentication.passwords import PASSWORD_HISTORY_KEEP, set_officer_password
from apps.authentication.views import MAX_RESET_CODE_ATTEMPTS

REQUEST = "/api/v1/auth/reset-password/"
SET = "/api/v1/auth/set-new-password/"
LOGIN = "/api/v1/auth/login/"
PROFILE = "/api/v1/auth/profile/"
CHANGE = "/api/v1/auth/change-password/"
USERS = "/api/v1/users/"
OLD = "OldPass!123-x"
GOOD = "N0t-Guessable!2026-b"
SECRET = "JBSWY3DPEHPK3PXP"


@pytest.fixture(autouse=True)
def _clean(db):
    cache.clear()
    mail.outbox.clear()
    yield
    cache.clear()


def _client(user):
    c = APIClient()
    from rest_framework_simplejwt.tokens import AccessToken

    token = AccessToken.for_user(user)
    token["sv"] = user.session_version
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return c


def _officer(django_user_model, cn_tenant, role="JUDGE", username="pol", **extra):
    return django_user_model.objects.create_user(
        username=username, email=f"{username}@example.com", password=OLD, role=role, tenant=cn_tenant, **extra)


# ── A1 / A3 / A18: 灵魂忘记密码 ───────────────────────────────────────────────


@pytest.fixture
def soul(django_user_model, cn_tenant):
    return django_user_model.objects.create_user(
        username="soul_a", email="Soul.A@Example.com", password=OLD, role="SOUL", tenant=cn_tenant)


def _ask(email, ip="198.51.100.1"):
    return APIClient().post(REQUEST, {"email": email}, format="json", REMOTE_ADDR=ip)


def _set(email, code="000000", password=GOOD):
    return APIClient().post(SET, {"email": email, "code": code, "new_password": password}, format="json")


class TestResetIsNotAnAccountOracle:
    KNOWN, UNKNOWN = "soul.a@example.com", "nobody@example.com"

    def test_before_any_request_both_say_expired(self, soul):
        assert _set(self.KNOWN).data["code"] == _set(self.UNKNOWN).data["code"] == "reset_code_expired"

    def test_after_a_request_both_say_wrong_with_the_same_countdown(self, soul):
        _ask(self.KNOWN, "198.51.100.1")
        _ask(self.UNKNOWN, "198.51.100.2")
        for n in range(1, MAX_RESET_CODE_ATTEMPTS + 1):
            a, b = _set(self.KNOWN), _set(self.UNKNOWN)
            assert (a.status_code, a.data) == (b.status_code, b.data), n
            assert a.data["code"] == "reset_code_wrong" and a.data["attempts_left"] == MAX_RESET_CODE_ATTEMPTS - n
        a, b = _set(self.KNOWN), _set(self.UNKNOWN)
        assert a.data == b.data and a.data["code"] == "reset_code_attempts_exceeded"
        # ...and then the code is gone for both.
        assert _set(self.KNOWN).data["code"] == _set(self.UNKNOWN).data["code"] == "reset_code_expired"

    def test_the_unknown_address_is_never_mailed(self, soul):
        _ask(self.UNKNOWN)
        assert mail.outbox == []
        assert cache.get(f"pwd_reset:{self.UNKNOWN}") is not None

    def test_a_lucky_guess_at_an_unknown_address_is_just_wrong(self):
        cache.set(f"pwd_reset:{self.UNKNOWN}", "424242", timeout=300)
        res = _set(self.UNKNOWN, code="424242")
        assert res.status_code == 400 and res.data["code"] == "reset_code_wrong"


class TestGuessCounterIsAtomic:
    def test_a_stale_read_cannot_shortcut_the_count(self, soul):
        """Old code: `cache.get` then `cache.set(tries + 1)`. If every request reads the same stale
        value (what parallel requests do) no try is ever spent. The counter must be `incr`-ed, not
        rebuilt from a read."""
        email = "soul.a@example.com"
        cache.set(f"pwd_reset:{email}", "424242", timeout=300)
        real_get = cache.get

        def stale(key, default=None, *a, **kw):
            return 0 if key.startswith("pwd_reset_tries:") else real_get(key, default, *a, **kw)

        with patch.object(cache, "get", stale):
            codes = [_set(email, code="000000").data["code"] for _ in range(MAX_RESET_CODE_ATTEMPTS + 1)]
        assert codes[-1] == "reset_code_attempts_exceeded"


class TestSoulResetDetails:
    def test_a_case_variant_of_the_stored_email_still_gets_the_mail(self, soul):
        assert _ask("SOUL.a@example.COM").status_code == 200
        assert len(mail.outbox) == 1 and mail.outbox[0].to == ["soul.a@example.com"]
        code = cache.get("pwd_reset:soul.a@example.com")
        assert _set("SOUL.a@example.COM", code=code).status_code == 200
        soul.refresh_from_db()
        assert soul.check_password(GOOD)

    def test_a_deactivated_account_gets_no_mail(self, soul):
        soul.is_active = False
        soul.save(update_fields=["is_active"])
        assert _ask("soul.a@example.com").status_code == 200
        assert mail.outbox == []

    def test_a_weak_password_gets_proper_messages_not_a_stringified_list(self, soul):
        cache.set("pwd_reset:soul.a@example.com", "424242", timeout=300)
        res = _set("soul.a@example.com", code="424242", password="password")
        assert res.status_code == 400 and res.data["code"] == "weak_password"
        assert "[" not in res.data["error"] and "ValidationError" not in res.data["error"]
        assert {r["code"] for r in res.data["new_password"]} >= {"password_too_common"}


# ── A2 / A15: 官员两步验证 ─────────────────────────────────────────────────────


def _code(delta=0):
    return mfa.totp_at(SECRET, int(time.time() // mfa.TOTP_STEP_SECONDS) + delta)


def _enabled(user, forget_setup_step=True):
    row = mfa.begin_setup(user)
    row.secret = SECRET
    row.save(update_fields=["secret"])
    assert mfa.confirm_setup(row, _code())[0] == "ok"
    mfa.complete_setup(OfficerMfa.objects.get(pk=row.pk))
    row = OfficerMfa.objects.get(pk=row.pk)
    if forget_setup_step:
        row.last_step = None
        row.save(update_fields=["last_step"])
    return OfficerMfa.objects.get(pk=row.pk)


class TestMfaRowLock:
    def test_two_stale_copies_cannot_both_use_one_code(self, django_user_model, cn_tenant):
        """Both copies were read before either wrote. Verifying through the stale copy's own
        `last_step` let the same code in twice; the row is re-read under lock instead."""
        row = _enabled(_officer(django_user_model, cn_tenant))
        a, b = OfficerMfa.objects.get(pk=row.pk), OfficerMfa.objects.get(pk=row.pk)
        code = _code()
        assert mfa.verify_login_code(a, code=code)["code"] == "ok"
        assert mfa.verify_login_code(b, code=code)["code"] != "ok"

    def test_stale_copies_cannot_lose_failed_attempts(self, django_user_model, cn_tenant):
        row = _enabled(_officer(django_user_model, cn_tenant))
        copies = [OfficerMfa.objects.get(pk=row.pk) for _ in range(3)]
        for c in copies:
            mfa.verify_login_code(c, code="000000")
        assert OfficerMfa.objects.get(pk=row.pk).failed_attempts == 3

    def test_every_read_modify_write_path_takes_the_lock(self, django_user_model, cn_tenant):
        user = _officer(django_user_model, cn_tenant)
        with patch.object(mfa, "_lock", wraps=mfa._lock) as lock:
            row = mfa.begin_setup(user)
            mfa.confirm_setup(row, _code())
            assert lock.call_count == 1  # setup confirm
            row = _enabled(_officer(django_user_model, cn_tenant, username="pol2"))
            lock.reset_mock()
            mfa.verify_login_code(row, code="000000")
            assert lock.call_count == 1  # login second step
            mfa.confirm_owner(row, row.user, method="password", password="x")
            assert lock.call_count == 2  # disable / regenerate by password


class TestSetupCodeThenSignIn:
    def test_the_code_that_finished_setup_is_refused_but_not_counted(self, django_user_model, cn_tenant):
        row = _enabled(_officer(django_user_model, cn_tenant), forget_setup_step=False)
        out = mfa.verify_login_code(row, code=_code())
        assert out["code"] == "expired", "a code is single-use: still refused"
        assert OfficerMfa.objects.get(pk=row.pk).failed_attempts == 0, "...but it was no guess"
        assert out["remaining_attempts"] == mfa.MFA_MAX_ATTEMPTS

    def test_a_replay_after_a_real_sign_in_still_counts(self, django_user_model, cn_tenant):
        row = _enabled(_officer(django_user_model, cn_tenant, username="pol3"))
        code = _code()
        assert mfa.verify_login_code(row, code=code)["code"] == "ok"
        assert mfa.verify_login_code(OfficerMfa.objects.get(pk=row.pk), code=code)["code"] == "expired"
        assert OfficerMfa.objects.get(pk=row.pk).failed_attempts == 1


# ── A21: 改密码 ───────────────────────────────────────────────────────────────


class TestChangePassword:
    def test_a_wrong_current_password_spends_the_login_budget(self, django_user_model, cn_tenant):
        user = _officer(django_user_model, cn_tenant)
        c = _client(user)
        for _ in range(5):
            assert c.post(CHANGE, {"old_password": "nope", "new_password": GOOD}, format="json").status_code == 400
        res = c.post(CHANGE, {"old_password": OLD, "new_password": GOOD}, format="json")
        assert res.status_code == 429 and res.data["code"] == "login_locked" and res.data["retry_after"] > 0
        user.refresh_from_db()
        assert user.check_password(OLD)

    def test_the_new_password_cannot_equal_the_current_one(self, django_user_model, cn_tenant):
        c = _client(_officer(django_user_model, cn_tenant))
        res = c.post(CHANGE, {"old_password": OLD, "new_password": OLD}, format="json")
        assert res.status_code == 400
        assert [r["code"] for r in res.data["new_password"]] == ["password_reused"]


# ── 密码历史 ──────────────────────────────────────────────────────────────────


class TestPasswordHistory:
    def test_the_last_five_cannot_come_back_and_the_log_is_pruned(self, django_user_model, cn_tenant):
        user = _officer(django_user_model, cn_tenant)
        pws = [OLD] + [f"Hist0ry-Pass-{i}!zz" for i in range(1, 6)]
        for pw in pws[1:]:
            set_officer_password(user, pw)
        assert PasswordHistory.objects.filter(user=user).count() == PASSWORD_HISTORY_KEEP - 1
        c = _client(user)
        # current + the 4 before it are refused; the 6th-newest (OLD) may return.
        for pw in pws[1:]:
            res = c.post(CHANGE, {"old_password": pws[-1], "new_password": pw}, format="json")
            assert res.status_code == 400, pw
            assert res.data["new_password"][0]["code"] == "password_reused"
        assert PasswordHistory.objects.filter(user=user).count() == PASSWORD_HISTORY_KEEP - 1

    def test_the_oldest_one_may_be_reused(self, django_user_model, cn_tenant):
        user = _officer(django_user_model, cn_tenant)
        for i in range(1, 6):
            set_officer_password(user, f"Hist0ry-Pass-{i}!zz")
        res = _client(user).post(CHANGE, {"old_password": "Hist0ry-Pass-5!zz", "new_password": OLD}, format="json")
        assert res.status_code == 200, res.data

    def test_email_reset_checks_the_history_too(self, django_user_model, cn_tenant):
        from apps.authentication import officer_reset

        user = _officer(django_user_model, cn_tenant)
        set_officer_password(user, GOOD)
        user.email_verified_address = user.email
        user.save(update_fields=["email_verified_address"])
        token = officer_reset.reset_tokens.make_token(user)
        with pytest.raises(officer_reset.ResetRefusedError) as exc:
            officer_reset.confirm_reset(officer_reset.encode_uid(user), token, OLD)
        assert exc.value.code == "weak_password" and exc.value.reasons[0]["code"] == "password_reused"

    def test_souls_are_not_checked(self, soul):
        set_officer_password(soul, GOOD)
        assert not PasswordHistory.objects.filter(user=soul).exists()


# ── 必须先改密码(首登 / 管理员重置 / 超期) ─────────────────────────────────────


class TestMustChangePassword:
    def test_login_succeeds_and_says_so_but_other_endpoints_are_403(self, django_user_model, cn_tenant):
        user = _officer(django_user_model, cn_tenant, must_change_password=True)
        res = APIClient().post(LOGIN, {"username": "pol", "password": OLD}, format="json", REMOTE_ADDR="198.51.100.9")
        assert res.status_code == 200 and res.data["user"]["password_change_required"] is True
        c = _client(user)
        blocked = c.get(USERS)
        assert blocked.status_code == 403 and blocked.data["code"] == "password_change_required"
        assert c.get("/api/v1/auth/mfa/status/").status_code == 403
        assert c.patch(PROFILE, {"position": "x"}, format="json").status_code == 403
        assert c.get(PROFILE).status_code == 200 and c.get(PROFILE).data["password_change_required"] is True

    def test_changing_the_password_lifts_it(self, django_user_model, cn_tenant):
        user = _officer(django_user_model, cn_tenant, must_change_password=True)
        c = _client(user)
        assert c.post(CHANGE, {"old_password": OLD, "new_password": GOOD}, format="json").status_code == 200
        user.refresh_from_db()
        assert user.must_change_password is False
        assert _client(user).get("/api/v1/auth/mfa/status/").status_code == 200

    def test_an_unmarked_officer_is_untouched(self, django_user_model, cn_tenant):
        assert _client(_officer(django_user_model, cn_tenant)).get("/api/v1/auth/mfa/status/").status_code == 200

    def test_admin_creating_an_officer_marks_them(self, admin_user):
        res = _client(admin_user).post(USERS, {"username": "fresh", "email": "fresh@example.com", "password": "A-Long-Pass-1!x",
                                              "role": "JUDGE"}, format="json")
        assert res.status_code == 201, res.data
        from apps.authentication.models import User

        assert User.objects.get(username="fresh").must_change_password is True

    def test_admin_resetting_a_password_voids_it_and_returns_a_link(self, admin_user, django_user_model, cn_tenant):
        """第 8 条:不再回明文;旧密码当场作废,账号回到「待设密码」,返回 24 小时的一次性链接。"""
        user = _officer(django_user_model, cn_tenant)
        res = _client(admin_user).post(f"{USERS}{user.pk}/reset_password/")
        assert res.status_code == 200, res.data
        assert "password" not in res.data and "/accept-invite?uid=" in res.data["link"]
        assert res.data["expires_in"] == 24 * 3600
        user.refresh_from_db()
        assert not user.has_usable_password() and not user.check_password(OLD)


class TestMaxAge:
    def test_off_by_default(self, django_user_model, cn_tenant, settings):
        user = _officer(django_user_model, cn_tenant)
        user.password_changed_at = timezone.now() - timedelta(days=3650)
        user.save(update_fields=["password_changed_at"])
        assert settings.OFFICER_PASSWORD_MAX_AGE_DAYS == 0
        assert _client(user).get("/api/v1/auth/mfa/status/").status_code == 200

    def test_expired_when_on(self, django_user_model, cn_tenant, settings):
        settings.OFFICER_PASSWORD_MAX_AGE_DAYS = 90
        user = _officer(django_user_model, cn_tenant)
        c = _client(user)
        assert c.get("/api/v1/auth/mfa/status/").status_code == 200
        user.password_changed_at = timezone.now() - timedelta(days=91)
        user.save(update_fields=["password_changed_at"])
        res = c.get("/api/v1/auth/mfa/status/")
        assert res.status_code == 403 and res.data["code"] == "password_change_required"
        assert c.post(CHANGE, {"old_password": OLD, "new_password": GOOD}, format="json").status_code == 200
        user.refresh_from_db()  # the change bumped session_version
        assert _client(user).get("/api/v1/auth/mfa/status/").status_code == 200

    def test_souls_never_expire(self, soul, settings):
        settings.OFFICER_PASSWORD_MAX_AGE_DAYS = 1
        soul.password_changed_at = timezone.now() - timedelta(days=30)
        from apps.authentication.passwords import password_change_required

        assert password_change_required(soul) is False


# ── 管理员 12 位 ──────────────────────────────────────────────────────────────


class TestAdminMinimumLength:
    def test_admin_needs_twelve_others_eight(self, admin_user, django_user_model, cn_tenant):
        short = "Xk9!mQ2zPw"  # 10
        from apps.authentication.passwords import weak_password_reasons

        assert [r["code"] for r in weak_password_reasons(short, admin_user)] == ["password_too_short"]
        assert weak_password_reasons(short, _officer(django_user_model, cn_tenant)) == []
        assert weak_password_reasons(short + "ab", admin_user) == []

    def test_creating_an_admin_with_a_short_password_is_refused(self, admin_user):
        res = _client(admin_user).post(USERS, {"username": "ad2", "email": "ad2@example.com", "password": "Xk9!mQ2zPw",
                                              "role": "ADMIN"}, format="json")
        assert res.status_code == 400 and "password" in res.data
