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


@pytest.fixture(autouse=True, scope="session")
def _fast_password_hasher():
    """MD5 instead of PBKDF2 (1,000,000 iterations) for every hash the suite makes.

    Measured 2026-09-16, same tree, SQLite, --no-cov: full suite 545s -> 253s,
    3767 passed both ways. Tests only; production hashing is untouched. A test
    that inspects a hash's prefix must read `get_hasher().algorithm`, not a
    literal `pbkdf2_` -- that literal can never match under this override.
    """
    with override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"]):
        yield


@pytest.fixture(autouse=True, scope="session")
def _private_permission_cache_prefix():
    """Give this process's permission-cache singleton its own Redis key prefix.

    `apps/perm/cache.py` opens its own Redis client, so LocMem above does not
    cover it, and the default prefix is "". Any other process on the same Redis
    -- a second test run, or another xdist worker -- that calls
    `invalidate_all_permissions()` then deletes this process's `perm:*` keys
    mid-test. Reproduced 2026-09-16: deleting `perm:*` in a loop from another
    process turned `test_a_warm_read_does_not_touch_the_database_per_codename`
    red 1 run in 5 ("56 not less than 46"). The singleton is built at import
    time, before any settings override could reach it, hence the attribute.
    """
    import os

    from apps.perm.cache import get_permission_cache

    get_permission_cache()._key_prefix = f"pytest-{os.getpid()}:"
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
