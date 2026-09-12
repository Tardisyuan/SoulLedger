"""限流的「你是谁」必须和 `apps/core/client_ip.py` 是同一个答案(IS-01)。

DRF 的 `BaseThrottle.get_ident` 在 `NUM_PROXIES` 未设时(本仓库从未设过)
**返回整条客户端自带的 `X-Forwarded-For`**。于是默认的 `AnonRateThrottle`
—— 全站唯一的默认限流 —— 以一个请求头为键,换一个值就是一个新桶。
`RegisterThrottle` 继承同一个 `get_ident`,注册限流同样可被重置。

登录限流、审计 IP、`ExternalApiKey.allowed_ips` 早就改走 `get_client_ip`
(它按 `TRUSTED_PROXY_COUNT` 从右数,默认完全不信这个头);限流是剩下的
那一个。这份文件断言:同一个客户端,无论 XFF 怎么换,落在同一个桶里。

2026-09-12 在修复前的树上实跑这一份,六条全红,且红在正确的地方 ——
默认限流的键是 `throttle_anon_1.1.1.1` / `throttle_anon_2.2.2.2` /
`throttle_anon_3.3.3.3,10.0.0.1`(客户端写什么,桶就是什么),
而 `PasswordResetThrottle()` 连构造都构造不出来:`KeyError: '5'`。
"""
import pytest
from django.core.cache import cache
from django.test import RequestFactory
from rest_framework import throttling as drf_throttling
from rest_framework.request import Request
from rest_framework.views import APIView

REMOTE = "203.0.113.77"
# The first entries are what a client types; the last is what a proxy would append.
ROTATING_XFF = [None, "1.1.1.1", "2.2.2.2", "3.3.3.3, 10.0.0.1", "not-an-ip"]


class _Authenticated:
    is_authenticated = True
    pk = 1


def _request(xff=None, remote=REMOTE, user=None):
    extra = {"REMOTE_ADDR": remote}
    if xff is not None:
        extra["HTTP_X_FORWARDED_FOR"] = xff
    req = Request(RequestFactory().post("/probe/", **extra))
    if user is not None:
        req.user = user
    return req


def _keys(throttle_cls, xffs, **kw):
    return {throttle_cls().get_cache_key(_request(xff, **kw), None) for xff in xffs}


@pytest.fixture(autouse=True)
def _no_proxies(settings):
    settings.TRUSTED_PROXY_COUNT = 0


def test_the_default_throttles_key_one_client_to_one_bucket():
    """`APIView.throttle_classes` is what every view actually inherits —
    bound at import from DEFAULT_THROTTLE_CLASSES — so it is what is checked."""
    assert APIView.throttle_classes, "no default throttle at all would make this vacuous"
    for cls in APIView.throttle_classes:
        keys = _keys(cls, ROTATING_XFF)
        assert len(keys) == 1, f"{cls.__module__}.{cls.__name__} 按 XFF 分桶:{sorted(keys)}"
        (key,) = keys
        assert REMOTE in key, key
        # Absence: nothing the client typed made it into the key.
        assert "1.1.1.1" not in key and "not-an-ip" not in key, key


def test_the_auth_endpoint_throttles_key_one_client_to_one_bucket():
    from apps.authentication.throttles import PasswordResetThrottle, RegisterThrottle

    for cls in (RegisterThrottle, PasswordResetThrottle):
        keys = _keys(cls, ROTATING_XFF)
        assert len(keys) == 1, f"{cls.__name__} 按 XFF 分桶:{sorted(keys)}"
        assert REMOTE in next(iter(keys))


def test_an_authenticated_caller_does_not_escape_the_auth_endpoint_throttles():
    """`AnonRateThrottle.get_cache_key` returns None — *no limit* — for an
    authenticated request. Registration is AllowAny, so one account's token
    was a pass to register and to request resets without any IP limit."""
    from apps.authentication.throttles import PasswordResetThrottle, RegisterThrottle

    for cls in (RegisterThrottle, PasswordResetThrottle):
        key = cls().get_cache_key(_request(user=_Authenticated()), None)
        assert key is not None, f"{cls.__name__} 对已登录请求不限流"
        assert REMOTE in key


def test_behind_a_trusted_proxy_a_forged_prefix_cannot_move_the_bucket(settings):
    """With one trusted proxy the client is the entry immediately LEFT of the
    proxy's own — `tests/test_client_ip_is_validated.py` pins that rule, and
    everything further left is attacker-controlled. Rotating that prefix must
    not buy a new bucket, which is the same attack as rotating the whole
    header, one hop further in."""
    settings.TRUSTED_PROXY_COUNT = 1
    xffs = [f"1.2.3.{i}, 203.0.113.9, 198.51.100.7" for i in range(4)]
    for cls in APIView.throttle_classes:
        keys = _keys(cls, xffs, remote="10.0.0.2")
        assert len(keys) == 1, sorted(keys)
        (key,) = keys
        assert "203.0.113.9" in key, key
        assert "1.2.3." not in key, key


def test_a_multi_unit_rate_parses():
    """`"password_reset": "3/5minute"` sat in settings unparseable: DRF reads
    only the first character of the period, so `'5'` raised KeyError the moment
    anything instantiated the throttle — which nothing did (BP-14)."""
    from apps.authentication.throttles import PasswordResetThrottle

    assert PasswordResetThrottle().parse_rate("3/5minute") == (3, 300)
    assert PasswordResetThrottle().parse_rate("60/minute") == (60, 60)
    assert PasswordResetThrottle().parse_rate("5/hour") == (5, 3600)


@pytest.mark.django_db
def test_rotating_forwarded_for_does_not_reset_the_anonymous_limit(api_client, monkeypatch):
    """End to end, through a real anonymous endpoint that carries only the
    default throttle. The rate is lowered on DRF's class, which the project's
    subclass inherits, so this test means the same thing before and after."""
    # `raising=False`: SimpleRateThrottle assigns `rate` in __init__, so the
    # class attribute does not exist until then. Set on DRF's class, which the
    # project's subclass inherits, so the test means the same thing on both.
    monkeypatch.setattr(drf_throttling.AnonRateThrottle, "rate", "2/minute", raising=False)
    idents = [REMOTE] + [x for x in ROTATING_XFF if x]
    stale = [f"throttle_anon_{i}" for i in idents]
    cache.delete_many(stale)
    try:
        statuses = []
        for xff in ["4.4.4.4", "5.5.5.5", "6.6.6.6"]:
            res = api_client.post(
                "/api/v1/auth/refresh/", {"refresh": "junk"}, format="json",
                REMOTE_ADDR=REMOTE, HTTP_X_FORWARDED_FOR=xff,
            )
            statuses.append(res.status_code)
        assert statuses == [401, 401, 429], statuses
    finally:
        cache.delete_many(stale + [f"throttle_anon_{i}" for i in ("4.4.4.4", "5.5.5.5", "6.6.6.6")])
