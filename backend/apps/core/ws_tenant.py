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

        # `user.tenant`, and only that.
        #
        # There used to be a fallback reading `scope["jwt_claims"]["tenant_code"]`
        # — and **nothing anywhere writes `scope["jwt_claims"]`**. A repo-wide
        # grep found exactly one occurrence of that key: the read below it.
        # So the branch could not execute, and its presence claimed a second
        # source of truth this transport does not have.
        #
        # WORTH KNOWING, NOT A LEAK. HTTP resolves the tenant from the token's
        # `tenant_code` claim (`TenantMiddleware`); WebSocket resolves it from
        # the user's own FK. The two can disagree — measured 2026-08-29, one
        # token gave `request.tenant = ZZB` over HTTP while the socket joined
        # `rt:tenant:ZZA`. The FK is the stricter of the two (it cannot be
        # asserted by a token), so removing the fallback narrows nothing; it
        # just stops advertising a path that never ran. The disagreement itself
        # is L25 and is a separate decision.
        if user and getattr(user, "tenant", None) is not None:
            tenant = user.tenant

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
