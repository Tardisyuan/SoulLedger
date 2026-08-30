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


def _reject_if_not_publicly_routable(url):
    """Raise unless `url` resolves somewhere off this machine's private nets.

    Delegates to the death_sync validator so there is one blocklist rather
    than two that drift. That validator's own gaps are fixed there.
    """
    from apps.death_sync.webhook_service import _validate_webhook_url

    _validate_webhook_url(url)


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
            # `WebhookConfig.events` is documented as "event types to subscribe
            # to" and was never read: an integration registered for
            # DEATH_SYNC_RECEIVED was handed every workflow, dispatch,
            # notification and social event of the tenant, soul ids and
            # verdicts included, to an endpoint URL the tenant supplied.
            # Measured 2026-08-29. An empty list keeps its plain meaning of
            # "everything".
            subscribed = getattr(webhook, "events", None)
            if subscribed and envelope.event_type not in subscribed:
                continue
            try:
                # `webhook.secret` does not exist -- the field is
                # `signing_secret`. `getattr(..., "")` turned that typo into an
                # empty HMAC key, silently. Measured: the signature this sent
                # was reproducible by anyone who could see the body, and a
                # receiver verifying against the real secret rejected 100% of
                # EventBus deliveries while accepting death-sync's (which signs
                # the same header name correctly) -- so the failure looked like
                # a transport problem. No default here: a renamed field must
                # raise, not degrade into no signature at all.
                secret = webhook.signing_secret
                if not secret:
                    logger.error(
                        "WebhookHandler: webhook %s has no signing secret; "
                        "refusing to send an unsigned delivery",
                        getattr(webhook, "id", "?"),
                    )
                    continue
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
                # Same SSRF surface as apps/death_sync/webhook_service.py:
                # `url` is an unrestricted URLField and urlopen will happily
                # reach 127.0.0.1 or 169.254.169.254. Validate before
                # connecting, and honour the per-webhook timeout the model
                # carries instead of a hardcoded one.
                _reject_if_not_publicly_routable(webhook.url)
                timeout = getattr(webhook, "timeout_seconds", None) or 10
                urllib.request.urlopen(req, timeout=timeout)
            except Exception:
                logger.debug("WebhookHandler: delivery to %s failed", getattr(webhook, "url", "?"))
