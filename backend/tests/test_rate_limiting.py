"""
Tests for rate limiting on authentication endpoints.

Covers:
- Login rate limiting: cache-based, 5 attempts per 15 min per IP
- Registration rate limiting: DRF RegisterThrottle, 5 per hour per IP
"""
import secrets
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
                for i in range(5):
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


# ---------------------------------------------------------------------------
# Registration rate limiting (DRF RegisterThrottle, scope='register')
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestRegistrationRateLimiting:
    """register_view manually instantiates RegisterThrottle (5/hour per IP)."""

    @pytest.fixture(autouse=True)
    def _setup(self, api_client, cn_tenant):
        self.client = api_client
        self.tenant = cn_tenant
        self.mock_cache = _MockCache()

    def _register(self, ip="127.0.0.1", username=None):
        username = username or f"reg_{secrets.token_hex(4)}"
        return self.client.post(
            "/api/v1/auth/register/",
            {
                "username": username,
                "email": f"{username}@test.com",
                "password": "StrongPass1!",
            },
            format="json",
            REMOTE_ADDR=ip,
        )

    # -- core behaviour -----------------------------------------------------

    def test_429_after_5_registrations(self):
        """6th registration from the same IP must return 429."""
        with patch("rest_framework.throttling.SimpleRateThrottle.cache", self.mock_cache):
            for i in range(5):
                resp = self._register()
                assert resp.status_code == 201, (
                    f"Registration {i + 1}: expected 201, got {resp.status_code} {resp.data}"
                )

            resp = self._register()
            assert resp.status_code == 429

    def test_different_ip_not_affected(self):
        """Rate limiting is per-IP; a second IP should still succeed."""
        with patch("rest_framework.throttling.SimpleRateThrottle.cache", self.mock_cache):
            # Exhaust limit from IP-A
            for _ in range(5):
                resp = self._register(ip="10.0.0.1")
                assert resp.status_code == 201

            resp = self._register(ip="10.0.0.1")
            assert resp.status_code == 429

            # IP-B should still be allowed
            resp = self._register(ip="10.0.0.2")
            assert resp.status_code == 201

    def test_429_response_body(self):
        """The 429 response should contain an error message."""
        with patch("rest_framework.throttling.SimpleRateThrottle.cache", self.mock_cache):
            for _ in range(5):
                self._register()

            resp = self._register()
            assert resp.status_code == 429
            assert "error" in resp.data

    def test_throttle_key_matches_ip(self):
        """Verify the throttle cache key incorporates the client IP."""
        with patch("rest_framework.throttling.SimpleRateThrottle.cache", self.mock_cache):
            self._register(ip="192.168.42.99")
            # The throttle should have written a key containing the IP
            keys = list(self.mock_cache._store.keys())
            assert any("192.168.42.99" in k for k in keys), (
                f"Expected IP in cache keys, got: {keys}"
            )
