"""
Permission middleware for WebSocket connections.

Resolves the user's RBAC permission set and attaches it to scope["permissions"].
`{"type": "permission.refresh"}` is handled by `NotificationConsumer`, which
re-resolves through `resolve_permissions_for` below.

Requires:
  - JWTAuthMiddleware (scope["user"] must be set)
  - TenantMiddleware (scope["tenant"] must be set)
"""
import logging

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware

logger = logging.getLogger(__name__)


def resolve_permissions_for(user) -> set:
    """The permission codenames `user`'s role holds RIGHT NOW. Sync.

    THE ONE RESOLVER. Both the connect-time set (this middleware) and every
    refresh (`NotificationConsumer`) go through here, whichever way the
    socket authenticated. Until 2026-09-12 (BP-08) there were two: this one,
    inside a `wrapped_receive` closure that captured the connect-time `user`,
    and a second in the consumer. On the `?token=` path the two agreed. On the
    first-frame `{"type": "auth"}` path the middleware's `user` was
    AnonymousUser forever, so `permission.refresh` was answered with an
    **empty** set and the gate closed for good -- while the `connected` frame
    had just listed 21 codenames.

    Delegates to ``apps.perm.services.get_role_permission_codenames``, which
    asks ``apps.perm.checker.check_permission`` — the same function that
    decides every enforcement decision, the role-permissions endpoint, and the
    login response — per codename. This used to read
    ``user.rbac_role.get_inherited_permissions()`` instead: a separate FK,
    resolved by walking ``Role.parent``, that never consulted the
    ``ROLE_PERMISSIONS`` dict fallback; any user whose ``rbac_role`` was NULL
    got an empty set regardless of ``role``. ``Role.parent`` inheritance is not
    reproduced here and is not load-bearing: nothing seeded ever sets it.

    RE-READS THE ROW. `user` is the object the connection authenticated with;
    its `.role` is a snapshot from then, and a demotion written to the database
    after that is invisible to it forever. Measured over the real
    `config.asgi.application`: after demoting JUDGE→VIEWER in the DB, refresh
    still returned the JUDGE set (n=21). A remedy that reports success and does
    nothing is worse than no remedy: it ends the investigation. See
    tests/test_a_demotion_reaches_an_open_socket.py.
    """
    if not user or not getattr(user, "is_authenticated", False):
        return set()

    from apps.authentication.models import User

    fresh = User.objects.filter(pk=getattr(user, "pk", None)).first()
    if fresh is None or not fresh.is_active:
        # Deleted or deactivated since connect. No permissions, and the active
        # check matches `apps/core/ws_auth.py`, which refuses an inactive user
        # at connect time -- an account switched off mid-session should not
        # keep the socket it already holds.
        return set()

    role = getattr(fresh, "role", None)
    if not role:
        return set()

    try:
        from apps.perm.services import get_role_permission_codenames
        return set(get_role_permission_codenames(role))
    except Exception:
        logger.exception("ws_permissions: error resolving permissions")
        return set()


class PermissionMiddleware(BaseMiddleware):
    """Resolve RBAC permissions and set scope["permissions"]."""

    async def __call__(self, scope, receive, send):
        # ONE SET OBJECT, MUTATED IN PLACE FROM HERE ON. Never
        # `scope["permissions"] = new_set` downstream.
        #
        # The scope is copied at least twice between here and the consumer:
        # `BaseMiddleware.__call__` opens with `scope = dict(scope)` and
        # `channels.routing.URLRouter` routes with `dict(scope, ...)`. So the
        # dict this middleware holds is **not** the dict the consumer receives,
        # and rebinding the key anywhere lands in an object nothing else reads.
        # It was found by writing the end-to-end test: a refresh reported the
        # new permission set correctly and the gated event kept arriving anyway.
        #
        # `dict(scope)` is a *shallow* copy, so every copy holds this same set
        # object. `NotificationConsumer` therefore `clear()`s and `update()`s
        # it -- on first-frame auth and on every refresh -- and the gate in
        # `realtime_event`, which reads `self.scope["permissions"]`, sees the
        # change through every copy.
        scope["permissions"] = set(await self._resolve_permissions(scope.get("user")))
        return await super().__call__(scope, receive, send)

    @database_sync_to_async
    def _resolve_permissions(self, user):
        return resolve_permissions_for(user)
