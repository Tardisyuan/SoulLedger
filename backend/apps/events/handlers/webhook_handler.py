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

from django.db import transaction

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
        """Deliver after the publisher's transaction commits.

        WHAT THIS FIXES. These handlers are dispatched synchronously from
        inside the publisher's transaction — `Soul.save()` publishes
        SOUL_CREATED immediately after `super().save()`, and this handler then
        ran `urllib.request.urlopen(..., timeout=10)` **once per active
        webhook, inside that transaction**. Two consequences, and the second
        is the serious one:

        * a receiver that calls back into this API sees a database that does
          not have the row the event announces — the transaction has not
          committed, and the callback is served by a different connection;
        * an open transaction holds its connection and its row locks for as
          long as the remote host takes to answer. A slow or hanging endpoint
          the *tenant* configured therefore holds this system's locks. Ten
          seconds each, serially.

        `on_commit` moves the whole thing past the commit. Outside a
        transaction it runs immediately, so callers that publish without one
        are unaffected.

        WHAT THIS DOES NOT FIX. Delivery is still synchronous **on the request
        thread** — after the commit, but before the response. Moving it to a
        worker needs a task and a delivery log (death_sync has both:
        `death_sync.deliver_webhook`), and doing that here without them would
        drop failures on the floor instead of retrying them. Stated rather
        than left as an omission that looks the same as a decision.
        """

        def _deliver():
            try:
                self._deliver_to_tenant_webhooks(envelope)
            except Exception:
                logger.exception(
                    "WebhookHandler: delivery failed for %s", envelope.event_type
                )

        # `on_commit` only when there *is* a transaction to commit.
        #
        # `transaction.on_commit` needs a live connection, and a bare
        # `on_commit` broke ten existing tests that publish with no
        # database at all — silently, because this method swallows its
        # exceptions. Outside a transaction `on_commit` runs the
        # callback immediately anyway, so this is the same semantics
        # without requiring a connection to say so. `in_atomic_block`
        # is a plain attribute — no query, so it works under
        # pytest-django's DB blocker.
        if transaction.get_connection().in_atomic_block:
            transaction.on_commit(_deliver)
        else:
            _deliver()

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
