"""Throttles that ask `apps/core/client_ip.py` who the client is.

DRF's `BaseThrottle.get_ident` returns the **whole client-supplied
`X-Forwarded-For`** whenever `NUM_PROXIES` is unset — and this project has never
set it. The only default throttle (`AnonRateThrottle`, 60/min) was therefore
keyed on a request header: one extra `X-Forwarded-For: <anything>` and the
counter started over, so the limit bounded nothing (IS-01). `RegisterThrottle`
inherited the same `get_ident`, and so did every other throttle built on DRF's.

Everything else in this codebase stopped trusting that header in 2026-08:
the audit log's IP, `ExternalApiKey.allowed_ips` and the login brute-force
limiter all go through `get_client_ip`, which counts from the **right** using
`TRUSTED_PROXY_COUNT` and ignores the header entirely when that is 0. Throttling
was the last caller left on the old rule.

**Why not just set `NUM_PROXIES`.** It would fix the rotation, and it would
leave two settings answering one question — `TRUSTED_PROXY_COUNT` for audit and
API keys, `NUM_PROXIES` for throttles — free to drift apart, with the drift
visible only as a rate limit that counts a different client than the audit row
written beside it. DRF's version also does not validate the address it picks,
which is how an unparseable value once reached a database column
(see `apps/core/client_ip.py`). One source, one answer.
"""
import re

from rest_framework import throttling

from apps.core.client_ip import get_client_ip

#: What to key on when no usable address can be determined (a request with no
#: valid `REMOTE_ADDR`). These share one bucket rather than being exempted:
#: `get_client_ip` returning None is a real answer, and "cannot identify the
#: caller" must not mean "do not limit the caller".
UNKNOWN_IDENT = "unknown"

_RATE = re.compile(r"^(\d*)\s*([smhd])", re.IGNORECASE)
_PERIOD_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400}


class ClientIPIdentMixin:
    """Keys on the validated client IP, and understands multi-unit rates."""

    def get_ident(self, request):
        return get_client_ip(request) or UNKNOWN_IDENT

    def parse_rate(self, rate):
        """Accept `"3/5minute"` as well as DRF's `"3/m"`.

        DRF reads only the first character of the period, so `"3/5minute"` —
        which is what `DEFAULT_THROTTLE_RATES["password_reset"]` has always
        said — raised `KeyError: '5'` the moment anything instantiated the
        throttle. Nothing ever did, so the rate sat there looking configured
        for as long as it has existed (BP-14).
        """
        if rate is None:
            return (None, None)
        num, period = rate.split("/")
        match = _RATE.match(period.strip())
        if not match:
            raise ValueError(f"Unparseable throttle rate period: {period!r}")
        multiplier = int(match.group(1) or 1)
        return int(num), multiplier * _PERIOD_SECONDS[match.group(2).lower()]


class AnonRateThrottle(ClientIPIdentMixin, throttling.AnonRateThrottle):
    """Drop-in for `DEFAULT_THROTTLE_CLASSES`; anonymous requests only."""


class ClientIPRateThrottle(ClientIPIdentMixin, throttling.SimpleRateThrottle):
    """Per-IP, **whether or not the caller is authenticated**.

    `AnonRateThrottle.get_cache_key` returns None — meaning no limit — for any
    authenticated request. On endpoints that exist for people who are *not*
    logged in (register, password reset) that is a hole with a one-account
    price: obtain any token, and the IP limit stops applying to you. These
    endpoints are limited by address, full stop.
    """

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
