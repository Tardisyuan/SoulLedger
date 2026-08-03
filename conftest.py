"""Pytest configuration shared by the whole suite.

Isolates the cache. settings.CACHES points at the same Redis the running
application uses, and nothing overrode it for tests, so the suite read and
wrote live cache state. That is not a theoretical problem: the login rate
limiter stores `login_rate:{ip}` there with a 15-minute TTL, so exhausting it
against the dev server makes nine authentication tests fail with 429 on a
machine whose code is fine — and conversely, running the suite evicts the
permission cache the application is using.

LocMem gives each test process its own cache, and clearing it between tests
keeps counters and cached permission lookups from leaking across cases.
"""
import pytest
from django.core.cache import cache
from django.test import override_settings

TEST_CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "soulledger-tests",
    }
}


@pytest.fixture(autouse=True, scope="session")
def _isolate_cache_from_redis():
    """Point the whole session at an in-process cache instead of shared Redis."""
    with override_settings(CACHES=TEST_CACHES):
        yield


@pytest.fixture(autouse=True)
def _clear_cache_between_tests(_isolate_cache_from_redis):
    """LocMem persists for the life of the process, so reset it per test.

    Rate-limit counters and the permission cache are both keyed in a way that
    would otherwise carry state from one test into the next.
    """
    cache.clear()
    yield
    cache.clear()
