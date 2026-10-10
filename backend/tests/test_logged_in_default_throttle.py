"""Logged-in callers have a default per-user rate limit (scope `user`).

Before: the only default throttle was `AnonRateThrottle`, which returns None
for any authenticated request, so a valid token could call the API without limit.
"""
import pytest
from django.conf import settings
from django.utils.module_loading import import_string
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.throttling import UserRateThrottle

URL = "/api/v1/souls/"


def _bearer(user):
    return {"HTTP_AUTHORIZATION": f"Bearer {RefreshToken.for_user(user).access_token}"}


@pytest.fixture
def low_rate(monkeypatch):
    # THROTTLE_RATES is a class attribute read at construction time.
    monkeypatch.setitem(UserRateThrottle.THROTTLE_RATES, "user", "3/minute")


def test_the_default_rate_is_configured_and_parses():
    classes = [import_string(p) for p in settings.REST_FRAMEWORK["DEFAULT_THROTTLE_CLASSES"]]
    assert UserRateThrottle in classes
    rate = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["user"]
    assert UserRateThrottle().parse_rate(rate)[0] > 0


@pytest.mark.django_db
def test_exceeding_the_rate_returns_429_and_only_for_that_user(api_client, low_rate, admin_user, judge_user):
    admin = _bearer(admin_user)
    codes = [api_client.get(URL, **admin).status_code for _ in range(4)]
    assert 429 not in codes[:3] and codes[3] == 429, codes
    # Another user's bucket is untouched.
    assert api_client.get(URL, **_bearer(judge_user)).status_code != 429


@pytest.mark.django_db
def test_anonymous_requests_are_not_counted_by_the_user_throttle(api_client, low_rate):
    # Anonymous callers fall to AnonRateThrottle (60/min), not the lowered user rate.
    codes = [api_client.get(URL).status_code for _ in range(6)]
    assert 429 not in codes, codes
