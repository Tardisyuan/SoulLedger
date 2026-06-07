"""
Tenant isolation middleware for WebSocket connections.

Extracts tenant_code from JWT claim and resolves the Tenant object.
Sets scope["tenant"] and activates TenantManager context variable.

Requires JWTAuthMiddleware to run first (scope["user"] must be set).
"""
import logging

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware

logger = logging.getLogger(__name__)


class TenantMiddleware(BaseMiddleware):
    """Resolve tenant from JWT and set scope["tenant"]."""

    async def __call__(self, scope, receive, send):
        from apps.tenants.managers import clear_current_tenant, set_current_tenant

        user = scope.get("user")
        tenant = None

        if user and hasattr(user, "tenant") and user.tenant is not None:
            tenant = user.tenant
        elif user and hasattr(user, "rbac_role") and user.rbac_role is not None:
            # Try tenant from JWT claim as fallback
            tenant_code = scope.get("jwt_claims", {}).get("tenant_code")
            if tenant_code:
                tenant = await self._resolve_tenant(tenant_code)

        scope["tenant"] = tenant

        if tenant:
            set_current_tenant(tenant)

        try:
            return await super().__call__(scope, receive, send)
        finally:
            clear_current_tenant()

    @database_sync_to_async
    def _resolve_tenant(self, tenant_code):
        """Look up Tenant by code."""
        try:
            from apps.tenants.models import Tenant
            return Tenant.objects.get(code=tenant_code)
        except Tenant.DoesNotExist:
            logger.warning("TenantMiddleware: unknown tenant_code=%s", tenant_code)
            return None
