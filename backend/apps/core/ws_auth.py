"""
JWT Authentication middleware for WebSocket connections.

Extracts JWT from:
  1. Query parameter: ws://host/ws/notifications/?token=<jwt>
  2. First message: {"type": "auth", "token": "<jwt>"}

Sets scope["user"] to the authenticated User instance.
Rejects connection with 4001 if token is invalid/missing.
"""
import logging

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework_simplejwt.exceptions import TokenError, InvalidToken

logger = logging.getLogger(__name__)


class JWTAuthMiddleware(BaseMiddleware):
    """Authenticate WebSocket connections via JWT token."""

    async def __call__(self, scope, receive, send):
        # Try token from query string first
        token = self._extract_token_from_query(scope)

        if token:
            user = await self._authenticate_token(token)
            if user is None:
                await self._reject(send, code=4001, reason="Invalid token")
                return
            scope["user"] = user
            return await super().__call__(scope, receive, send)

        # No token in query — wrap receive to intercept first message for auth
        scope["user"] = AnonymousUser()
        return await self._intercept_auth(scope, receive, send)

    async def _intercept_auth(self, scope, receive, send):
        """Wait for first message containing auth token."""
        authenticated = False

        async def wrapped_receive():
            nonlocal authenticated
            message = await receive()

            if not authenticated and message.get("type") == "websocket.receive":
                import json
                try:
                    data = json.loads(message.get("text", "{}"))
                except (json.JSONDecodeError, TypeError):
                    data = {}

                if data.get("type") == "auth" and data.get("token"):
                    user = await self._authenticate_token(data["token"])
                    if user is None:
                        await self._reject(send, code=4001, reason="Invalid token")
                        return {"type": "websocket.close", "code": 4001}
                    scope["user"] = user
                    authenticated = True
                    # Send auth success confirmation
                    await send({
                        "type": "websocket.send",
                        "text": json.dumps({"type": "auth.success", "user_id": user.id}),
                    })
                    return await wrapped_receive()  # Get next real message

                # No auth token in first message
                await self._reject(send, code=4001, reason="Token required as first message")
                return {"type": "websocket.close", "code": 4001}

            return message

        return await super().__call__(scope, wrapped_receive, send)

    @staticmethod
    def _extract_token_from_query(scope):
        """Extract 'token' from WebSocket query string."""
        query_string = scope.get("query_string", b"").decode()
        if not query_string:
            return None
        for param in query_string.split("&"):
            if param.startswith("token="):
                return param.split("=", 1)[1]
        return None

    @database_sync_to_async
    def _authenticate_token(self, token_str):
        """Validate JWT and return User, or None."""
        try:
            token = AccessToken(token_str)
            user_id = token.get("user_id")
            if not user_id:
                return None
            from apps.authentication.models import User
            return User.objects.select_related("rbac_role", "tenant").get(id=user_id)
        except (TokenError, InvalidToken):
            logger.debug("JWTAuthMiddleware: invalid token")
            return None
        except Exception:
            logger.exception("JWTAuthMiddleware: unexpected error")
            return None

    @staticmethod
    async def _reject(send, code, reason):
        """Send close frame with error code."""
        import json
        await send({
            "type": "websocket.send",
            "text": json.dumps({"type": "error", "code": code, "message": reason}),
        })
        await send({"type": "websocket.close", "code": code})
