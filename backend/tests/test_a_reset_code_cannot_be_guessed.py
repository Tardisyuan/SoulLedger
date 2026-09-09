"""A six-digit reset code must not be guessable at whatever rate the network allows.

Why this file exists
--------------------
`reset_password_request` limits how many codes may be *sent* for one address
(3 per 5 minutes). Nothing limited how many may be *tried*. A wrong code
returned 400 and left the code live for its whole 5-minute TTL, so the only
ceiling on guessing was `AnonRateThrottle` at 60/min — and DRF's
`BaseThrottle.get_ident` keys on `X-Forwarded-For` whenever `NUM_PROXIES` is
unset, which it is (`config/settings.py:200-226` declares no `NUM_PROXIES`).
Rotating one header reset the throttle. The code is six digits.

Deleting rather than counting
-----------------------------
On the last allowed failure the code itself is discarded. Counting alone would
leave a valid code sitting in the cache while the attacker waits out the
counter; discarding forces a new `reset_password_request`, which *is* limited.

That distinction is the reason `test_the_code_is_destroyed_not_merely_refused`
exists as a separate test from the 429: a fix that returned 429 and left the
code live would satisfy the obvious assertion and not the point.

What "would really fail" means here
-----------------------------------
Each assertion was checked by breaking it:

* removing the `tries >= MAX_RESET_CODE_ATTEMPTS` block reddens
  `test_the_sixth_wrong_code_is_refused_with_429` — without it the sixth guess
  answers 400 like the first five, i.e. unlimited guessing;
* keeping the block but dropping `cache.delete(f"pwd_reset:{email}")` reddens
  `test_the_code_is_destroyed_not_merely_refused`, which then finds the correct
  code still accepted after the lockout;
* dropping `cache.delete(attempts_key)` on success reddens
  `test_a_successful_reset_clears_the_counter`, which is the case where one
  user's earlier typos would shorten their next legitimate reset.
"""

import pytest
from django.core.cache import cache

from apps.authentication.views import MAX_RESET_CODE_ATTEMPTS

REQUEST_URL = "/api/v1/auth/reset-password/"
SET_URL = "/api/v1/auth/set-new-password/"
EMAIL = "guessable@example.com"
GOOD_PASSWORD = "N0t-Guessable!2026"


@pytest.fixture
def user_with_code(django_user_model, cn_tenant):
    """A user whose reset code is known to the test, planted the way the view does."""
    cache.clear()
    user = django_user_model.objects.create_user(
        username="guessable", email=EMAIL, password="OldPass!123",
        role="VIEWER", tenant=cn_tenant,
    )
    cache.set(f"pwd_reset:{EMAIL}", "424242", timeout=300)
    return user


def _wrong(api_client, n):
    """Send `n` wrong codes, returning the last response."""
    res = None
    for i in range(n):
        res = api_client.post(
            SET_URL,
            {"email": EMAIL, "code": f"{i:06d}", "new_password": GOOD_PASSWORD},
            format="json",
        )
    return res


@pytest.mark.django_db
class TestResetCodeGuessing:
    def test_the_limit_is_a_real_number(self):
        """Non-vacuity. A limit of 0 or a huge one would make the rest hollow."""
        assert 1 <= MAX_RESET_CODE_ATTEMPTS <= 10

    def test_a_wrong_code_below_the_limit_is_just_a_400(self, api_client, user_with_code):
        res = _wrong(api_client, MAX_RESET_CODE_ATTEMPTS - 1)
        assert res.status_code == 400, res.data

    def test_the_sixth_wrong_code_is_refused_with_429(self, api_client, user_with_code):
        _wrong(api_client, MAX_RESET_CODE_ATTEMPTS)
        res = api_client.post(
            SET_URL,
            {"email": EMAIL, "code": "999999", "new_password": GOOD_PASSWORD},
            format="json",
        )
        assert res.status_code == 429, res.data

    def test_the_code_is_destroyed_not_merely_refused(self, api_client, user_with_code):
        """The correct code must stop working once the guesser is locked out."""
        _wrong(api_client, MAX_RESET_CODE_ATTEMPTS)
        # Trip the lockout branch, which is what discards the code.
        api_client.post(
            SET_URL, {"email": EMAIL, "code": "999999", "new_password": GOOD_PASSWORD},
            format="json",
        )
        assert cache.get(f"pwd_reset:{EMAIL}") is None, (
            "the code survived the lockout; an attacker can wait out the counter "
            "and keep guessing the same live code"
        )
        res = api_client.post(
            SET_URL, {"email": EMAIL, "code": "424242", "new_password": GOOD_PASSWORD},
            format="json",
        )
        assert res.status_code != 200, res.data

    def test_a_successful_reset_clears_the_counter(self, api_client, user_with_code):
        _wrong(api_client, MAX_RESET_CODE_ATTEMPTS - 1)
        res = api_client.post(
            SET_URL, {"email": EMAIL, "code": "424242", "new_password": GOOD_PASSWORD},
            format="json",
        )
        assert res.status_code == 200, res.data
        assert cache.get(f"pwd_reset_tries:{EMAIL}") is None, (
            "earlier typos would count against the user's next legitimate reset"
        )


@pytest.mark.django_db
class TestDuplicateEmailDoesNotCrashTheReset:
    """The other half of the same endpoint pair — see the register-side fix.

    `User.email` has no unique constraint and registration is `AllowAny`, so a
    duplicate address used to raise `MultipleObjectsReturned` out of `.get()`:
    an uncaught 500 that took a real user's password reset offline permanently.
    """

    def test_requesting_a_code_for_a_duplicated_address_does_not_500(
        self, api_client, django_user_model, cn_tenant
    ):
        for name in ("dup_a", "dup_b"):
            django_user_model.objects.create_user(
                username=name, email="dup@example.com", password="OldPass!123",
                role="VIEWER", tenant=cn_tenant,
            )
        res = api_client.post(REQUEST_URL, {"email": "dup@example.com"}, format="json")
        assert res.status_code == 200, res.data

    def test_setting_a_password_for_a_duplicated_address_is_a_409_not_a_500(
        self, api_client, django_user_model, cn_tenant
    ):
        cache.clear()
        for name in ("dup_c", "dup_d"):
            django_user_model.objects.create_user(
                username=name, email="dup2@example.com", password="OldPass!123",
                role="VIEWER", tenant=cn_tenant,
            )
        cache.set("pwd_reset:dup2@example.com", "424242", timeout=300)
        res = api_client.post(
            SET_URL,
            {"email": "dup2@example.com", "code": "424242", "new_password": GOOD_PASSWORD},
            format="json",
        )
        assert res.status_code == 409, res.data

    def test_registration_refuses_an_address_that_already_exists(
        self, api_client, django_user_model, cn_tenant
    ):
        django_user_model.objects.create_user(
            username="taken", email="taken@example.com", password="OldPass!123",
            role="VIEWER", tenant=cn_tenant,
        )
        res = api_client.post(
            "/api/v1/auth/register/",
            {"username": "impostor", "email": "taken@example.com", "password": GOOD_PASSWORD},
            format="json",
        )
        assert res.status_code == 400, res.data
        assert "email" in res.data
