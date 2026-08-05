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
        """Get the permission codenames the user's role holds.

        Delegates to ``apps.perm.services.get_role_permission_codenames``,
        which asks ``apps.perm.checker.check_permission`` — the same
        function that decides every enforcement decision, the
        role-permissions endpoint, and the login response — per codename.

        This used to read ``user.rbac_role.get_inherited_permissions()``
        instead: a separate FK, resolved by walking ``Role.parent``, that
        never consulted the ``ROLE_PERMISSIONS`` dict fallback. Any codename
        without a seeded ``Permission`` row was therefore invisible here even
        though ``check_permission`` granted it — and any user whose
        ``rbac_role`` was NULL (unset on this branch for anyone created
        before migration 0010, and unset entirely on a fresh signup) got an
        empty permission set regardless of ``role``. ADMIN happened to look
        right only because it short-circuited to ``DEFAULT_PERMISSIONS``
        here, which coincidentally matches what the checker now grants
        ADMIN; every other role under-reported.

        ``Role.parent`` inheritance is not reproduced by this call. It is
        not load-bearing: nothing in migrations, fixtures, `apps/perm/export.py`
        import/export, or any management command ever sets a non-NULL
        `parent` on a `Role` row — the field and `get_inherited_permissions`
        are exercised only by `apps/perm/tests.py`'s direct model tests, never
        by seeded data. If a hierarchy is wanted for real, it needs to be
        modelled inside `check_permission` itself so every caller (this one
        included) gets it consistently, rather than resolved a second way
        here.
        """
        if not user or not getattr(user, "is_authenticated", False):
            return set()

        role = getattr(user, "role", None)
        if not role:
            return set()

        try:
            from apps.perm.services import get_role_permission_codenames
            return set(get_role_permission_codenames(role))
        except Exception:
            logger.exception("PermissionMiddleware: error resolving permissions")
            return set()
