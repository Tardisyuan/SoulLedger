"""
NotificationConsumer — unified WebSocket consumer for all real-time domains.

Supports:
  - connect: authenticate + join user + tenant groups
  - disconnect: leave groups
  - heartbeat: periodic ping/pong keepalive
  - permission.refresh: re-resolve user permissions

Channel Groups (unified naming):
  - rt:user:{user_id}        — per-user targeted messages
  - rt:tenant:{tenant_code}  — tenant-wide broadcast messages

Event Domains received:
  - notification  — in-app notifications
  - workflow      — workflow lifecycle events
  - dispatch      — cross-tenant dispatch events
  - deathsync     — death registration sync events
"""
import json
import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

logger = logging.getLogger(__name__)


class NotificationConsumer(AsyncWebsocketConsumer):
    """
    Unified WebSocket consumer for all real-time event domains.

    Inbound message types:
        heartbeat          → respond with pong
        permission.refresh → re-resolve permissions, send updated list
        auth               → authenticate via token (if no query token)
    """

    async def connect(self):
        """
        Accept connection and join user + tenant notification groups.

        If user is already authenticated (token in query string), join groups immediately.
        If user is AnonymousUser (no query token), accept and wait for auth message.
        """
        self.user = self.scope.get("user")
        self.tenant = self.scope.get("tenant")
        self.permissions = self.scope.get("permissions", set())

        if self.user and getattr(self.user, "is_authenticated", False):
            self.data_scope = await self._resolve_data_scope()
            await self._join_groups()
            await self.accept()
            await self._send_connected()
            logger.info(
                "WS connected: user=%s tenant=%s",
                self.user.id,
                getattr(self.tenant, "code", None),
            )
        else:
            # No token in query — accept and wait for auth message
            await self.accept()

    async def disconnect(self, close_code):
        """Leave all joined groups."""
        for group_attr in ("user_group", "tenant_group", "officers_group"):
            if hasattr(self, group_attr):
                await self.channel_layer.group_discard(
                    getattr(self, group_attr), self.channel_name
                )

        logger.info("WS disconnected: user=%s code=%s", getattr(self, "user", None), close_code)

    async def receive(self, text_data):
        """Handle inbound messages from client."""
        try:
            data = json.loads(text_data or "{}")
        except (json.JSONDecodeError, TypeError):
            return

        msg_type = data.get("type", "")

        # Handle auth message (deferred auth flow)
        if msg_type == "auth" and data.get("token"):
            if self.user and getattr(self.user, "is_authenticated", False):
                return  # Already authenticated

            user = await self._authenticate_token(data["token"])
            if user is None:
                await self.send(text_data=json.dumps({
                    "type": "error",
                    "code": 4001,
                    "message": "Invalid token",
                }))
                await self.close(code=4001)
                return

            self.user = user
            self.tenant = getattr(user, "tenant", None)
            # Write the identity back into the scope, and the permissions INTO
            # the set the middleware put there -- not `self.permissions = ...`.
            # BP-08 (2026-09-12): this branch set `self.permissions` only, while
            # the gate in `realtime_event` reads `self.scope["permissions"]`,
            # which still held the empty set `PermissionMiddleware` computed for
            # AnonymousUser. The `connected` frame listed 21 codenames and every
            # gated event was dropped. See `_apply_permissions`.
            self.scope["user"] = user
            self.scope["tenant"] = self.tenant
            self._apply_permissions(await self._resolve_permissions())
            self.data_scope = await self._resolve_data_scope()

            await self._join_groups()
            await self._send_connected()
            logger.info("WS authenticated via first message: user=%s", user.id)
            return

        # Require authentication for all other messages
        if not self.user or not getattr(self.user, "is_authenticated", False):
            await self.send(text_data=json.dumps({
                "type": "error",
                "code": 4001,
                "message": "Not authenticated",
            }))
            return

        if msg_type == "heartbeat":
            await self.send(text_data=json.dumps({"type": "pong"}))

        elif msg_type == "permission.refresh":
            # The only handler for refresh, on both authentication paths.
            # `PermissionMiddleware` used to intercept this message in a
            # `wrapped_receive` closure that had captured the connect-time
            # user -- AnonymousUser on the first-frame path -- so a refresh
            # after first-frame auth emptied the set. Now the middleware only
            # computes the initial set and this branch, which knows the real
            # `self.user`, re-resolves through the same function.
            self._apply_permissions(await self._resolve_permissions())
            self.data_scope = await self._resolve_data_scope()
            await self.send(text_data=json.dumps({
                "type": "permission.refreshed",
                "permissions": sorted(self.permissions),
            }))

    # ------------------------------------------------------------------
    # Group message handlers (unified: all domains use same handler)
    # ------------------------------------------------------------------

    async def realtime_event(self, event):
        """Handle realtime_event group message — forward data to client.

        If the event carries a ``_permission`` gate, the consumer checks
        whether the connected user holds that permission.  Users lacking
        the required permission silently do not receive the event.
        """
        data = event.get("data", {})

        required_permission = data.get("_permission")
        # Reads the scope rather than `self.permissions` because the scope is
        # where the answer lives. Be clear about what is and is not load-bearing
        # here, because the audit got it wrong and so did the first fix:
        #
        # The audit proposed "have the consumer read `self.scope["permissions"]`
        # instead of its `connect()`-time copy". **That alone does not work.**
        # The scope is shallow-copied at least twice on the way in
        # (`BaseMiddleware.__call__`, then `URLRouter`), so the dict the
        # middleware rebinds is not the dict read here. Measured: with the
        # middleware re-reading the user *and* this line reading the scope, the
        # gated event still arrived after a demotion.
        #
        # What actually fixes it is that `PermissionMiddleware` keeps **one set
        # object** and mutates it in place -- shallow copies all point at it. So
        # `self.permissions` and `self.scope["permissions"]` are now the same
        # object and either read works. This line prefers the scope because it
        # names the source of truth; swapping it back to `self.permissions`
        # would not break anything today, and a mutation test confirms that.
        current = self.scope.get("permissions", set())
        if required_permission and required_permission not in current:
            return  # user lacks the required permission — drop silently

        # 定向事件(`WebSocketHandler` 写的 `_recipients`)只给收件人:
        # 即便某条路径又把它发进了殿组,别人的个人通知也到不了这条连接。
        recipients = data.get("_recipients")
        if recipients is not None:
            if getattr(self.user, "id", None) not in recipients:
                return
            data = {k: v for k, v in data.items() if k != "_recipients"}

        # 殿组业务帧带数据范围标签(`apps/events/realtime.py::scope_tag`,B5):范围外丢弃;标签不发给客户端。
        tag = data.get("_scope")
        if tag is not None:
            if not self._in_data_scope(tag):
                return
            data = {k: v for k, v in data.items() if k != "_scope"}

        await self.send(text_data=json.dumps(data))

    async def session_ended(self, event):
        """登录已结束(改密码 / 重置 / 停用):握手时版本过时的连接关闭。

        `min_version` 为 None = 全部关(停用)。关闭码 4002 让客户端重连:
        当前设备带新令牌连得上,被踢的设备被握手拒绝后走「登录已失效」。
        """
        from apps.events.realtime import WS_CLOSE_SESSION_ENDED

        min_version = event.get("min_version")
        if min_version is not None and getattr(self.user, "session_version", 0) >= min_version:
            return
        await self.close(code=WS_CLOSE_SESSION_ENDED)

    async def permission_refresh(self, event):
        """服务端推的权限刷新(第 10 条 / M-1,`apps/events/realtime.py::push_permission_refresh`)。

        与客户端发 `permission.refresh` 同一个重算;门控 `realtime_event` 读的就是这份集合,所以被降级的人
        即使客户端什么都不做,从这一刻起也收不到已无权看的事件。发给本人的(`targeted`)总回一帧;广播的只有
        集合变了才回,前端收到即重取权限。"""
        if not self.user or not getattr(self.user, "is_authenticated", False):
            return
        fresh = await self._resolve_permissions()
        # 数据范围(B5)每次都重算:配置行或本人机构变了,权限集可以一样。
        self.data_scope = await self._resolve_data_scope()
        if not event.get("targeted") and fresh == set(self.permissions):
            return
        self._apply_permissions(fresh)
        await self.send(text_data=json.dumps({
            "type": "permission.refreshed",
            "permissions": sorted(self.permissions),
        }))

    # Legacy handler — backward compat with old notification_push
    async def notification_push(self, event):
        """Handle legacy notification_push — forward data to client."""
        await self.send(text_data=json.dumps(event["data"]))

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _join_groups(self):
        """Join user and tenant groups using unified naming convention."""
        from apps.events.realtime import ChannelNaming

        # User group (targeted)
        self.user_group = ChannelNaming.user_group(self.user.id)
        await self.channel_layer.group_add(self.user_group, self.channel_name)

        # Every officer socket: grant changes are broadcast here (`push_permission_refresh`).
        self.officers_group = ChannelNaming.OFFICERS_GROUP
        await self.channel_layer.group_add(self.officers_group, self.channel_name)

        # Tenant group (broadcast)
        tenant_code = getattr(self.tenant, "code", None)
        if tenant_code:
            self.tenant_group = ChannelNaming.tenant_group(tenant_code)
            await self.channel_layer.group_add(self.tenant_group, self.channel_name)

    async def _send_connected(self):
        """Send connection confirmation with context."""
        await self.send(text_data=json.dumps({
            "type": "connected",
            "user_id": self.user.id,
            "tenant_code": getattr(self.tenant, "code", None),
            "permissions": sorted(self.permissions),
        }))

    @database_sync_to_async
    def _authenticate_token(self, token_str):
        """Validate JWT and return User, or None.

        Same rules as `JWTAuthMiddleware` (rbac-scope 第 14 条): active account, not SOUL, session still current,
        token's hall claim matches the user's. This used to only check the signature and refuse impersonation
        tokens — safe only because the middleware had already vetted the same frame; on a route without that
        middleware it would have let a deactivated or password-changed session in.
        """
        from apps.core.ws_auth import JWTAuthMiddleware

        user, _reason = JWTAuthMiddleware.check_token_sync(token_str)
        return user

    def _apply_permissions(self, fresh):
        """Replace the permission set IN PLACE and point `self.permissions` at it.

        In place because the scope is shallow-copied between the middleware and
        here: every copy holds the same set object, so mutating it is what makes
        the change visible to `realtime_event`'s gate. Rebinding the key would
        update one copy and leave the gate reading another.
        """
        current = self.scope.setdefault("permissions", set())
        current.clear()
        current.update(fresh)
        self.permissions = current

    def _in_data_scope(self, tag) -> bool:
        """与 `data_scope.visible_q` 同一规则,只是不查库:不限、归属机构在集合里、或本人 / 指派。"""
        scopes = getattr(self, "data_scope", {})
        if tag.get("resource") not in scopes:
            return True  # 注册表外的资源照常放行
        ids = scopes[tag["resource"]]
        return (ids is None or tag.get("owner_org_id") in ids
                or getattr(self.user, "id", None) in (tag.get("owner_user_ids") or ()))

    @database_sync_to_async
    def _resolve_data_scope(self):
        """{resource: 机构 id 集合 | None(不限)},每项业务一份;连接时与每次权限刷新时算,帧来时只查这张表。
        重读这一行(角色、兼任、机构可能变了);账号没了或停用 = 每项业务都是空集。"""
        from apps.authentication.models import User
        from apps.perm.data_scope import REGISTRY, org_ids

        resources = {entry.resource for entry in REGISTRY.values()}
        fresh = User.objects.filter(pk=getattr(self.user, "pk", None), is_active=True).first()
        if fresh is None:
            return dict.fromkeys(resources, frozenset())
        cache = {}
        return {resource: org_ids(fresh, resource, cache) for resource in resources}

    @database_sync_to_async
    def _resolve_permissions(self):
        """Re-resolve the current user's permission codenames.

        Same function as the middleware's connect-time set --
        ``apps.core.ws_permissions.resolve_permissions_for`` -- so the two
        paths cannot disagree, and it re-reads the user row so a demotion
        after connect is seen.
        """
        from apps.core.ws_permissions import resolve_permissions_for

        return resolve_permissions_for(self.user)
