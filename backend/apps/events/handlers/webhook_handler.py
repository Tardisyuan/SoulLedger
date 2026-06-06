"""
WebhookHandler — delivers events to external webhook endpoints.

Reads webhook URLs from Tenant.webhook_configs.
Only handles events for tenants that have webhooks configured.
"""
import hashlib
import hmac
import json
import logging
import urllib.request
from apps.events.event_bus import DomainEventHandler, EventEnvelope

logger = logging.getLogger(__name__)


class WebhookHandler(DomainEventHandler):
    """
    Delivers events to external webhook endpoints via HTTP POST.

    Filters:
        - Requires ``tenant_code`` on the envelope
        - Skips tenants without webhook_configs

    Security:
        - HMAC-SHA256 signature in X-SoulLedger-Signature header
    """

    def should_handle(self, envelope: EventEnvelope) -> bool:
        return bool(envelope.tenant_code)

    def handle(self, envelope: EventEnvelope) -> None:
        try:
            self._deliver_to_tenant_webhooks(envelope)
        except Exception:
            logger.exception("WebhookHandler: delivery failed for %s", envelope.event_type)

    def _deliver_to_tenant_webhooks(self, envelope: EventEnvelope) -> None:
        """Find and deliver to all active webhooks for the tenant."""
        from apps.tenants.models import Tenant

        tenant = Tenant.objects.filter(code=envelope.tenant_code).first()
        if tenant is None:
            return

        webhooks = getattr(tenant, "webhook_configs", None)
        if webhooks is None:
            return

        payload_bytes = json.dumps(envelope.to_dict(), default=str).encode()

        for webhook in webhooks.filter(is_active=True):
            try:
                secret = getattr(webhook, "secret", "")
                sig = hmac.new(
                    secret.encode(), payload_bytes, hashlib.sha256
                ).hexdigest()

                req = urllib.request.Request(
                    webhook.url,
                    data=payload_bytes,
                    headers={
                        "Content-Type": "application/json",
                        "X-SoulLedger-Domain": envelope.domain,
                        "X-SoulLedger-Event": envelope.event_type,
                        "X-SoulLedger-Signature": f"sha256={sig}",
                    },
                    method="POST",
                )
                urllib.request.urlopen(req, timeout=10)
            except Exception:
                logger.debug("WebhookHandler: delivery to %s failed", getattr(webhook, "url", "?"))
