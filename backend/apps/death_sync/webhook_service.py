"""Old home of the outbound SSRF guard — now `apps/core/outbound.py`.

Kept as a re-export: `apps/events` still imports these names from here.
"""
from apps.core.outbound import public_only_session, require_public_ip, validate_webhook_url

_validate_webhook_url = validate_webhook_url
_require_public_ip = require_public_ip

__all__ = ["_require_public_ip", "_validate_webhook_url", "public_only_session"]
