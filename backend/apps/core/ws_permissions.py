"""
Permission middleware for WebSocket connections.

Resolves the user's RBAC permission set and attaches it to scope["permissions"].
Supports periodic permission refresh via {"type": "permission.refresh"} messages.

Requires:
  - JWTAuthMiddleware (scope["user"] must be set)
  - TenantMiddleware (scope["tenant"] must be set)
"""
import json
import logging

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware

logger = logging.getLogger(__name__)


class PermissionMiddleware(BaseMiddleware):
    """Resolve RBAC permissions and set scope["permissions"]."""

    async def __call__(self, scope, receive, send):
        user = scope.get("user")
        scope["permissions"] = await self._resolve_permissions(user)

        # Wrap receive to handle permission refresh messages
        async def wrapped_receive():
            message = await receive()

            if message.get("type") == "websocket.receive":
                try:
                    data = json.loads(message.get("text", "{}"))
                except (json.JSONDecodeError, TypeError):
                    data = {}

                if data.get("type") == "permission.refresh":
                    scope["permissions"] = await self._resolve_permissions(user)
                    await send({
                        "type": "websocket.send",
                        "text": json.dumps({
                            "type": "permission.refreshed",
                            "permissions": sorted(scope["permissions"]),
                        }),
                    })
                    # Return next message instead of this one
                    return await wrapped_receive()

            return message

        return await super().__call__(scope, wrapped_receive, send)

    @database_sync_to_async
    def _resolve_permissions(self, user):
        """Get permission codenames for the user's RBAC role."""
        if not user or not getattr(user, "is_authenticated", False):
            return set()

        # ADMIN bypass — all permissions
        if hasattr(user, "role") and user.role == "ADMIN":
            from apps.perm.models import DEFAULT_PERMISSIONS
            return {codename for codename, _, _ in DEFAULT_PERMISSIONS}

        rbac_role = getattr(user, "rbac_role", None)
        if not rbac_role:
            return set()

        try:
            return rbac_role.get_inherited_permissions()
        except Exception:
            logger.exception("PermissionMiddleware: error resolving permissions")
            return set()
