"""
ASGI config for SoulLedger project.

Routes HTTP through Django and WebSocket through the channels middleware stack:
    JWTAuthMiddleware -> TenantMiddleware -> PermissionMiddleware -> NotificationConsumer
"""
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# Initialize Django before importing channel layers
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from apps.core.ws_auth import JWTAuthMiddleware
from apps.core.ws_tenant import TenantMiddleware
from apps.core.ws_permissions import PermissionMiddleware
from apps.core.ws_routing import websocket_urlpatterns


def _build_ws_middleware_chain():
    """
    Build the WebSocket middleware stack:
        NotificationConsumer
        <- PermissionMiddleware
        <- TenantMiddleware
        <- JWTAuthMiddleware
    """
    return (
        JWTAuthMiddleware(
            TenantMiddleware(
                PermissionMiddleware(
                    URLRouter(websocket_urlpatterns)
                )
            )
        )
    )


application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": _build_ws_middleware_chain(),
})
