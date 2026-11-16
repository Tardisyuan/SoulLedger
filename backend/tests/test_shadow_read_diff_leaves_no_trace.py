"""`manage.py shadow_read_diff` (and `shadow_reads.fetch`, the differential test's helper) leave nothing behind
outside the process: not the backend's Redis (it used to FLUSHDB it before every request -- login lock-outs,
reset codes, MFA one-time markers, the beat lock, the channel layer), not the broker (`GET /me/chat/session/`
enqueues `chat.sync_rooms`), not Synapse (the same GET registers the Matrix user). VERIFY-stage3.md section 5.

The database side (every request rolled back) is held by tests/test_sharded_reads_equal_single_db.py.
"""
import io
from unittest import mock
from urllib.parse import urlsplit, urlunsplit

import pytest
from django.core.cache import caches
from django.core.management import call_command

from tests.test_shard_sync import sharded

SENTINEL = "shadow-test:login-lockout"


@pytest.fixture
def redis_cache(settings):
    """The default cache on a Redis db of its own (the backend's real shape), with a sentinel in it."""
    parts = urlsplit(settings.REDIS_URL)
    settings.CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache",
                                   "LOCATION": urlunsplit(parts._replace(path="/9"))}}
    cache = caches["default"]
    cache.set(SENTINEL, 1, timeout=120)
    assert cache.get(SENTINEL) == 1
    yield cache
    cache.delete(SENTINEL)


@pytest.fixture
def broker():
    """Celery's way out to the broker (Task.apply_async -> app.send_task), recorded instead of sent."""
    from celery import Celery

    sent = []
    with mock.patch.object(Celery, "send_task", lambda app, name, *a, **k: sent.append(name)):
        yield sent


@pytest.fixture
def a_greek_soul():
    from apps.tenants.models import Tenant
    from tests.soul_account_support import ready_soul

    hall = Tenant.objects.create(code="NOTRACE_GR", display_name="h", declared_civilization="GREEK")
    return ready_soul(hall, name="chatter")


def _diff(*args):
    out = io.StringIO()
    try:
        call_command("shadow_read_diff", "--civ", "GREEK", "--endpoint", "chat-session", *args, stdout=out)
    except Exception as e:  # noqa: BLE001 -- a difference is not what these tests look at
        out.write(f"\n{type(e).__name__}: {e}")
    return out.getvalue()


@sharded
def test_the_command_leaves_the_cache_and_the_broker_alone(settings, redis_cache, broker, a_greek_soul):
    from tests.chat_support import SERVER_NAME, FakeMatrix

    settings.MATRIX_ENABLED = True
    settings.MATRIX_CLIENT = "tests.chat_support.FakeMatrix"  # a configured fake stays: the GET gets as far
    settings.MATRIX_SERVER_NAME = SERVER_NAME                 # as enqueueing chat.sync_rooms
    settings.MATRIX_JWT_SECRET = "jwt-secret-for-tests-0123456789abcdef"
    settings.MATRIX_USER_SALT = "salt-for-tests"
    FakeMatrix.reset()
    try:
        out = _diff()
    finally:
        FakeMatrix.reset()
    assert "soul@GREEK" in out and "compared 2 " in out, out
    assert redis_cache.get(SENTINEL) == 1, f"the shared cache was flushed\n{out}"
    assert broker == [], f"a GET under shadow_read_diff reached the broker: {broker}\n{out}"
    assert "held back 2 Celery dispatch(es), not sent: ['chat.sync_rooms']" in out, out


@sharded
def test_the_command_does_not_ask_synapse(settings, a_greek_soul):
    from apps.chat.matrix import MatrixError, SynapseClient

    settings.MATRIX_ENABLED = True
    settings.MATRIX_CLIENT = "apps.chat.matrix.SynapseClient"
    with mock.patch.object(SynapseClient, "__init__", side_effect=MatrixError("asked Synapse")) as made:
        out = _diff()
    assert "compared 2 " in out, out
    assert made.call_count == 0, f"shadow_read_diff built the real Matrix client {made.call_count} times\n{out}"


@sharded
def test_the_differential_tests_fetch_leaves_the_cache_alone(redis_cache, a_greek_soul):
    from apps.core import shadow_reads as shadow

    _, client = a_greek_soul
    status, _ = shadow.fetch(client, "/api/v1/me/")
    assert status == 200
    assert redis_cache.get(SENTINEL) == 1, "shadow.fetch flushed the shared cache"
