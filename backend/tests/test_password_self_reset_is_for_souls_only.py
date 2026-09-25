"""Email self-reset is for soul accounts only (2026-09 product decision).

Officers are provisioned by an administrator and ask for help through
`/auth/password-help/`, which pages that administrator. Before this rule
`reset_password_request` / `set_new_password` matched ANY `User` by email, so an
officer's password could be reset by whoever read the officer's mailbox.

The refusal must not be visible: an officer's address, an unknown address and
a soul's address all get the same status and the same body, or the endpoint
answers "is this address an officer's?" to anyone who asks.
"""
import pytest
from django.core import mail
from django.core.cache import cache

REQUEST_URL = "/api/v1/auth/reset-password/"
SET_URL = "/api/v1/auth/set-new-password/"
SOUL_EMAIL = "soul-reset@example.com"
OFFICER_EMAIL = "officer-reset@example.com"
UNKNOWN_EMAIL = "nobody-at-all@example.com"
GOOD_PASSWORD = "N0t-Guessable!2026"


@pytest.fixture
def accounts(django_user_model, cn_tenant):
    cache.clear()
    mail.outbox.clear()
    soul = django_user_model.objects.create_user(
        username="soul_reset", email=SOUL_EMAIL, password="OldPass!123",
        role="SOUL", tenant=cn_tenant,
    )
    officer = django_user_model.objects.create_user(
        username="officer_reset", email=OFFICER_EMAIL, password="OldPass!123",
        role="JUDGE", tenant=cn_tenant,
    )
    yield soul, officer
    cache.clear()


def _request(api_client, email, ip):
    return api_client.post(REQUEST_URL, {"email": email}, format="json", REMOTE_ADDR=ip)


@pytest.mark.django_db
class TestResetRequest:
    def test_an_officer_email_stores_no_code_and_sends_no_mail(self, api_client, accounts):
        res = _request(api_client, OFFICER_EMAIL, "198.51.100.1")
        assert res.status_code == 200
        assert cache.get(f"pwd_reset:{OFFICER_EMAIL}") is None, "a code was stored for an officer"
        assert mail.outbox == [], "a reset mail was sent to an officer"

    @pytest.mark.parametrize("role", ["ADMIN", "MODERATOR", "GUARDIAN", "VIEWER"])
    def test_no_officer_role_is_let_through(self, api_client, django_user_model, cn_tenant, role):
        cache.clear()
        mail.outbox.clear()
        email = f"{role.lower()}-reset@example.com"
        django_user_model.objects.create_user(
            username=f"{role.lower()}_reset", email=email, password="OldPass!123",
            role=role, tenant=cn_tenant,
        )
        _request(api_client, email, "198.51.100.2")
        assert cache.get(f"pwd_reset:{email}") is None
        assert mail.outbox == []

    def test_a_soul_email_still_gets_its_code(self, api_client, accounts):
        res = _request(api_client, SOUL_EMAIL, "198.51.100.3")
        assert res.status_code == 200
        code = cache.get(f"pwd_reset:{SOUL_EMAIL}")
        assert code, "the soul's reset stopped working"
        assert len(mail.outbox) == 1 and mail.outbox[0].to == [SOUL_EMAIL]
        assert code in mail.outbox[0].body

    def test_soul_officer_and_unknown_get_identical_answers(self, api_client, accounts):
        soul = _request(api_client, SOUL_EMAIL, "198.51.100.4")
        officer = _request(api_client, OFFICER_EMAIL, "198.51.100.5")
        unknown = _request(api_client, UNKNOWN_EMAIL, "198.51.100.6")
        assert soul.status_code == officer.status_code == unknown.status_code == 200
        assert soul.content == officer.content == unknown.content
        # Presence alongside the equality: the soul did get a code, so the
        # identical bodies are hiding a real difference, not reporting none.
        assert cache.get(f"pwd_reset:{SOUL_EMAIL}")
        assert cache.get(f"pwd_reset:{OFFICER_EMAIL}") is None


@pytest.mark.django_db
class TestSetNewPassword:
    def test_a_planted_code_cannot_change_an_officer_password(self, api_client, accounts):
        _, officer = accounts
        cache.set(f"pwd_reset:{OFFICER_EMAIL}", "424242", timeout=300)
        res = api_client.post(
            SET_URL,
            {"email": OFFICER_EMAIL, "code": "424242", "new_password": GOOD_PASSWORD},
            format="json",
        )
        assert res.status_code == 404
        officer.refresh_from_db()
        assert officer.check_password("OldPass!123")
        assert not officer.check_password(GOOD_PASSWORD)

    def test_a_soul_completes_the_reset(self, api_client, accounts):
        soul, _ = accounts
        _request(api_client, SOUL_EMAIL, "198.51.100.7")
        code = cache.get(f"pwd_reset:{SOUL_EMAIL}")
        res = api_client.post(
            SET_URL,
            {"email": SOUL_EMAIL, "code": code, "new_password": GOOD_PASSWORD},
            format="json",
        )
        assert res.status_code == 200, res.data
        soul.refresh_from_db()
        assert soul.check_password(GOOD_PASSWORD)
