"""官员「忘记密码」(邮箱重置链接)与邮箱验证,2026-10-09。规则见 apps/authentication/officer_reset.py。

要钉住的:
- 申请端对一切标识给同一个 200(存在 / 不存在 / 未验证 / 灵魂 / 停用),只有「在职、官员、邮箱已验证」的收到信;
- 邮箱一改,已验证标志立刻失效,旧的重置链接也失效;
- 令牌一次性(用过即废)、过期即废、串改即废;
- 确认重置:跑密码校验器、吊销所有刷新令牌、清「不再询问」设备令牌但**不关两步验证**、写审计行、发改密通知。
"""
import re
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.core import mail
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditLog
from apps.authentication import officer_reset, tasks
from apps.authentication.models import MfaRememberedDevice, OfficerMfa

REQUEST = "/api/v1/auth/officer-reset/request/"
CONFIRM = "/api/v1/auth/officer-reset/confirm/"
SEND_VERIFY = "/api/v1/auth/email/send-verification/"
VERIFY = "/api/v1/auth/email/verify/"
EMAIL = "officer-pw@example.com"
NEW_PASSWORD = "N0t-Guessable!2026-b"


@pytest.fixture(autouse=True)
def _clean(db):
    cache.clear()
    mail.outbox.clear()
    with patch.object(tasks.send_officer_reset_mail, "delay", side_effect=tasks.send_officer_reset_mail.run):
        yield
    cache.clear()


@pytest.fixture
def officer(django_user_model, cn_tenant):
    user = django_user_model.objects.create_user(
        username="pw_officer", email=EMAIL, password="OldPass!123", role="JUDGE", tenant=cn_tenant,
    )
    user.email_verified_address = EMAIL
    user.email_verified_at = timezone.now()
    user.save(update_fields=["email_verified_address", "email_verified_at"])
    return user


def _ask(identifier, ip="198.51.100.10"):
    return APIClient().post(REQUEST, {"identifier": identifier}, format="json", REMOTE_ADDR=ip)


def _link_params():
    """(uid, token) from the one reset mail in the outbox."""
    body = mail.outbox[-1].body
    match = re.search(r"/reset-password\?uid=([^&\s]+)&token=([^\s]+)", body)
    assert match, body
    return match.group(1), match.group(2)


def _confirm(uid, token, password=NEW_PASSWORD, ip="198.51.100.20"):
    return APIClient().post(
        CONFIRM, {"uid": uid, "token": token, "new_password": password}, format="json", REMOTE_ADDR=ip
    )


class TestRequest:
    def test_verified_officer_gets_a_link_by_username_and_by_email(self, officer):
        assert _ask("pw_officer").status_code == 200
        assert len(mail.outbox) == 1 and mail.outbox[0].to == [EMAIL]
        assert "/reset-password?uid=" in mail.outbox[0].body
        assert _ask(EMAIL.upper(), ip="198.51.100.11").status_code == 200
        assert len(mail.outbox) == 2

    def test_every_identifier_gets_the_same_answer(self, officer, django_user_model, cn_tenant):
        django_user_model.objects.create_user(
            username="unverified", email="unv@example.com", password="x", role="JUDGE", tenant=cn_tenant
        )
        django_user_model.objects.create_user(
            username="a_soul", email="soul@example.com", password="x", role="SOUL", tenant=cn_tenant
        )
        inactive = django_user_model.objects.create_user(
            username="gone", email="gone@example.com", password="x", role="JUDGE", tenant=cn_tenant, is_active=False
        )
        inactive.email_verified_address = "gone@example.com"
        inactive.save(update_fields=["email_verified_address"])
        answers = [
            _ask(who, ip=f"198.51.100.{30 + i}")
            for i, who in enumerate(["pw_officer", "unverified", "a_soul", "gone", "nobody-here", "x@example.com"])
        ]
        assert {a.status_code for a in answers} == {200}
        assert len({a.content for a in answers}) == 1
        # Presence beside the equality: only the verified officer got anything.
        assert [m.to for m in mail.outbox] == [[EMAIL]]

    def test_unverified_email_gets_nothing(self, officer):
        officer.email_verified_address = ""
        officer.save(update_fields=["email_verified_address"])
        _ask("pw_officer")
        assert mail.outbox == []

    def test_changing_the_email_clears_the_verified_state(self, officer):
        assert officer.email_verified is True
        officer.email = "other@example.com"
        officer.save(update_fields=["email"])
        assert officer.email_verified is False
        _ask("pw_officer")
        assert mail.outbox == []

    def test_per_ip_throttle_refuses_every_identifier_alike(self, officer):
        codes = [_ask(f"who{i}", ip="198.51.100.40").status_code for i in range(7)]
        assert codes[:5] == [200] * 5 and codes[5] == 429

    def test_per_account_limit_is_silent(self, officer):
        for i in range(5):
            assert _ask("pw_officer", ip=f"198.51.100.{50 + i}").status_code == 200
        assert len(mail.outbox) == officer_reset.MAX_MAILS_PER_ACCOUNT_PER_HOUR

    def test_mail_is_in_the_users_email_locale(self, officer):
        officer.preferences = {"email_locale": "en"}
        officer.save(update_fields=["preferences"])
        _ask("pw_officer")
        assert "Reset your password" in mail.outbox[0].subject

    def test_broker_down_still_sends(self, officer):
        with patch.object(tasks.send_officer_reset_mail, "delay", side_effect=ConnectionError("down")):
            assert _ask("pw_officer").status_code == 200
        assert len(mail.outbox) == 1


class TestConfirm:
    def test_resets_and_signs_everything_out(self, officer):
        mfa = OfficerMfa.objects.create(user=officer, secret="JBSWY3DPEHPK3PXP", confirmed_at=timezone.now())
        MfaRememberedDevice.objects.create(user=officer, token_hash="a" * 64, expires_at=timezone.now() + timedelta(days=5))
        refresh = RefreshToken.for_user(officer)
        _ask("pw_officer")
        uid, token = _link_params()
        mail.outbox.clear()

        res = _confirm(uid, token)

        assert res.status_code == 200
        officer.refresh_from_db()
        assert officer.check_password(NEW_PASSWORD)
        assert BlacklistedToken.objects.filter(token__jti=refresh["jti"]).exists()
        assert not OutstandingToken.objects.filter(user=officer, blacklistedtoken__isnull=True).exists()
        assert not MfaRememberedDevice.objects.filter(user=officer).exists()
        # 2FA is NOT disabled: the next login still asks for the code.
        assert OfficerMfa.objects.filter(pk=mfa.pk, confirmed_at__isnull=False).exists()
        row = AuditLog.objects.filter(resource="auth", resource_id=str(officer.pk), description__contains="重置密码").first()
        assert row is not None and row.changes["sessions_revoked"] is True
        assert [m.to for m in mail.outbox] == [[EMAIL]], "the 'password changed' notice"

    def test_a_link_works_once(self, officer):
        _ask("pw_officer")
        uid, token = _link_params()
        assert _confirm(uid, token).status_code == 200
        again = _confirm(uid, token, password="An0ther-Good!2026")
        assert again.status_code == 400 and again.data["code"] == "reset_link_invalid"

    def test_expired_tampered_and_unknown_links_are_one_refusal(self, officer):
        _ask("pw_officer")
        uid, token = _link_params()
        with patch("django.contrib.auth.tokens.PasswordResetTokenGenerator._now",
                   return_value=timezone.now() + timedelta(hours=2)):
            expired = _confirm(uid, token)
        tampered = _confirm(uid, token[:-1] + ("a" if token[-1] != "a" else "b"))
        unknown = _confirm("MTIzNDU2", token)
        garbage = _confirm("***", token)
        assert {r.status_code for r in (expired, tampered, unknown, garbage)} == {400}
        assert {r.data["code"] for r in (expired, tampered, unknown, garbage)} == {"reset_link_invalid"}
        officer.refresh_from_db()
        assert officer.check_password("OldPass!123")

    def test_changing_the_email_kills_an_outstanding_link(self, officer):
        _ask("pw_officer")
        uid, token = _link_params()
        officer.email = "new@example.com"
        officer.save(update_fields=["email"])
        assert _confirm(uid, token).data["code"] == "reset_link_invalid"

    def test_a_login_kills_an_outstanding_link(self, officer):
        _ask("pw_officer")
        uid, token = _link_params()
        officer.last_login = timezone.now()
        officer.save(update_fields=["last_login"])
        assert _confirm(uid, token).data["code"] == "reset_link_invalid"

    def test_weak_password_is_refused_and_the_link_survives(self, officer):
        _ask("pw_officer")
        uid, token = _link_params()
        res = _confirm(uid, token, password="12345678")
        assert res.status_code == 400 and res.data["code"] == "weak_password"
        assert _confirm(uid, token).status_code == 200

    def test_a_soul_cannot_use_the_officer_flow(self, django_user_model, cn_tenant):
        soul = django_user_model.objects.create_user(
            username="s1", email="s1@example.com", password="x", role="SOUL", tenant=cn_tenant
        )
        soul.email_verified_address = soul.email
        soul.save(update_fields=["email_verified_address"])
        token = officer_reset.reset_tokens.make_token(soul)
        res = _confirm(officer_reset.encode_uid(soul), token)
        assert res.data["code"] == "reset_link_invalid"
        soul.refresh_from_db()
        assert soul.check_password("x")


class TestVerification:
    def _client(self, user):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
        return client

    def _unverified(self, officer):
        officer.email_verified_address = ""
        officer.email_verified_at = None
        officer.save(update_fields=["email_verified_address", "email_verified_at"])

    def test_send_then_click_verifies(self, officer):
        self._unverified(officer)
        assert self._client(officer).post(SEND_VERIFY).status_code == 200
        body = mail.outbox[0].body
        uid, token = re.search(r"/verify-email\?uid=([^&\s]+)&token=([^\s]+)", body).groups()
        res = APIClient().post(VERIFY, {"uid": uid, "token": token}, format="json")
        assert res.status_code == 200
        officer.refresh_from_db()
        assert officer.email_verified is True and officer.email_verified_at is not None
        # single use: the address is in the hash now
        assert APIClient().post(VERIFY, {"uid": uid, "token": token}, format="json").data["code"] == "verify_link_invalid"

    def test_a_verify_link_is_not_a_reset_link(self, officer):
        self._unverified(officer)
        self._client(officer).post(SEND_VERIFY)
        uid, token = re.search(r"/verify-email\?uid=([^&\s]+)&token=([^\s]+)", mail.outbox[0].body).groups()
        officer.email_verified_address = officer.email
        officer.save(update_fields=["email_verified_address"])
        assert _confirm(uid, token).data["code"] == "reset_link_invalid"

    def test_verify_link_for_an_old_address_does_not_verify_the_new_one(self, officer):
        self._unverified(officer)
        self._client(officer).post(SEND_VERIFY)
        uid, token = re.search(r"/verify-email\?uid=([^&\s]+)&token=([^\s]+)", mail.outbox[0].body).groups()
        officer.email = "swapped@example.com"
        officer.save(update_fields=["email"])
        assert APIClient().post(VERIFY, {"uid": uid, "token": token}, format="json").status_code == 400
        officer.refresh_from_db()
        assert officer.email_verified is False

    def test_send_is_limited_per_hour_and_needs_login_and_an_email(self, officer):
        self._unverified(officer)
        client = self._client(officer)
        statuses = [client.post(SEND_VERIFY).status_code for _ in range(6)]
        assert statuses == [200] * 5 + [429]
        assert APIClient().post(SEND_VERIFY).status_code == 401
        officer.email = ""
        officer.save(update_fields=["email"])
        cache.clear()
        assert self._client(officer).post(SEND_VERIFY).data["code"] == "no_email"

    def test_profile_reports_email_verified_and_a_change_flips_it(self, officer):
        client = self._client(officer)
        assert client.get("/api/v1/auth/profile/").data["email_verified"] is True
        res = client.patch("/api/v1/auth/profile/", {"email": "fresh@example.com"}, format="json")
        assert res.status_code == 200 and res.data["email_verified"] is False
