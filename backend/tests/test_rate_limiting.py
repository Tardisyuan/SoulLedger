"""
Tests for rate limiting on authentication endpoints.

Covers:
- Login rate limiting: cache-based, 5 attempts per 15 min per IP
- Per username across IPs: 20 failures, then a 1 / 5 / 15 minute delay; a trusted MFA device skips it
"""
from unittest.mock import patch

import pytest


class _MockCache:
    """Minimal in-memory cache to avoid Redis dependency in tests."""

    def __init__(self):
        self._store: dict[str, object] = {}

    def get(self, key, default=None):
        return self._store.get(key, default)

    def set(self, key, value, timeout=None):
        self._store[key] = value

    def delete(self, key):
        self._store.pop(key, None)

    def delete_many(self, keys):
        for key in keys:
            self.delete(key)

    # Django's contract, not a counter of our own: `add` only when absent, `incr` raises
    # ValueError on a missing key. No TTLs: a test "expires" a key by deleting it.
    def add(self, key, value, timeout=None):
        if key in self._store:
            return False
        self._store[key] = value
        return True

    def incr(self, key, delta=1):
        if key not in self._store:
            raise ValueError(key)
        self._store[key] += delta
        return self._store[key]

    def touch(self, key, timeout=None):
        return key in self._store


# ---------------------------------------------------------------------------
# Login rate limiting (cache-based in LoginView.post)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestLoginRateLimiting:
    """LoginView uses django.core.cache directly (rate_key = 'login_rate:{ip}')."""

    @pytest.fixture(autouse=True)
    def _setup(self, api_client, cn_tenant):
        self.client = api_client
        self.tenant = cn_tenant
        self.mock_cache = _MockCache()

    def _create_user(self, django_user_model, username="ratelimit_user"):
        return django_user_model.objects.create_user(
            username=username,
            password="Correct123!",
            role="VIEWER",
            tenant=self.tenant,
        )

    def _login(self, username, password, ip="127.0.0.1"):
        return self.client.post(
            "/api/v1/auth/login/",
            {"username": username, "password": password},
            format="json",
            REMOTE_ADDR=ip,
        )

    # -- core behaviour -----------------------------------------------------

    def test_429_after_5_failed_attempts(self, django_user_model):
        """6th failed login from the same IP must return 429."""
        self._create_user(django_user_model)

        with patch("django.core.cache.cache", self.mock_cache):
            for i in range(5):
                resp = self._login("ratelimit_user", "WrongPassword!")
                assert resp.status_code in (400, 401), (
                    f"Attempt {i + 1}: expected 400/401, got {resp.status_code}"
                )

            resp = self._login("ratelimit_user", "WrongPassword!")
            assert resp.status_code == 429

    def test_successful_login_clears_counter(self, django_user_model):
        """A successful login resets the rate-limit counter."""
        self._create_user(django_user_model)

        with patch("django.core.cache.cache", self.mock_cache):
            # Accumulate 4 failures (just under the limit)
            for _ in range(4):
                self._login("ratelimit_user", "WrongPassword!")

            # Successful login
            resp = self._login("ratelimit_user", "Correct123!")
            assert resp.status_code == 200

            # Counter must have been cleared
            assert self.mock_cache.get("login_rate:127.0.0.1") is None

            # Another failure should start the counter from 0
            resp = self._login("ratelimit_user", "WrongPassword!")
            assert resp.status_code in (400, 401)
            assert self.mock_cache.get("login_rate:127.0.0.1") == 1

    def test_rate_limit_is_per_ip(self, django_user_model):
        """Different IPs maintain independent counters."""
        self._create_user(django_user_model, username="ip_user")

        with patch("django.core.cache.cache", self.mock_cache):
            # Exhaust limit from IP-A
            for _ in range(5):
                self._login("ip_user", "Wrong!", ip="10.0.0.1")

            resp = self._login("ip_user", "Wrong!", ip="10.0.0.1")
            assert resp.status_code == 429

            # IP-B should still be allowed
            resp = self._login("ip_user", "Wrong!", ip="10.0.0.2")
            assert resp.status_code in (400, 401)

    def test_counter_increments_on_exception_path(self, django_user_model):
        """Failed login that raises (not returns) still increments the counter."""
        self._create_user(django_user_model, username="exc_user")

        with patch("django.core.cache.cache", self.mock_cache):
            # Force super().post() to raise -- DRF re-raises non-API
            # exceptions via the test client, so we catch them explicitly.
            with patch(
                "apps.authentication.views.TokenObtainPairView.post",
                side_effect=Exception("boom"),
            ):
                for _i in range(5):
                    with pytest.raises(Exception, match="boom"):
                        self._login("exc_user", "x")

            # The exception path also increments the counter
            assert self.mock_cache.get("login_rate:127.0.0.1") == 5

    def test_429_response_body(self, django_user_model):
        """The 429 response should contain an error message."""
        self._create_user(django_user_model)

        with patch("django.core.cache.cache", self.mock_cache):
            for _ in range(5):
                self._login("ratelimit_user", "Wrong!")

            resp = self._login("ratelimit_user", "Wrong!")
            assert resp.status_code == 429
            assert "detail" in resp.data

    def test_failed_login_reports_remaining_attempts(self, django_user_model):
        """Each 401 says how many tries are left: 4, 3, 2, 1, 0 — then 429."""
        self._create_user(django_user_model)

        with patch("django.core.cache.cache", self.mock_cache):
            seen = []
            for _ in range(5):
                resp = self._login("ratelimit_user", "Wrong!")
                assert resp.status_code == 401
                # The message the page already maps is still there.
                assert resp.data["detail"] == "No active account found with the given credentials"
                seen.append(resp.data["remaining_attempts"])
            assert seen == [4, 3, 2, 1, 0]

    def test_429_carries_code_and_retry_after(self, django_user_model):
        """The lockout body is machine-readable: a stable code and seconds left."""
        self._create_user(django_user_model)

        with patch("django.core.cache.cache", self.mock_cache):
            for _ in range(5):
                self._login("ratelimit_user", "Wrong!")

            with patch("apps.authentication.views.time.time", return_value=self.mock_cache.get("login_rate_until:127.0.0.1") - 600):
                resp = self._login("ratelimit_user", "Wrong!")
            assert resp.status_code == 429
            assert resp.data["code"] == "login_locked"
            assert resp.data["retry_after"] == 600
            assert resp["Retry-After"] == "600"
            assert "remaining_attempts" not in resp.data

    def test_successful_login_body_has_no_attempt_fields(self, django_user_model):
        self._create_user(django_user_model)

        with patch("django.core.cache.cache", self.mock_cache):
            self._login("ratelimit_user", "Wrong!")
            resp = self._login("ratelimit_user", "Correct123!")
            assert resp.status_code == 200
            assert "remaining_attempts" not in resp.data

    def test_one_username_waits_a_minute_after_20_failures_across_ips(self, django_user_model):
        """Rotating addresses does not buy unlimited guesses at one officer's password."""
        self._create_user(django_user_model)
        self._create_user(django_user_model, username="bystander")

        with patch("django.core.cache.cache", self.mock_cache):
            for i in range(20):
                resp = self._login("RateLimit_User ", "Wrong!", ip=f"10.1.0.{i + 1}")
                assert resp.status_code == 401, (i, resp.status_code)
            # A fresh IP, the right password: the username itself waits. The key is case-folded,
            # so "RateLimit_User " above and "ratelimit_user" here are one counter.
            resp = self._login("ratelimit_user", "Correct123!", ip="10.1.1.1")
            assert resp.status_code == 429
            assert resp.data["code"] == "login_locked"
            assert resp.data["retry_after"] == 60
            assert resp["Retry-After"] == "60"
            # Another account from that same fresh IP is unaffected.
            resp = self._login("bystander", "Correct123!", ip="10.1.1.1")
            assert resp.status_code == 200
            # The username never sits in a cache key in clear.
            assert not any("ratelimit_user" in k.lower() for k in self.mock_cache._store)

    # -- username layer: 1 / 5 / 15 minutes (user 2026-11-15) ---------------

    def _trip_username(self, name, start):
        """20 failures for `name`, each from its own address so only the username layer trips,
        then the right password from one more address. Returns that last response."""
        for i in range(20):
            resp = self._login(name, "Wrong!", ip=f"10.{start}.0.{i + 1}")
            assert resp.status_code == 401, (i, resp.status_code, resp.data)
        return self._login(name, "Correct123!", ip=f"10.{start}.9.9")

    def _expire_delay(self, name):
        from apps.authentication.views import _username_rate_key

        self.mock_cache.delete(f"{_username_rate_key(name)}:until")

    def test_username_delay_grows_1_5_15_then_stays_at_15(self, django_user_model):
        self._create_user(django_user_model)
        with patch("django.core.cache.cache", self.mock_cache):
            seen = []
            for round_ in range(4):
                resp = self._trip_username("ratelimit_user", 20 + round_)
                assert resp.status_code == 429
                assert resp.data["code"] == "login_locked"
                seen.append(resp.data["retry_after"])
                self._expire_delay("ratelimit_user")
            assert seen == [60, 300, 900, 900]
            # The delay over, the right password goes through and the ladder is forgotten.
            assert self._login("ratelimit_user", "Correct123!", ip="10.30.0.1").status_code == 200
            assert self._trip_username("ratelimit_user", 31).data["retry_after"] == 60

    def test_during_the_delay_tries_are_refused_without_counting(self, django_user_model):
        from apps.authentication.views import _username_rate_key

        self._create_user(django_user_model)
        with patch("django.core.cache.cache", self.mock_cache):
            self._trip_username("ratelimit_user", 40)
            for i in range(30):
                assert self._login("ratelimit_user", "Wrong!", ip=f"10.41.0.{i + 1}").status_code == 429
            assert self.mock_cache.get(_username_rate_key("ratelimit_user")) is None
            assert self.mock_cache.get(f"{_username_rate_key('ratelimit_user')}:strikes") == 1

    def test_a_trusted_device_skips_the_username_layer(self, django_user_model):
        """The MFA 「不再询问」 cookie of THIS account lets its owner in while the name waits."""
        from apps.authentication import mfa

        user = self._create_user(django_user_model)
        other = self._create_user(django_user_model, username="other_officer")
        with patch("django.core.cache.cache", self.mock_cache):
            assert self._trip_username("ratelimit_user", 50).status_code == 429
            # Another account's token buys nothing.
            self.client.cookies[mfa.DEVICE_COOKIE] = mfa.remember_device(other)
            assert self._login("ratelimit_user", "Correct123!", ip="10.51.0.1").status_code == 429
            # Its own token does; the case of the name does not matter, as for the key.
            self.client.cookies[mfa.DEVICE_COOKIE] = mfa.remember_device(user)
            assert self._login("RATELIMIT_USER", "Wrong!", ip="10.51.0.2").status_code == 401
            assert self._login("ratelimit_user", "Correct123!", ip="10.51.0.3").status_code == 200

    def test_a_trusted_device_still_meets_the_ip_layer(self, django_user_model):
        from apps.authentication import mfa

        user = self._create_user(django_user_model)
        with patch("django.core.cache.cache", self.mock_cache):
            self.client.cookies[mfa.DEVICE_COOKIE] = mfa.remember_device(user)
            seen = [self._login("ratelimit_user", "Wrong!").data["remaining_attempts"] for _ in range(5)]
            assert seen == [4, 3, 2, 1, 0]
            resp = self._login("ratelimit_user", "Correct123!")
            assert resp.status_code == 429
            assert resp.data["code"] == "login_locked"

    def test_an_expired_trusted_device_is_not_trusted(self, django_user_model):
        from datetime import timedelta

        from django.utils import timezone

        from apps.authentication import mfa
        from apps.authentication.models import MfaRememberedDevice

        user = self._create_user(django_user_model)
        with patch("django.core.cache.cache", self.mock_cache):
            self.client.cookies[mfa.DEVICE_COOKIE] = mfa.remember_device(user)
            MfaRememberedDevice.objects.filter(user=user).update(expires_at=timezone.now() - timedelta(seconds=1))
            assert self._trip_username("ratelimit_user", 60).status_code == 429

    def test_counters_are_incremented_not_overwritten(self, django_user_model):
        """A failure that lands while this one is checking the password is not lost.

        The old code read the counters at the top and wrote `read + 1` at the end, so two
        parallel failures counted once. The parallel one is simulated inside the password check.
        """
        from rest_framework.exceptions import AuthenticationFailed

        from apps.authentication.views import _username_rate_key

        ip_key, user_key = "login_rate:127.0.0.1", _username_rate_key("ratelimit_user")

        def parallel_failure(*args, **kwargs):
            for key in (ip_key, user_key):
                self.mock_cache._store[key] = self.mock_cache._store.get(key, 0) + 1
            raise AuthenticationFailed("No active account found with the given credentials")

        with patch("django.core.cache.cache", self.mock_cache), patch(
            "apps.authentication.views.TokenObtainPairView.post", side_effect=parallel_failure
        ):
            resp = self._login("ratelimit_user", "Wrong!")
        assert resp.status_code == 401
        assert self.mock_cache.get(ip_key) == 2
        assert self.mock_cache.get(user_key) == 2
        assert resp.data["remaining_attempts"] == 3

    def test_a_name_with_no_account_answers_exactly_as_one_with(self, django_user_model):
        """Same 401s, same counts, same 429 after the same number: nothing says which name exists."""
        self._create_user(django_user_model)

        def run(name, start):
            with patch("django.core.cache.cache", _MockCache()):
                bodies = [self._login(name, "Wrong!", ip=f"10.{start}.0.{i + 1}") for i in range(20)]
                locked = self._login(name, "Wrong!", ip=f"10.{start}.9.9")
            # `instance` is the request's own trace id (`apps/core/problems.py`), new on every
            # request whichever name is tried; everything else must match field for field.
            return ([(r.status_code, {k: v for k, v in r.data.items() if k != "instance"}) for r in bodies],
                    (locked.status_code, locked.data["code"], str(locked.data["detail"]), locked.data["retry_after"]))

        assert run("ratelimit_user", 70) == run("no_such_officer", 71)

    def test_unexpected_exception_logs_only_its_class_name(self, django_user_model):
        from apps.authentication.models import LoginLog

        self._create_user(django_user_model, username="exc_log_user")
        with patch("django.core.cache.cache", self.mock_cache), patch(
            "apps.authentication.views.TokenObtainPairView.post",
            side_effect=RuntimeError("SELECT secret FROM somewhere"),
        ), pytest.raises(RuntimeError):
            self._login("exc_log_user", "x")
        log = LoginLog.objects.filter(username="exc_log_user").latest("id")
        assert log.failure_reason == "RuntimeError"
        assert "secret" not in log.failure_reason
