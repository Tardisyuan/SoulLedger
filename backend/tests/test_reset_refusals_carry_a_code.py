"""Every refusal of the email-reset endpoints carries a stable `code` (2026-09-25).

The soul App used to tell 「验证码已过期」 from 「验证码错误」 from a weak password by
matching the Chinese `error` sentence, so rewording a sentence silently changed
which screen a soul saw. The App now branches on `code` alone; this file pins
which refusal answers which code, and that a throttled answer says when to come
back (`retry_after`, plus the `Retry-After` header).

Neutrality is untouched and pinned elsewhere
(`test_reset_request_does_not_disclose_registration.py`,
`test_password_self_reset_is_for_souls_only.py`): step 1 still answers one 200
body for every address, and its 429 is counted before the lookup.
"""
import pytest
from django.core.cache import cache

from apps.authentication import views
from apps.authentication.serializers import PASSWORD_RESET_REFUSAL_CODES
from apps.authentication.views import MAX_RESET_CODE_ATTEMPTS, MAX_RESET_REQUESTS_PER_ADDRESS
from apps.core.throttling import AnonRateThrottle

REQUEST_URL = "/api/v1/auth/reset-password/"
SET_URL = "/api/v1/auth/set-new-password/"
EMAIL = "coded-reset@example.com"
CODE = "424242"
GOOD_PASSWORD = "N0t-Guessable!2026"


@pytest.fixture
def soul(django_user_model, cn_tenant):
    cache.clear()
    user = django_user_model.objects.create_user(
        username="coded_reset", email=EMAIL, password="OldPass!123", role="SOUL", tenant=cn_tenant,
    )
    yield user
    cache.clear()


def _set(api_client, code=CODE, password=GOOD_PASSWORD, email=EMAIL):
    return api_client.post(
        SET_URL, {"email": email, "code": code, "new_password": password}, format="json"
    )


def _refusal(res, status, code):
    assert res.status_code == status, (res.status_code, res.data)
    assert res.data["code"] == code, res.data
    assert res.data["error"], "the human sentence was dropped"
    return res.data


@pytest.mark.django_db
class TestSetNewPasswordCodes:
    def test_no_live_code_is_reset_code_expired(self, api_client, soul):
        body = _refusal(_set(api_client), 400, "reset_code_expired")
        assert "retry_after" not in body

    def test_a_wrong_code_is_reset_code_wrong(self, api_client, soul):
        cache.set(f"pwd_reset:{EMAIL}", CODE, timeout=300)
        body = _refusal(_set(api_client, code="000000"), 400, "reset_code_wrong")
        assert body["attempts_left"] == MAX_RESET_CODE_ATTEMPTS - 1

    def test_attempts_left_counts_down_to_the_refusal(self, api_client, soul):
        cache.set(f"pwd_reset:{EMAIL}", CODE, timeout=300)
        left = [_set(api_client, code="000000").data["attempts_left"] for _ in range(MAX_RESET_CODE_ATTEMPTS)]
        assert left == list(range(MAX_RESET_CODE_ATTEMPTS - 1, -1, -1))
        # attempts_left 0 meant it: even the right code is now refused.
        _refusal(_set(api_client), 429, "reset_code_attempts_exceeded")

    def test_too_many_wrong_codes_is_attempts_exceeded_with_nothing_to_wait_for(self, api_client, soul):
        cache.set(f"pwd_reset:{EMAIL}", CODE, timeout=300)
        for _ in range(MAX_RESET_CODE_ATTEMPTS):
            _set(api_client, code="000000")
        body = _refusal(_set(api_client, code="000000"), 429, "reset_code_attempts_exceeded")
        # The code is deleted: only a new one helps, so there is no wait to name.
        assert "retry_after" not in body

    def test_a_refused_password_is_weak_password(self, api_client, soul):
        cache.set(f"pwd_reset:{EMAIL}", CODE, timeout=300)
        _refusal(_set(api_client, password="password"), 400, "weak_password")
        soul.refresh_from_db()
        assert soul.check_password("OldPass!123")

    def test_an_officer_address_is_no_soul_account(self, api_client, django_user_model, cn_tenant):
        cache.clear()
        django_user_model.objects.create_user(
            username="coded_officer", email="coded-officer@example.com", password="OldPass!123",
            role="JUDGE", tenant=cn_tenant,
        )
        cache.set("pwd_reset:coded-officer@example.com", CODE, timeout=300)
        _refusal(_set(api_client, email="coded-officer@example.com"), 404, "no_soul_account")

    def test_several_accounts_on_one_address_is_ambiguous_email(self, api_client, soul, monkeypatch):
        # A unique index now refuses the duplicate itself, so the row pair this
        # branch exists for can only be simulated.
        def several(**kwargs):
            raise views.User.MultipleObjectsReturned

        cache.set(f"pwd_reset:{EMAIL}", CODE, timeout=300)
        monkeypatch.setattr(views.User.objects, "get", several)
        _refusal(_set(api_client), 409, "ambiguous_email")

    def test_the_anonymous_throttle_is_rate_limited_with_retry_after(self, api_client, soul, monkeypatch):
        monkeypatch.setattr(AnonRateThrottle, "THROTTLE_RATES", {"anon": "2/minute"})
        _set(api_client), _set(api_client)
        res = _set(api_client)
        body = _refusal(res, 429, "rate_limited")
        assert 1 <= body["retry_after"] <= 60, body
        assert res["Retry-After"] == str(body["retry_after"])


@pytest.mark.django_db
def test_a_completed_reset_signs_every_other_device_out(api_client, soul):
    """The App's success notice says 「其他设备上的登录已全部退出」: every refresh
    token the account held is blacklisted, so no device can renew its session."""
    from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
    from rest_framework_simplejwt.tokens import RefreshToken

    from apps.soul_accounts.authentication import SoulRefreshToken

    held = [str(RefreshToken.for_user(soul)) for _ in range(2)]
    app_session = SoulRefreshToken.for_user(soul)  # what the soul App holds
    cache.set(f"pwd_reset:{EMAIL}", CODE, timeout=300)
    assert _set(api_client).status_code == 200
    for token in held:
        res = api_client.post("/api/v1/auth/refresh/", {"refresh": token}, format="json")
        assert res.status_code == 401, res.data
    assert OutstandingToken.objects.get(jti=app_session["jti"]).blacklistedtoken is not None
    assert not OutstandingToken.objects.filter(user=soul, blacklistedtoken__isnull=True).exists()


@pytest.mark.django_db
class TestResetRequestCodes:
    def test_the_address_limit_is_rate_limited_with_its_remaining_window(self, api_client, soul):
        for i in range(MAX_RESET_REQUESTS_PER_ADDRESS):
            assert api_client.post(
                REQUEST_URL, {"email": EMAIL}, format="json", REMOTE_ADDR=f"198.51.100.{120 + i}"
            ).status_code == 200
        res = api_client.post(REQUEST_URL, {"email": EMAIL}, format="json", REMOTE_ADDR="198.51.100.130")
        body = _refusal(res, 429, "rate_limited")
        assert 290 <= body["retry_after"] <= views.RESET_REQUEST_WINDOW_SECONDS, body
        assert res["Retry-After"] == str(body["retry_after"])

    def test_the_ip_throttle_is_rate_limited_with_retry_after(self, api_client, soul):
        ip = "198.51.100.140"
        for i in range(3):
            api_client.post(REQUEST_URL, {"email": f"walk{i}@example.com"}, format="json", REMOTE_ADDR=ip)
        res = api_client.post(REQUEST_URL, {"email": "walk9@example.com"}, format="json", REMOTE_ADDR=ip)
        body = _refusal(res, 429, "rate_limited")
        assert 1 <= body["retry_after"] <= 300, body

    def test_an_accepted_request_carries_no_code(self, api_client, soul):
        res = api_client.post(REQUEST_URL, {"email": EMAIL}, format="json", REMOTE_ADDR="198.51.100.150")
        assert res.status_code == 200 and set(res.data) == {"detail"}, res.data


def test_every_declared_code_has_a_test_above():
    """The schema's enum and this file cover the same set: a new code needs a
    test that makes the view answer it."""
    from pathlib import Path

    source = Path(__file__).read_text(encoding="utf-8")
    for value, _ in PASSWORD_RESET_REFUSAL_CODES:
        assert f'"{value}")' in source, value
