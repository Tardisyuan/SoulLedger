"""Redis roles kept apart, and a Redis outage that does not take the whole API down (review 2026-11-16,
ADVICE-redis-cache 4.1-4.4; apps/core/cache.py).

Before: the Django cache, the channel layer and the permission keys all lived in db 0 with no prefix, so a
`cache.clear()` (= FLUSHDB) wiped login lockouts and beat locks with it (stage-3 incident), and every API request
went through DRF's default throttles, whose cache call raised on a dead Redis -> 500 for everything.
"""
import copy
import time
import uuid
from urllib.parse import urlsplit, urlunsplit

import pytest
from django.core.cache import caches
from django.test import override_settings
from rest_framework.test import APIClient

from tests.soul_account_support import officer_client

#: Nothing listens on port 1: refused at once, so these tests do not wait out a timeout.
DEAD = "redis://127.0.0.1:1/0"


def _production():
    from config import settings as production

    return production


def _production_caches():
    return copy.deepcopy(_production().CACHES)


def test_state_and_data_are_separate_databases_each_with_a_prefix_and_a_short_timeout():
    prod = _production()
    c = prod.CACHES
    assert set(c) == {"default", "data"}
    assert c["default"]["BACKEND"] == "django.core.cache.backends.redis.RedisCache", "state must not fail open"
    assert c["data"]["BACKEND"] == "apps.core.cache.FailOpenRedisCache"
    for alias in c:
        assert c[alias]["KEY_PREFIX"], alias
        assert c[alias]["OPTIONS"]["socket_timeout"] <= 1 and c[alias]["OPTIONS"]["socket_connect_timeout"] <= 1
    dbs = {
        "state": prod.REDIS_URL, "data": prod.REDIS_CACHE_URL, "channels": prod.CHANNEL_LAYER_REDIS_URL,
        "broker": prod.CELERY_BROKER_URL, "results": prod.CELERY_RESULT_BACKEND,
    }
    assert len({urlsplit(u).path for u in dbs.values()}) == len(dbs), dbs
    assert c["data"]["LOCATION"] == prod.REDIS_CACHE_URL and c["default"]["LOCATION"] == prod.REDIS_URL
    [host] = prod.CHANNEL_LAYERS["default"]["CONFIG"]["hosts"]
    assert str(host["db"]) == urlsplit(prod.CHANNEL_LAYER_REDIS_URL).path.lstrip("/")
    assert prod.CACHE_PERMISSION_REDIS_URL == prod.REDIS_CACHE_URL, "the permission cache is a pure cache"


@pytest.fixture
def local_state_and_data():
    """The production CACHES on the local throwaway Redis, dbs 12 (state) and 13 (data). Local only."""
    import redis
    from django.conf import settings

    parts = urlsplit(settings.REDIS_URL)
    if parts.hostname not in {"localhost", "127.0.0.1", "::1"}:
        pytest.skip(f"REDIS_URL points at {parts.hostname}: not flushing a shared Redis")
    c = _production_caches()
    c["default"]["LOCATION"] = urlunsplit(parts._replace(path="/12"))
    c["data"]["LOCATION"] = urlunsplit(parts._replace(path="/13"))
    raw = redis.from_url(c["default"]["LOCATION"])
    try:
        raw.ping()
    except redis.ConnectionError as e:
        pytest.fail(f"{c['default']['LOCATION']} unreachable ({e}): this needs a real Redis (CLAUDE.md, 6399)")
    with override_settings(CACHES=c):
        yield caches["default"], caches["data"], raw, c


def test_clearing_the_data_cache_leaves_a_lockout_in_the_state_cache(local_state_and_data):
    state, data, raw, c = local_state_and_data
    lockout = f"login_rate:user:{uuid.uuid4().hex}"
    summary = f"ledger:summary:CN:{uuid.uuid4().hex}"
    state.set(lockout, 5, 60)
    data.set(summary, {"total": 1}, 60)
    try:
        data.clear()
        assert state.get(lockout) == 5, "flushing the pure cache took a login lockout with it"
        assert data.get(summary) is None
        keys = [k.decode() for k in raw.keys(f"*{lockout}")]
        assert keys == [f"{c['default']['KEY_PREFIX']}:1:{lockout}"], keys
    finally:
        state.delete(lockout)


@pytest.fixture
def judge(db, django_user_model):
    from apps.tenants.models import Tenant

    hall, _ = Tenant.objects.get_or_create(code="CN_OUTAGE", defaults={"display_name": "outage"})
    return django_user_model.objects.create_user(username="outage_judge", password="pw-outage-1", role="JUDGE",
                                                 tenant=hall)


@pytest.fixture
def redis_down():
    from apps.core import throttling

    c = _production_caches()
    for alias in c:
        c[alias]["LOCATION"] = DEAD
    with override_settings(CACHES=c):
        yield
    throttling._fail_open_until[0] = 0.0  # the fail-open cooldown must not outlive this test


def test_a_normal_get_succeeds_while_redis_is_down(redis_down, judge):
    client = officer_client(judge)
    started = time.monotonic()
    response = client.get("/api/v1/notifications/")
    assert response.status_code == 200, response.content[:300]
    assert time.monotonic() - started < 3


def test_a_login_is_refused_with_503_while_the_lockout_counter_is_unreachable(redis_down, judge):
    """Fails CLOSED: with the counter unreachable a right password is refused too, never let through uncounted."""
    for password in ("wrong-password", "pw-outage-1"):
        response = APIClient().post("/api/v1/auth/login/", {"username": judge.username, "password": password},
                                    format="json")
        assert response.status_code == 503, (password, response.status_code, response.content[:300])
        assert response.json()["code"] == "unavailable"
        assert "access" not in response.json()


def test_the_data_cache_reads_a_dead_redis_as_a_miss(redis_down):
    data = caches["data"]
    assert data.get("anything", "fallback") == "fallback"
    assert data.set("anything", 1) is None
    assert data.get_many(["a", "b"]) == {}
