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
        # ONE SET OBJECT, MUTATED IN PLACE. Not `scope["permissions"] = new_set`.
        #
        # The scope is copied at least twice between here and the consumer:
        # `BaseMiddleware.__call__` opens with
        #
        #     scope = dict(scope)   # Copy scope to stop changes going upstream
        #
        # and `channels.routing.URLRouter` routes with `dict(scope, ...)`. So the
        # dict this middleware holds -- the one `wrapped_receive` below closes
        # over -- is **not** the dict the consumer receives, and rebinding the
        # key on a refresh lands in an object nothing downstream will ever read.
        #
        # **This is a third independent reason the refresh did nothing, and it
        # defeats both of the other two fixes on its own.** It was found by
        # writing the end-to-end test: the middleware reported the new
        # permission set correctly and the gated event kept arriving anyway.
        #
        # `dict(scope)` is a *shallow* copy, so every copy holds the same set
        # object. Mutating that set in place is visible through all of them --
        # including the consumer's own `self.permissions`, which is a reference
        # to it rather than a copy of its contents.
        user = scope.get("user")
        permissions = set(await self._resolve_permissions(user))
        scope["permissions"] = permissions

        # Wrap receive to handle permission refresh messages
        async def wrapped_receive():
            message = await receive()

            if message.get("type") == "websocket.receive":
                try:
                    data = json.loads(message.get("text", "{}"))
                except (json.JSONDecodeError, TypeError):
                    data = {}

                if data.get("type") == "permission.refresh":
                    fresh = await self._resolve_permissions(user)
                    # In place. See the note in __call__ above.
                    permissions.clear()
                    permissions.update(fresh)
                    await send({
                        "type": "websocket.send",
                        "text": json.dumps({
                            "type": "permission.refreshed",
                            "permissions": sorted(permissions),
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

        # Re-read the row. `user` is the object this connection authenticated
        # with, captured in a closure at connect time -- its `.role` is a
        # snapshot from then, and a demotion written to the database after that
        # is invisible to it forever.
        #
        # Measured with `WebsocketCommunicator` over the real
        # `config.asgi.application`:
        #
        #     [R0] JUDGE=21 codenames, VIEWER=9
        #     [R1] connect perms n=21
        #     [R2] after demoting to VIEWER in the DB, refresh returned n=21
        #          equals the VIEWER set? False   equals the JUDGE set? True
        #
        # So the one mechanism the product offers for this -- sending
        # `{"type": "permission.refresh"}` -- answered 200 with a permission
        # list that had not changed in any field. **A remedy that reports
        # success and does nothing is worse than no remedy**: it ends the
        # investigation.
        from apps.authentication.models import User

        fresh = User.objects.filter(pk=getattr(user, "pk", None)).first()
        if fresh is None or not fresh.is_active:
            # Deleted or deactivated since connect. No permissions, and the
            # active check matches `apps/core/ws_auth.py`, which refuses an
            # inactive user at connect time -- an account switched off mid-session
            # should not keep the socket it already holds.
            return set()
        user = fresh

        role = getattr(user, "role", None)
        if not role:
            return set()

        try:
            from apps.perm.services import get_role_permission_codenames
            return set(get_role_permission_codenames(role))
        except Exception:
            logger.exception("PermissionMiddleware: error resolving permissions")
            return set()
