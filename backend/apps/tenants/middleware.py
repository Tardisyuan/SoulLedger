"""
TenantMiddleware — resolves tenant from JWT claim and sets request.tenant.

Place AFTER django.contrib.auth.middleware.AuthenticationMiddleware in MIDDLEWARE.
"""
import logging

from django.http import HttpRequest

logger = logging.getLogger(__name__)


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

        try:
            from apps.tenants.models import Tenant
            return Tenant.objects.get(code=tenant_code)
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
        return token.get("tenant_code")
    except (TokenError, InvalidToken):
        return None
    except Exception:
        return None
