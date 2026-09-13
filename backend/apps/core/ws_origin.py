"""Origin check for the WebSocket handshake, on the same policy as HTTP CORS (IS-10).

channels' `AllowedHostsOriginValidator` would refuse a handshake without an
`Origin` header and ignore `CORS_ALLOWED_ORIGINS`. Both would cut off normal
connections: non-browser clients send no Origin (and no web page can drive
them, so there is nothing cross-site to stop), and a frontend on its own
domain is exactly what the CORS list exists for.
"""
from channels.security.websocket import OriginValidator
from django.conf import settings


class CorsOriginValidator(OriginValidator):
    def __init__(self, application):
        super().__init__(application, allowed_origins=())

    def valid_origin(self, parsed_origin):
        if parsed_origin is None or settings.CORS_ALLOW_ALL_ORIGINS:
            return True
        # Read per handshake, not captured at import: settings are the source.
        patterns = [*settings.ALLOWED_HOSTS, *settings.CORS_ALLOWED_ORIGINS]
        return any(p == "*" or self.match_allowed_origin(parsed_origin, p) for p in patterns)
