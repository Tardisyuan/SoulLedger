"""
TenantMiddleware — resolves tenant from JWT claim and sets request.tenant.

Place AFTER django.contrib.auth.middleware.AuthenticationMiddleware in MIDDLEWARE.
"""
import copy
import logging
import time

from django.http import HttpRequest

logger = logging.getLogger(__name__)

#: How long a worker trusts its in-process copy of a hall row (perf review 2026-10-27 #4: the row was read on
#: every authenticated request). Saving or deleting any Tenant clears this worker's copies at once
#: (`apps/tenants/models.py::_drop_cached_halls`); other workers see the change within this many seconds.
# ponytail: per-process dict, so a hall edit reaches other gunicorn workers only after the TTL; move to a
# shared cache key with a version bump if a hall setting ever has to take effect on every worker instantly.
TENANT_CACHE_TTL = 30.0
_tenant_cache: dict[str, tuple[float, object]] = {}

#: `request` attribute carrying `(raw token, AccessToken)` from the middleware to DRF's authenticator, so a
#: request decodes and verifies its JWT once (`apps/soul_accounts/authentication.py::OfficerJWTAuthentication`).
DECODED_ACCESS_ATTR = "_decoded_access_token"


def cached_tenant(code: str):
    """The Tenant with this code — from this worker's copy while it is fresher than TENANT_CACHE_TTL.

    Returns a copy, so a view that scribbles on `request.tenant` without saving cannot leak that into the next
    request. Raises `Tenant.DoesNotExist` like `.get()`; an unknown code is not cached."""
    from apps.tenants.models import Tenant

    hit = _tenant_cache.get(code)
    now = time.monotonic()
    if hit is None or now - hit[0] > TENANT_CACHE_TTL:
        hit = (now, Tenant.objects.get(code=code))
        _tenant_cache[code] = hit
    return copy.deepcopy(hit[1])


def clear_tenant_cache(**_kwargs) -> None:
    _tenant_cache.clear()


class TenantMiddleware:
    """
    Extracts tenant_code from the JWT access token's payload and attaches
    the resolved Tenant object to request.tenant.  Also sets the tenant
    contextvar (contextvars, not thread-local — async and Celery need it).

    THE CONTEXTVAR DOES NOT MAKE QUERIES FILTER THEMSELVES. This docstring
    said "so TenantManager can automatically filter querysets" until
    2026-09-06; `TenantManager` filters soft deletes only. Isolation is
    `apps.core.tenant.scope_to_tenant`, called from each view's
    `get_queryset`. The contextvar is read by `apps/audit/signals.py` for
    attribution and by model `save()` hooks that stamp `tenant` on create.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request: HttpRequest):
        from apps.tenants.managers import clear_current_tenant, set_current_tenant

        tenant = self._resolve_tenant(request)
        request.tenant = tenant
        set_current_tenant(tenant)

        try:
            response = self.get_response(request)
            return response
        finally:
            clear_current_tenant()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_tenant(request: HttpRequest):
        """Return the Tenant for the current request, or None."""
        tenant_code = _extract_tenant_code_from_jwt(request)
        if not tenant_code:
            return None

        from apps.tenants.models import Tenant
        try:
            return cached_tenant(tenant_code)
        except Tenant.DoesNotExist:
            logger.warning("TenantMiddleware: unknown tenant_code=%s", tenant_code)
            return None
        except Exception:
            logger.exception("TenantMiddleware: error resolving tenant")
            return None


def _extract_tenant_code_from_jwt(request: HttpRequest) -> str | None:
    """Decode the Bearer token and return the 'tenant_code' claim, or None."""
    auth_header = (
        request.META.get("HTTP_AUTHORIZATION", "")
        or request.headers.get("Authorization", "")
    )

    if not auth_header.startswith("Bearer "):
        return None

    token_str = auth_header.split(" ", 1)[1].strip()

    try:
        from rest_framework_simplejwt.exceptions import (
            InvalidToken,
            TokenError,
        )
        from rest_framework_simplejwt.tokens import AccessToken
        token = AccessToken(token_str)
        setattr(request, DECODED_ACCESS_ATTR, (token_str, token))
        return token.get("tenant_code")
    except (TokenError, InvalidToken):
        return None
    except Exception:
        return None
