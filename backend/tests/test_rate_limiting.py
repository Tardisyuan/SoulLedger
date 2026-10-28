"""
Tests for rate limiting on authentication endpoints.

Covers:
- Login rate limiting: cache-based, 5 attempts per 15 min per IP
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
            assert "error" in resp.data

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

    def test_one_username_locks_after_20_failures_across_ips(self, django_user_model):
        """Rotating addresses does not buy unlimited guesses at one officer's password."""
        self._create_user(django_user_model)
        self._create_user(django_user_model, username="bystander")

        with patch("django.core.cache.cache", self.mock_cache):
            for i in range(20):
                resp = self._login("RateLimit_User ", "Wrong!", ip=f"10.1.0.{i + 1}")
                assert resp.status_code == 401, (i, resp.status_code)
            # A fresh IP, the right password: the username itself is locked.
            resp = self._login("ratelimit_user", "Correct123!", ip="10.1.1.1")
            assert resp.status_code == 429
            assert resp.data["code"] == "login_locked"
            # Another account from that same fresh IP is unaffected.
            resp = self._login("bystander", "Correct123!", ip="10.1.1.1")
            assert resp.status_code == 200
            # The username never sits in a cache key in clear.
            assert not any("ratelimit_user" in k.lower() for k in self.mock_cache._store)

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
