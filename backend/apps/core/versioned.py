"""A per-process copy that is current while a shared version key says so (the pattern of
`apps/soul_assist/config.py::_row`, made reusable; review 2026-11-16 ADVICE-redis-cache 3.2).

    rules = VersionedMemo("datascope")
    rules.get(key, build)      # this process's copy for `key`, rebuilt when the version moved
    rules.bump(using=alias)    # after a write: now, and again when `alias`'s transaction commits

The version lives in the STATE cache (`default`: never evicted, never cleared); the payload never leaves the process.
Bumping now AND on commit closes the window where another process rebuilds from the not-yet-committed old rows
under the new version. When the version cannot be read (Redis down) the copy is NOT used: `build()` answers
straight from the database -- a copy nobody can invalidate is never served (same reason as
`CACHE_PERMISSION_FALLBACK_TTL = 0`). `ttl` is garbage collection and a backstop for writes no signal sees
(`QuerySet.update`, `bulk_create`, the shard sync's raw inserts): it is not what makes the cache correct.
"""
import logging
import time
import uuid

from django.core.cache import cache
from django.db import transaction

logger = logging.getLogger(__name__)


class VersionedMemo:
    def __init__(self, namespace: str, ttl: float = 60.0):
        self.key = f"v:{namespace}"
        self.ttl = ttl
        self._version = None
        self._born = 0.0
        self._memo: dict = {}

    def _current_version(self):
        try:
            version = cache.get(self.key)
            if version is None:
                cache.add(self.key, uuid.uuid4().hex, None)
                version = cache.get(self.key)
        except Exception as e:  # noqa: BLE001 -- any cache failure means "no shared version": read the database
            logger.warning("version key %s unreadable (%s); reading uncached", self.key, e)
            return None
        return version

    def get(self, key, build):
        version = self._current_version()
        if version is None:
            return build()
        now = time.monotonic()
        if version != self._version or now - self._born > self.ttl:
            self._memo, self._version, self._born = {}, version, now
        memo = self._memo  # a build that finishes after a bump lands in the old dict, which nobody reads again
        if key not in memo:
            memo[key] = build()
        return memo[key]

    def bump(self, using=None):
        def new_version():
            self._version = None
            try:
                cache.set(self.key, uuid.uuid4().hex, None)
            except Exception as e:  # noqa: BLE001 -- the write itself must not fail for this; `ttl` bounds the rest
                logger.warning("version key %s not bumped (%s); other processes catch up within %ss", self.key, e,
                               self.ttl)

        new_version()
        transaction.on_commit(new_version, using=using)

    def clear(self):
        """This process's copy only (tests)."""
        self._memo, self._version = {}, None
