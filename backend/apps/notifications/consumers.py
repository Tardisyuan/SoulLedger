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
        for group_attr in ("user_group", "tenant_group"):
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
            self.permissions = await self._resolve_permissions()

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
            self.permissions = await self._resolve_permissions()
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
        if required_permission and required_permission not in self.permissions:
            return  # user lacks the required permission — drop silently

        await self.send(text_data=json.dumps(data))

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
        """Validate JWT and return User, or None."""
        from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
        from rest_framework_simplejwt.tokens import AccessToken

        try:
            token = AccessToken(token_str)
            user_id = token.get("user_id")
            if not user_id:
                return None
            from apps.authentication.models import User
            return User.objects.select_related("rbac_role", "tenant").get(id=user_id)
        except (TokenError, InvalidToken):
            return None
        except Exception:
            logger.exception("NotificationConsumer: error authenticating token")
            return None

    @database_sync_to_async
    def _resolve_permissions(self):
        """Re-resolve RBAC permissions for the current user."""
        user = self.user
        if not user or not getattr(user, "is_authenticated", False):
            return set()

        if hasattr(user, "role") and user.role == "ADMIN":
            from apps.perm.models import DEFAULT_PERMISSIONS
            return {codename for codename, _, _ in DEFAULT_PERMISSIONS}

        rbac_role = getattr(user, "rbac_role", None)
        if not rbac_role:
            return set()

        try:
            return rbac_role.get_inherited_permissions()
        except Exception:
            logger.exception("NotificationConsumer: error resolving permissions")
            return set()
