"""Throttle classes for the authentication endpoints.

Both are keyed on the validated client IP (`apps/core/throttling.py`) rather
than DRF's `get_ident`, which returns the client's own `X-Forwarded-For` when
`NUM_PROXIES` is unset — so rotating one header used to buy a fresh bucket per
request (IS-01). Both also apply to authenticated callers: these endpoints
exist for people who are not logged in, and `AnonRateThrottle` exempts anyone
holding a token.

`LoginThrottle` (scope "login", 10/minute) is gone, with its rate. It was
declared here and referenced by nothing — `LoginView.post` has always used its
own cache counter (5 attempts / 15 minutes per IP), which is stricter, so the
class was a second, dead answer to a question already answered (BP-14).
"""
from apps.core.throttling import ClientIPRateThrottle


class RegisterThrottle(ClientIPRateThrottle):
    """Registration: 5 per hour per IP. Called by `register_view`."""

    scope = "register"


class PasswordResetThrottle(ClientIPRateThrottle):
    """Password-reset requests: 3 per 5 minutes per IP.

    Wired into `reset_password_request` as of BP-03. Until then it was
    unreferenced, and its rate string `"3/5minute"` was unparseable by DRF —
    instantiating it raised `KeyError: '5'`. A throttle nobody constructs
    cannot reveal that its own rate is malformed.
    """

    scope = "password_reset"
