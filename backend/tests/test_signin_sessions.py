"""登录设备(Design 第二十八批 W2 / S1):一台设备一行 `SignInSession`,`sid` 声明随刷新令牌轮换延续。

钉住的东西:每条登录路径都建会话、刷新沿用同一个会话并记活动、退出一台后它的刷新与 access 都失效而别的照常、
退出时「30 天内不再询问」一并作废、退出其他全部留住这台、改密码同步标记其他会话、别人的会话 id 一律 404、
30 天没活动不列出、灵魂登录记录合并连续失败并清掉 90 天前的、标签解析。
"""
import time
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.authentication import mfa as core
from apps.authentication import signin_sessions
from apps.authentication.models import LoginLog, MfaRememberedDevice, SignInSession
from apps.authentication.tasks import prune_soul_sign_ins
from apps.soul_accounts import mfa as soul_mfa
from apps.soul_accounts.models import SoulMfaDevice
from tests.soul_account_support import clear_soul_login_counters, ready_soul

pytestmark = pytest.mark.django_db

LOGIN = "/api/v1/auth/login/"
OFFICER_LOGIN = "/api/v1/auth/officer-login/"
REFRESH = "/api/v1/auth/refresh/"
PROFILE = "/api/v1/auth/profile/"
SESSIONS = "/api/v1/auth/sessions/"
CHANGE = "/api/v1/auth/change-password/"
PASSWORD = "OldPass!123-x"
NEW = "N0t-Guessable!2026-b"
SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Edg/124.0"

_ip = iter(range(10, 250))


@pytest.fixture(autouse=True)
def _clean():
    cache.clear()
    clear_soul_login_counters()
    yield
    cache.clear()
    clear_soul_login_counters()


@pytest.fixture
def officer(django_user_model, cn_tenant):
    return django_user_model.objects.create_user(
        username="two_devices", email="two@example.com", password=PASSWORD, role="JUDGE", tenant=cn_tenant)


def _login(user_agent=SAFARI, username="two_devices", **extra):
    res = APIClient().post(LOGIN, {"username": username, "password": PASSWORD}, format="json",
                           REMOTE_ADDR=f"198.51.100.{next(_ip)}", HTTP_USER_AGENT=user_agent, **extra)
    assert res.status_code == 200, res.content
    return res.data


def _as(device):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {device['access']}")
    return c


def _listing(device):
    res = _as(device).get(SESSIONS)
    assert res.status_code == 200, res.content
    return res.data


def _refresh(device):
    return APIClient().post(REFRESH, {"refresh": device["refresh"]}, format="json")


def _revoke(device, session_id):
    return _as(device).post(f"{SESSIONS}{session_id}/revoke/")


# ── 每条登录路径都建会话 ───────────────────────────────────────────────────


class TestSessionIsCreatedAtEverySignIn:
    def test_password_login_creates_one_session_with_a_label_and_sid_claim(self, officer):
        device = _login()
        session = SignInSession.objects.get()
        assert (session.user, session.label, session.method) == (officer, "macOS · Safari", "password")
        from rest_framework_simplejwt.tokens import AccessToken

        assert AccessToken(device["access"])["sid"] == str(session.pk)

    def test_officer_app_login_is_labelled_as_the_app(self, officer):
        res = APIClient().post(OFFICER_LOGIN, {"username": "two_devices", "password": PASSWORD}, format="json",
                               REMOTE_ADDR=f"198.51.100.{next(_ip)}",
                               HTTP_USER_AGENT="Expo/1 CFNetwork/1494 Darwin/23.4")
        assert res.status_code == 200, res.content
        assert SignInSession.objects.get().label == "官员 App · iPhone"

    def test_second_step_creates_the_session_and_a_recovery_code_is_recorded_as_such(self, officer):
        row = core.begin_setup(officer)
        core.confirm_setup(row, core.totp_at(row.secret, int(time.time() // core.TOTP_STEP_SECONDS)))
        codes = core.regenerate_recovery_codes(core.get_mfa(officer))
        core.complete_setup(core.get_mfa(officer))
        step1 = APIClient().post(LOGIN, {"username": "two_devices", "password": PASSWORD}, format="json",
                                 REMOTE_ADDR=f"198.51.100.{next(_ip)}")
        assert step1.data["mfa_required"] is True
        assert SignInSession.objects.count() == 0  # 第二步没过,不发令牌也不建会话
        res = APIClient().post("/api/v1/auth/mfa/verify/", {
            "pending_token": step1.data["pending_token"], "recovery_code": codes[0], "remember_device": True,
        }, format="json", HTTP_USER_AGENT=EDGE)
        assert res.status_code == 200, res.content
        session = SignInSession.objects.get()
        assert (session.method, session.label) == ("recovery", "Windows · Edge")
        assert session.trust_hash  # 记着刚下发的「30 天内不再询问」设备令牌

    def test_soul_password_login_and_face_login_each_create_one(self, cn_tenant):
        from apps.soul_accounts import device_login

        account, _ = ready_soul(cn_tenant)
        account.user.set_password(PASSWORD)
        account.user.save(update_fields=["password"])
        res = APIClient().post("/api/v1/soul-auth/login/", {"soul_code": account.soul.soul_code, "password": PASSWORD},
                               format="json", HTTP_USER_AGENT="okhttp/4.12", REMOTE_ADDR="203.0.113.5")
        assert res.status_code == 200, res.content
        raw = device_login.issue(account)
        res = APIClient().post("/api/v1/soul-auth/device-login/",
                               {"soul_code": account.soul.soul_code, "credential": raw},
                               format="json", HTTP_USER_AGENT="Expo/1 CFNetwork/1494 Darwin/23.4",
                               REMOTE_ADDR="203.0.113.6")
        assert res.status_code == 200, res.content
        assert sorted(SignInSession.objects.values_list("method", "label")) == [("face", "iPhone"),
                                                                              ("password", "Android")]


# ── 刷新沿用会话 ───────────────────────────────────────────────────────────


class TestRefreshKeepsTheSession:
    def test_rotation_keeps_the_same_sid_updates_last_seen_and_the_tracked_jti(self, officer):
        device = _login()
        session = SignInSession.objects.get()
        old_jti = session.refresh_jti
        SignInSession.objects.filter(pk=session.pk).update(last_seen_at=timezone.now() - timedelta(days=3))
        res = _refresh(device)
        assert res.status_code == 200, res.content
        session.refresh_from_db()
        assert SignInSession.objects.count() == 1
        assert session.last_seen_at > timezone.now() - timedelta(minutes=1)
        assert session.refresh_jti and session.refresh_jti != old_jti
        from rest_framework_simplejwt.tokens import AccessToken

        assert AccessToken(res.data["access"])["sid"] == str(session.pk)
        assert _refresh(res.data).status_code == 200  # 第二次轮换仍然沿用

    def test_a_revoked_session_cannot_refresh_and_its_access_dies_at_once(self, officer):
        a, b = _login(), _login()
        b_id = next(s["id"] for s in _listing(a) if not s["current"])
        assert _revoke(a, b_id).status_code == 204
        assert _refresh(b).status_code == 401
        assert _as(b).get(PROFILE).status_code == 401  # access 不等自然过期
        assert _as(a).get(PROFILE).status_code == 200 and _refresh(a).status_code == 200


# ── 列表 ───────────────────────────────────────────────────────────────────


class TestListing:
    def test_this_device_first_then_by_last_activity_and_no_location_field(self, officer):
        _login(EDGE)
        new, mine = _login(SAFARI), _login(SAFARI)
        SignInSession.objects.filter(label="Windows · Edge").update(last_seen_at=timezone.now() - timedelta(days=5))
        SignInSession.objects.filter(pk=signin_sessions.session_of(_token(new)).pk).update(
            last_seen_at=timezone.now() - timedelta(days=1))
        rows = _listing(mine)
        assert [r["current"] for r in rows] == [True, False, False]
        assert [r["label"] for r in rows] == ["macOS · Safari", "macOS · Safari", "Windows · Edge"]
        assert rows[1]["last_seen_at"] > rows[2]["last_seen_at"]
        assert set(rows[0]) == {"id", "label", "method", "last_seen_at", "current", "trusted_until"}

    def test_idle_for_over_thirty_days_and_revoked_are_not_listed(self, officer):
        mine, idle, gone = _login(), _login(EDGE), _login(EDGE)
        SignInSession.objects.filter(pk=signin_sessions.session_of(_token(idle)).pk).update(
            last_seen_at=timezone.now() - timedelta(days=31))
        SignInSession.objects.filter(pk=signin_sessions.session_of(_token(gone)).pk).update(revoked_at=timezone.now())
        assert [r["current"] for r in _listing(mine)] == [True]

    def test_the_trust_tag_shows_the_expiry_of_the_remembered_device(self, officer):
        mine = _login()
        raw = core.remember_device(officer)
        SignInSession.objects.update(trust_hash=core._hash_device(raw))
        row = _listing(mine)[0]
        assert row["trusted_until"] is not None
        MfaRememberedDevice.objects.update(expires_at=timezone.now() - timedelta(days=1))
        assert _listing(mine)[0]["trusted_until"] is None


def _token(device):
    from rest_framework_simplejwt.exceptions import TokenError
    from rest_framework_simplejwt.tokens import AccessToken

    from apps.soul_accounts.authentication import SoulAccessToken

    try:
        return AccessToken(device["access"])
    except TokenError:  # 灵魂的 access 是另一种令牌类型
        return SoulAccessToken(device["access"])


# ── 退出 ───────────────────────────────────────────────────────────────────


class TestRevoke:
    def test_revoking_one_blacklists_its_refresh_revokes_its_trust_and_leaves_others(self, officer):
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

        a, b, c = _login(), _login(), _login()
        target = signin_sessions.session_of(_token(b))
        raw = core.remember_device(officer)
        SignInSession.objects.filter(pk=target.pk).update(trust_hash=core._hash_device(raw))
        assert _revoke(a, target.pk).status_code == 204
        target.refresh_from_db()
        assert target.revoked_at is not None
        assert BlacklistedToken.objects.filter(token__jti=target.refresh_jti).exists()
        assert not MfaRememberedDevice.objects.exists()
        assert _refresh(b).status_code == 401
        assert _refresh(c).status_code == 200
        assert len(_listing(a)) == 2
        assert AuditLog.objects.filter(resource="auth", description__startswith="官员退出登录设备").count() == 1

    def test_the_current_device_cannot_be_revoked_here(self, officer):
        a = _login()
        current = _listing(a)[0]["id"]
        res = _revoke(a, current)
        assert res.status_code == 400 and res.data["code"] == "current_session"
        assert SignInSession.objects.get(pk=current).revoked_at is None
        assert _as(a).get(PROFILE).status_code == 200

    def test_revoke_others_keeps_this_one_and_voids_their_trust(self, officer):
        a, b, c = _login(), _login(), _login()
        for token in (b, c):
            raw = core.remember_device(officer)
            SignInSession.objects.filter(pk=signin_sessions.session_of(_token(token)).pk).update(
                trust_hash=core._hash_device(raw))
        keep_raw = core.remember_device(officer)
        SignInSession.objects.filter(pk=signin_sessions.session_of(_token(a)).pk).update(
            trust_hash=core._hash_device(keep_raw))
        res = _as(a).post(SESSIONS + "revoke-others/")
        assert (res.status_code, res.data) == (200, {"revoked": 2})
        assert [r["current"] for r in _listing(a)] == [True]
        assert _refresh(b).status_code == 401 and _refresh(c).status_code == 401
        assert _as(b).get(PROFILE).status_code == 401
        assert _refresh(a).status_code == 200 and _as(a).get(PROFILE).status_code == 200
        assert list(MfaRememberedDevice.objects.values_list("token_hash", flat=True)) == [core._hash_device(keep_raw)]
        assert AuditLog.objects.filter(description__startswith="官员退出其他全部登录设备(2 台)").count() == 1

    def test_revoke_others_also_blacklists_old_tokens_that_carry_no_sid(self, officer):
        from rest_framework_simplejwt.tokens import RefreshToken

        legacy = RefreshToken.for_user(officer)  # 功能上线前签发的:没有 sid
        a = _login()
        assert _as(a).post(SESSIONS + "revoke-others/").status_code == 200
        res = APIClient().post(REFRESH, {"refresh": str(legacy)}, format="json")
        assert res.status_code == 401

    def test_a_token_without_sid_cannot_say_which_device_is_this_one(self, officer):
        from rest_framework_simplejwt.tokens import RefreshToken

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(officer).access_token}")
        res = client.post(SESSIONS + "revoke-others/")
        assert (res.status_code, res.data["code"]) == (409, "session_unknown")


# ── 别人的会话 ─────────────────────────────────────────────────────────────


class TestOwnerScoping:
    def test_another_users_session_is_404_and_untouched_and_never_listed(self, officer, django_user_model, cn_tenant):
        other = django_user_model.objects.create_user(
            username="someone_else", email="se@example.com", password=PASSWORD, role="JUDGE", tenant=cn_tenant)
        mine = _login()
        theirs = _login(username="someone_else")
        their_id = _listing(theirs)[0]["id"]
        res = _revoke(mine, their_id)
        assert (res.status_code, res.data["code"]) == (404, "not_found")
        assert SignInSession.objects.get(pk=their_id).revoked_at is None
        assert _as(theirs).get(PROFILE).status_code == 200
        assert their_id not in [r["id"] for r in _listing(mine)]
        _as(mine).post(SESSIONS + "revoke-others/")
        assert SignInSession.objects.get(pk=their_id).revoked_at is None
        assert SignInSession.objects.filter(user=other, revoked_at__isnull=True).count() == 1

    def test_a_soul_token_is_refused_by_the_officer_endpoints_and_vice_versa(self, cn_tenant, officer):
        account, soul = ready_soul(cn_tenant)
        assert soul.get(SESSIONS).status_code == 403
        assert _as(_login()).get("/api/v1/me/sessions/").status_code == 403


# ── 改密码 ─────────────────────────────────────────────────────────────────


class TestPasswordChange:
    def test_officer_change_keeps_this_device_and_marks_the_rest_revoked_with_their_trust(self, officer):
        a, b = _login(), _login()
        raw = core.remember_device(officer)
        SignInSession.objects.filter(pk=signin_sessions.session_of(_token(b)).pk).update(
            trust_hash=core._hash_device(raw))
        mine = signin_sessions.session_of(_token(a))
        res = _as(a).post(CHANGE, {"old_password": PASSWORD, "new_password": NEW, "refresh": a["refresh"]},
                          format="json")
        assert res.status_code == 200, res.content
        assert SignInSession.objects.filter(revoked_at__isnull=True).get().pk == mine.pk
        assert not MfaRememberedDevice.objects.exists()
        fresh = {"access": res.data["access"], "refresh": res.data["refresh"]}
        assert [r["current"] for r in _listing(fresh)] == [True]  # 新令牌带着同一个 sid
        assert _refresh(fresh).status_code == 200
        assert _refresh(b).status_code == 401

    def test_officer_change_without_a_refresh_token_signs_this_device_out_too(self, officer):
        a = _login()
        res = _as(a).post(CHANGE, {"old_password": PASSWORD, "new_password": NEW}, format="json")
        assert res.status_code == 200
        assert not SignInSession.objects.filter(revoked_at__isnull=True).exists()

    def test_soul_change_keeps_the_calling_phone_and_revokes_the_others(self, cn_tenant):
        account, _ = ready_soul(cn_tenant)
        account.user.set_password(PASSWORD)
        account.user.save(update_fields=["password"])

        def login():
            res = APIClient().post("/api/v1/soul-auth/login/",
                                   {"soul_code": account.soul.soul_code, "password": PASSWORD}, format="json",
                                   REMOTE_ADDR="203.0.113.9")
            assert res.status_code == 200, res.content
            return res.data

        phone, other = login(), login()
        SoulMfaDevice.objects.create(account=account, token_hash="t" * 64, expires_at=timezone.now() + timedelta(days=1))
        res = _as(phone).post("/api/v1/me/password/", {"old_password": PASSWORD, "new_password": NEW}, format="json")
        assert res.status_code == 200, res.content
        survivors = SignInSession.objects.filter(revoked_at__isnull=True)
        assert survivors.count() == 1
        fresh = {"access": res.data["access"], "refresh": res.data["refresh"]}
        rows = _as(fresh).get("/api/v1/me/sessions/").data
        assert [r["current"] for r in rows] == [True]
        assert APIClient().post("/api/v1/soul-auth/refresh/", {"refresh": other["refresh"]}, format="json"
                                ).status_code == 401


# ── 灵魂端:退出一台、登录记录 ─────────────────────────────────────────────


class TestSoulSide:
    def _account(self, cn_tenant):
        account, _ = ready_soul(cn_tenant)
        account.user.set_password(PASSWORD)
        account.user.save(update_fields=["password"])
        return account

    def _login(self, account, ua="okhttp/4.12", password=PASSWORD, ip="203.0.113.20"):
        return APIClient().post("/api/v1/soul-auth/login/",
                                {"soul_code": account.soul.soul_code, "password": password}, format="json",
                                HTTP_USER_AGENT=ua, REMOTE_ADDR=ip)

    def test_soul_revoke_one_and_others_work_and_are_scoped(self, cn_tenant):
        account = self._account(cn_tenant)
        stranger = self._account(cn_tenant)
        phone, tablet = self._login(account).data, self._login(account, "Expo/1 CFNetwork/1 Darwin/1").data
        theirs = self._login(stranger).data
        their_id = _as(theirs).get("/api/v1/me/sessions/").data[0]["id"]
        assert _as(phone).post(f"/api/v1/me/sessions/{their_id}/revoke/").status_code == 404
        rows = _as(phone).get("/api/v1/me/sessions/").data
        assert [r["current"] for r in rows] == [True, False]
        assert _as(phone).post(f"/api/v1/me/sessions/{rows[0]['id']}/revoke/").status_code == 400
        res = _as(phone).post("/api/v1/me/sessions/revoke-others/")
        assert (res.status_code, res.data) == (200, {"revoked": 1})
        assert APIClient().post("/api/v1/soul-auth/refresh/", {"refresh": tablet["refresh"]}, format="json"
                                ).status_code == 401
        assert _as(tablet).get("/api/v1/me/").status_code == 401
        assert _as(theirs).get("/api/v1/me/").status_code == 200

    def test_a_soul_mfa_trust_device_dies_with_the_session_that_used_it(self, cn_tenant):
        account = self._account(cn_tenant)
        phone = self._login(account).data
        raw = soul_mfa.remember_device(account)
        other = self._login(account, ip="203.0.113.21").data
        SignInSession.objects.filter(pk=signin_sessions.session_of(_token(other)).pk).update(
            trust_hash=core._hash_device(raw))
        assert _as(phone).get("/api/v1/me/sessions/").data[1]["trusted_until"] is not None
        _as(phone).post("/api/v1/me/sessions/revoke-others/")
        assert not SoulMfaDevice.objects.exists()

    def test_sign_in_history_merges_consecutive_failures_and_marks_method(self, cn_tenant):
        account = self._account(cn_tenant)
        for _ in range(3):
            assert self._login(account, password="wrong-password-1").status_code == 401
        ok = self._login(account)
        history = _as(ok.data).get("/api/v1/me/sign-ins/").data
        assert [(r["ok"], r["count"], r["method"]) for r in history] == [(True, 1, "password"), (False, 3, "password")]
        assert history[1]["reason"] == "invalid_credentials" and history[1]["device"] == "Android"
        assert self._login(account, password="wrong-password-1").status_code == 401  # 成功之后的失败不并入更早的
        history = _as(ok.data).get("/api/v1/me/sign-ins/").data
        assert [(r["ok"], r["count"]) for r in history] == [(False, 1), (True, 1), (False, 3)]

    def test_history_is_only_this_accounts_and_only_ninety_days(self, cn_tenant):
        account, other = self._account(cn_tenant), self._account(cn_tenant)
        self._login(other)
        old = self._login(account).data
        LoginLog.objects.filter(user=account.user).update(timestamp=timezone.now() - timedelta(days=91))
        new = self._login(account, ip="203.0.113.22").data
        history = _as(new).get("/api/v1/me/sign-ins/").data
        assert len(history) == 1 and old and history[0]["ok"] is True

    def test_prune_deletes_soul_logs_and_idle_sessions_past_ninety_days_and_spares_officers(self, officer, cn_tenant):
        account = self._account(cn_tenant)
        self._login(account)
        _login()
        stale = timezone.now() - timedelta(days=91)
        LoginLog.objects.update(timestamp=stale)
        LoginLog.objects.create(username="plain", status="FAILED", failure_reason="x")
        SignInSession.objects.update(last_seen_at=stale)
        result = prune_soul_sign_ins()
        assert result == {"sign_in_logs": 1, "sessions": 2}
        assert set(LoginLog.objects.values_list("username", flat=True)) == {"two_devices", "plain"}


# ── 标签 ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("ua", "officer_app", "expected"), [
    (SAFARI, False, "macOS · Safari"),
    (EDGE, False, "Windows · Edge"),
    ("Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0", False, "Linux · Firefox"),
    ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1",
     False, "iPhone · Safari"),
    ("okhttp/4.12.0", False, "Android"),
    ("Expo/1 CFNetwork/1494 Darwin/23.4", False, "iPhone"),
    ("okhttp/4.12.0", True, "官员 App · Android"),
    ("", False, "未知设备"),
    ("", True, "官员 App"),
])
def test_label_from_user_agent(ua, officer_app, expected):
    assert signin_sessions.label_for(ua, officer_app=officer_app) == expected


def test_an_explicit_device_label_header_wins_and_is_cleaned():
    assert signin_sessions.label_for(SAFARI, explicit="  我的\x00 iPhone ") == "我的 iPhone"
