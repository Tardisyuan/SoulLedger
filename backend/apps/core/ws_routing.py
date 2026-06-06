"""
WebSocket URL patterns.

All WebSocket routes are prefixed with /ws/ and routed through the
JWT → Tenant → Permission middleware stack.
"""
from django.urls import re_path

from apps.notifications.consumers import NotificationConsumer

websocket_urlpatterns = [
    re_path(
        r"ws/notifications/$",
        NotificationConsumer.as_asgi(),
    ),
]
