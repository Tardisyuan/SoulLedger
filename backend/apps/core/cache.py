"""The two Django caches (config/settings.py `CACHES`; review 2026-11-16 ADVICE-redis-cache 4.1).

  default  STATE: locks, counters, lockouts, one-time markers, reset codes, idempotency keys, version keys.
           Losing a key is a security or correctness problem, so it is never cleared, never evicted, and a
           Redis outage FAILS CLOSED: the error reaches `apps.core.problems.exception_handler`, which answers 503
           `unavailable` (a login cannot be guessed at while the lockout counter is unreachable).
  data     PURE CACHE: may be cleared or evicted at any time; costs one recomputation. Its backend is
           `FailOpenRedisCache`: an outage reads as a miss and a write is dropped, so the request goes on.

Put a new key in `data` only if deleting it at a random moment is harmless.
"""
import logging
import time

from django.core.cache import caches
from django.core.cache.backends.base import DEFAULT_TIMEOUT
from django.core.cache.backends.redis import RedisCache
from django.utils.connection import ConnectionProxy

logger = logging.getLogger(__name__)

#: `from apps.core.cache import data_cache` -- the `data` alias, resolved per use like `django.core.cache.cache`.
data_cache = ConnectionProxy(caches, "data")

#: Seconds a FailOpenRedisCache leaves Redis alone after a failure, instead of paying a timeout on every call.
RETRY_COOLDOWN = 5.0


def _redis_errors():
    from redis.exceptions import RedisError

    return (RedisError, OSError)


class FailOpenRedisCache(RedisCache):
    """`RedisCache` whose failures are misses: get -> default, writes -> dropped (logged, then quiet for
    RETRY_COOLDOWN). Only for the `data` alias; state must not fail open."""

    _down_until = 0.0

    def _guard(self, fallback, method, *args, **kwargs):
        if time.monotonic() < self._down_until:
            return fallback
        try:
            return getattr(super(), method)(*args, **kwargs)
        except _redis_errors() as e:
            self._down_until = time.monotonic() + RETRY_COOLDOWN
            logger.warning("data cache unavailable (%s: %s); serving uncached for %ss", type(e).__name__, e,
                           RETRY_COOLDOWN)
            return fallback

    def get(self, key, default=None, version=None):
        return self._guard(default, "get", key, default, version)

    def get_many(self, keys, version=None):
        return self._guard({}, "get_many", keys, version)

    def has_key(self, key, version=None):
        return self._guard(False, "has_key", key, version)

    def set(self, key, value, timeout=DEFAULT_TIMEOUT, version=None):
        return self._guard(None, "set", key, value, timeout, version)

    def add(self, key, value, timeout=DEFAULT_TIMEOUT, version=None):
        return self._guard(False, "add", key, value, timeout, version)

    def set_many(self, data, timeout=DEFAULT_TIMEOUT, version=None):
        return self._guard(list(data), "set_many", data, timeout, version)

    def delete(self, key, version=None):
        return self._guard(False, "delete", key, version)

    def delete_many(self, keys, version=None):
        return self._guard(None, "delete_many", keys, version)

    def touch(self, key, timeout=DEFAULT_TIMEOUT, version=None):
        return self._guard(False, "touch", key, timeout, version)
