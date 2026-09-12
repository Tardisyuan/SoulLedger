"""`POST /auth/reset-password/` must answer the same for a registered address
and an unregistered one — including when it refuses (BP-03).

The view's own comment promised it did not disclose registration. It did,
through its rate limiter: the `matches != 1` early return sat *above* the
counter, so only a registered address was ever counted. Ask four times —
a registered address answers 429 on the fourth, an unregistered one answers
200 forever. The limiter was the oracle.

The limits now run before the lookup, and there are two:

* per address (normalised: stripped and lower-cased), so one mailbox cannot
  be flooded and a case variant is not a fresh bucket;
* per client IP (`PasswordResetThrottle`, keyed by `apps/core/client_ip.py`),
  so one client cannot walk through a list of addresses — the enumeration
  itself — and rotating `X-Forwarded-For` does not reset it.
"""
import pytest
from django.core.cache import cache

URL = "/api/v1/auth/reset-password/"
KNOWN = "known-reset@example.com"
UNKNOWN = "nobody-reset@example.com"
LIMIT = 3


@pytest.fixture
def keys():
    """Every cache key a test touches, deleted afterwards — the suite shares one Redis."""
    touched = []
    yield touched
    cache.delete_many(touched)


@pytest.fixture
def known_user(django_user_model, cn_tenant):
    return django_user_model.objects.create_user(
        username="known_reset", email=KNOWN, password="OldPass!123",
        role="VIEWER", tenant=cn_tenant,
    )


def _post(api_client, keys, email, ip, xff=None):
    keys.extend([
        f"pwd_reset_rate:{email}", f"pwd_reset_rate:{email.strip().lower()}",
        f"pwd_reset:{email}", f"throttle_password_reset_{ip}", f"throttle_anon_{ip}",
    ])
    extra = {"REMOTE_ADDR": ip}
    if xff:
        extra["HTTP_X_FORWARDED_FOR"] = xff
        keys.extend([f"throttle_password_reset_{xff}", f"throttle_anon_{xff}"])
    return api_client.post(URL, {"email": email}, format="json", **extra)


def _answers(api_client, keys, email, ip_base):
    """LIMIT + 1 requests for one address, each from its own IP so only the
    per-address limit can be what refuses."""
    out = []
    for i in range(LIMIT + 1):
        res = _post(api_client, keys, email, f"198.51.100.{ip_base + i}")
        out.append((res.status_code, dict(res.data)))
    return out


@pytest.mark.django_db
class TestTheLimiterIsNotAnOracle:
    def test_registered_and_unregistered_addresses_get_identical_answers(
        self, api_client, keys, known_user
    ):
        known = _answers(api_client, keys, KNOWN, 10)
        unknown = _answers(api_client, keys, UNKNOWN, 30)
        assert [s for s, _ in known] == [200] * LIMIT + [429], known
        # Status AND body: a limiter that differed only in wording would still leak.
        assert unknown == known, f"registered={known}\nunregistered={unknown}"

    def test_a_refused_request_never_reaches_the_user_table(
        self, api_client, keys, known_user, django_assert_num_queries
    ):
        """The refusal must not depend on the lookup, so it must not run it."""
        for i in range(LIMIT):
            _post(api_client, keys, KNOWN, f"198.51.100.{50 + i}")
        with django_assert_num_queries(0):
            res = _post(api_client, keys, KNOWN, "198.51.100.60")
        assert res.status_code == 429

    def test_a_case_variant_is_the_same_address(self, api_client, keys, known_user):
        variants = ["Known-Reset@Example.com", "KNOWN-RESET@EXAMPLE.COM", KNOWN]
        for i, email in enumerate(variants):
            assert _post(api_client, keys, email, f"198.51.100.{70 + i}").status_code == 200
        res = _post(api_client, keys, "kNoWn-ReSeT@example.com", "198.51.100.80")
        assert res.status_code == 429, res.data


@pytest.mark.django_db
class TestOneClientCannotWalkTheAddressBook:
    def test_one_ip_is_limited_across_addresses(self, api_client, keys):
        ip = "192.0.2.41"
        statuses = [
            _post(api_client, keys, f"walk{i}@example.com", ip).status_code
            for i in range(LIMIT + 1)
        ]
        assert statuses == [200] * LIMIT + [429], statuses

    def test_rotating_forwarded_for_does_not_reset_the_ip_limit(self, api_client, keys, settings):
        settings.TRUSTED_PROXY_COUNT = 0
        ip = "192.0.2.42"
        statuses = [
            _post(api_client, keys, f"rot{i}@example.com", ip, xff=f"10.1.1.{i}").status_code
            for i in range(LIMIT + 1)
        ]
        assert statuses == [200] * LIMIT + [429], statuses

    def test_the_ip_refusal_reads_like_the_address_refusal(self, api_client, keys):
        ip = "192.0.2.43"
        for i in range(LIMIT):
            _post(api_client, keys, f"same{i}@example.com", ip)
        by_ip = _post(api_client, keys, "same-final@example.com", ip)
        assert by_ip.status_code == 429
        assert set(by_ip.data) == {"error"}, by_ip.data


@pytest.mark.django_db
class TestTheFlowStillWorks:
    """Presence, not only absence: a limiter that refused everything would pass
    every test above."""

    def test_a_registered_address_gets_a_code_and_an_unregistered_one_does_not(
        self, api_client, keys, known_user
    ):
        assert _post(api_client, keys, KNOWN, "192.0.2.90").status_code == 200
        assert _post(api_client, keys, UNKNOWN, "192.0.2.91").status_code == 200
        code = cache.get(f"pwd_reset:{KNOWN}")
        assert code is not None and len(code) == 6 and code.isdigit(), code
        assert cache.get(f"pwd_reset:{UNKNOWN}") is None
