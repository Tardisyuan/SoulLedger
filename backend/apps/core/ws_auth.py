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
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import AccessToken

logger = logging.getLogger(__name__)


class JWTAuthMiddleware(BaseMiddleware):
    """Authenticate WebSocket connections via JWT token."""

    async def __call__(self, scope, receive, send):
        # Try token from query string first
        token = self._extract_token_from_query(scope)

        if token:
            user, reason = await self._authenticate_and_check_tenant(token)
            if user is None:
                await self._reject(send, code=4001, reason=reason)
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
                    user, reason = await self._authenticate_and_check_tenant(
                        data["token"]
                    )
                    if user is None:
                        await self._reject(send, code=4001, reason=reason)
                        return {"type": "websocket.close", "code": 4001}
                    scope["user"] = user
                    authenticated = True
                    # FORWARD the auth message; do not swallow it.
                    #
                    # This used to `return await wrapped_receive()` -- eat the
                    # frame and wait for the next real one -- after sending its
                    # own `auth.success`. The consumer's auth handler
                    # (`apps/notifications/consumers.py`) therefore **never
                    # ran**, and that handler is what calls `_join_groups()`.
                    # Measured over the real ASGI stack:
                    #
                    #     [D1] connect with no token: True
                    #     [D2] frame1 = {'type':'auth.success','user_id':2}
                    #          frame2 = NOTHING (TimeoutError)
                    #
                    # Only the middleware's frame arrived. No `connected` frame,
                    # so no groups were joined: the socket belonged to nothing
                    # and received no events for the rest of its life, while
                    # `self.user` on the consumer stayed AnonymousUser and every
                    # later message was answered "not authenticated".
                    #
                    # Two blocks of a 219-line consumer that looked like they
                    # were working. The front end only uses the `?token=` query
                    # string, which is why nothing surfaced.
                    #
                    # The middleware's `auth.success` is gone with it: the
                    # consumer answers `connected` once it has actually joined
                    # the groups, and two confirmations for one event is how a
                    # client ends up trusting the earlier, weaker one.
                    return message

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
    def _authenticate_and_check_tenant(self, token_str):
        """认证,并把 token 断言的租户与用户自己的外键对一遍。

        返回 `(user, reject_reason)`;`user` 为 None 时 `reject_reason` 说明原因。

        WHY。HTTP 从 token 的 `tenant_code` claim 解析租户(`TenantMiddleware`),
        WebSocket 从 `user.tenant` 外键解析。**两者可以不一致** —— 2026-08-29 实测:
        同一个 token 让 `request.tenant = ZZB`,而 socket 加入了 `rt:tenant:ZZA`。

        不是泄漏:外键是更严的一边,token 断言不了它,所以 WS 加入的组永远是用户
        真正属于的那个。**但「两条路径对同一个问题给出不同答案」本身是一个事实,
        而在此之前它不会让任何东西报错** —— 它只会让两个传输层各自安静地正确,
        而没有人知道它们不一致。

        用户 2026-09-01 的决定:**不统一两条路径,但不一致时拒绝连接**。
        拒绝而不是纠正:一个断言了错租户的 token 是一个需要有人去看的事实,
        而静默地用外键覆盖它会把这个事实变回不可见。

        claim 缺失不算冲突 —— 不是每个 token 都带它(见 `TenantMiddleware` 自己的
        回落),而缺失与不一致是两件事。
        """
        user = self._authenticate_token_sync(token_str)
        if user is None:
            return None, "Invalid token"

        try:
            claimed = AccessToken(token_str).get("tenant_code")
        except (TokenError, InvalidToken):
            return None, "Invalid token"

        if not claimed:
            return user, None

        actual = user.tenant.code if user.tenant_id else None
        if actual != claimed:
            logger.warning(
                "JWTAuthMiddleware: token claims tenant %r, user %s belongs to %r "
                "— refusing the socket",
                claimed, user.pk, actual,
            )
            return None, "Token tenant does not match the user's tenant"
        return user, None

    def _authenticate_token_sync(self, token_str):
        """Validate JWT and return User, or None."""
        try:
            token = AccessToken(token_str)
            user_id = token.get("user_id")
            if not user_id:
                return None
            from apps.authentication.models import User
            user = User.objects.select_related("rbac_role", "tenant").get(id=user_id)
            # HTTP enforces this and WebSocket did not.
            # `rest_framework_simplejwt`'s own authentication checks
            # CHECK_USER_IS_ACTIVE (on by default); this method did a bare
            # `.get(id=...)`. Measured 2026-08-29: a deactivated user got 401
            # over HTTP and authenticated fine over WS. So
            # `POST /users/{id}/deactivate/` revoked REST immediately and left
            # the event feed -- notifications, dispatch, judgment, workflow --
            # running for the rest of the access token's life, and an
            # already-open socket running indefinitely.
            if not user.is_active:
                logger.debug(
                    "JWTAuthMiddleware: user %s is deactivated", user_id
                )
                return None
            return user
        except (TokenError, InvalidToken):
            logger.debug("JWTAuthMiddleware: invalid token")
            return None
        except Exception:
            logger.exception("JWTAuthMiddleware: unexpected error")
            return None

    @database_sync_to_async
    def _authenticate_token(self, token_str):
        """认证,不看租户 —— 保留给既有调用方与测试。

        新代码用 `_authenticate_and_check_tenant`:它多做一件事,而那件事
        (claim 与外键对不上就拒绝)是一个策略,不该藏在一个名字里没说的地方。
        """
        return self._authenticate_token_sync(token_str)

    @staticmethod
    async def _reject(send, code, reason):
        """Send close frame with error code."""
        import json
        await send({
            "type": "websocket.send",
            "text": json.dumps({"type": "error", "code": code, "message": reason}),
        })
        await send({"type": "websocket.close", "code": code})
