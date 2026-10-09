"""Second `celery beat` detection.

The per-job single-flight lock (task_base.py) stops two runs of one job from
overlapping, but not from running back to back: two beats each publish every
tick, so a fast job runs twice, once after the other has finished, and tasks
outside the registry are not locked at all. The only real fix is one beat, so
the beat process takes a short-TTL Redis key at start (`beat_init`) and keeps
it alive from a daemon thread. A second beat finds it held, logs CRITICAL and
exits non-zero, so the orchestrator shows a crash loop instead of silent
double sends. A crashed beat's key expires after TTL seconds.

Redis is the repo's existing lock store (services.acquire_lock); unlike that
lock this one fails open when Redis is unreachable, since the broker is the
same Redis and beat could publish nothing anyway.
"""
import logging
import os
import socket
import sys
import threading

from django.core.cache import cache

logger = logging.getLogger(__name__)

KEY = "scheduler:beat:lock"
TTL = 60
REFRESH_EVERY = 20


def _owner() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


def holder():
    """Who holds the beat key now (None: nobody, or Redis unreachable)."""
    try:
        return cache.get(KEY)
    except Exception:  # noqa: BLE001
        logger.exception("scheduler: could not read the beat lock")
        return None


def claim(owner: str | None = None) -> tuple[bool, str | None]:
    """Take the key. Returns (ok, current_holder_if_not_ok)."""
    owner = owner or _owner()
    try:
        if cache.add(KEY, owner, timeout=TTL):
            return True, None
        current = cache.get(KEY)
        if current == owner:  # same host:pid restarting inside the TTL
            cache.set(KEY, owner, timeout=TTL)
            return True, None
        return False, current
    except Exception:  # noqa: BLE001
        logger.exception("scheduler: beat lock unavailable, starting unguarded")
        return True, None


def _refresh(owner: str, stop: threading.Event) -> None:
    while not stop.wait(REFRESH_EVERY):
        try:
            current = cache.get(KEY)
            if current in (None, owner):
                cache.set(KEY, owner, timeout=TTL)
            else:
                logger.critical("scheduler: beat lock taken over by %s; two beats are running", current)
        except Exception:  # noqa: BLE001
            logger.exception("scheduler: could not refresh the beat lock")


def guard_beat(**_) -> None:
    """`beat_init` receiver: exit if another beat is alive, else keep the key."""
    owner = _owner()
    ok, current = claim(owner)
    if not ok:
        logger.critical(
            "scheduler: another celery beat (%s) holds %s; refusing to start a second one. "
            "Two beats publish every job twice.", current, KEY,
        )
        sys.exit(1)
    threading.Thread(target=_refresh, args=(owner, threading.Event()), daemon=True, name="beat-lock").start()
