"""The channel layer's socket read timeout must outlast channels_redis's blocking pop.

redis-py 8 made socket_timeout default to 5 s — the same 5 s channels_redis blocks on
BZPOPMIN while a WebSocket consumer waits for a message — so every idle read timed out
and the officer web showed "reconnecting" in a loop (2026-09-30). config/settings.py sets
the timeout explicitly; this pins that it stays above the pop.
"""
from channels_redis.core import RedisChannelLayer
from django.conf import settings


def test_the_socket_read_outlasts_the_blocking_pop():
    brpop_timeout = RedisChannelLayer.brpop_timeout
    [host] = settings.CHANNEL_LAYERS["default"]["CONFIG"]["hosts"]
    assert host.get("socket_timeout") is not None, "unset means redis-py's default (5 s in redis-py 8)"
    assert host["socket_timeout"] > brpop_timeout
