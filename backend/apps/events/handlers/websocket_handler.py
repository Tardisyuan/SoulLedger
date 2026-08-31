"""
WebSocketHandler — publishes events to Django Channels layer.

Replaces: RealtimeEventPublisher.publish() and its convenience methods.

Delivers to:
    - Tenant-wide broadcast (rt_tenant_{code})
    - Per-user targeted delivery (rt_user_{id})
"""
import logging

from django.db import transaction

from apps.events.event_bus import DomainEventHandler, EventEnvelope

logger = logging.getLogger(__name__)


class WebSocketHandler(DomainEventHandler):
    """
    Publishes events to the Django Channels layer for real-time delivery.

    This handler is domain-agnostic — it publishes any event that reaches it,
    regardless of domain. The channel layer handles the actual delivery.

    Note: Each user_id triggers a separate async_to_sync(group_send) call.
    For high fan-out scenarios (>100 users), consider batching via a
    dedicated async function with a real channel layer (not mocked).
    """

    def handle(self, envelope: EventEnvelope) -> None:
        try:
            from asgiref.sync import async_to_sync
            from channels.layers import get_channel_layer

            from apps.events.realtime import ChannelNaming

            channel_layer = get_channel_layer()
            if channel_layer is None:
                return

            message = {
                "type": "realtime_event",
                "data": {
                    "domain": envelope.domain,
                    "event": envelope.event_type,
                    **envelope.payload,
                },
            }

            if envelope.permission:
                message["data"]["_permission"] = envelope.permission

            groups = []
            # Tenant-wide delivery
            if envelope.tenant_code:
                groups.append(ChannelNaming.tenant_group(envelope.tenant_code))
            # Targeted user delivery
            if envelope.user_ids:
                groups.extend(ChannelNaming.user_group(uid) for uid in envelope.user_ids)

            def _publish():
                # The try/except lives HERE, not only around `handle`.
                #
                # With the delivery deferred to `on_commit`, the callback runs
                # from whatever code commits the transaction — outside this
                # method's own `try`. A channel-layer failure would then
                # propagate into the request that happened to commit, turning
                # "the realtime push did not go out" into a 500 on an
                # unrelated write. `handle` has always been documented to
                # swallow publish failures; this keeps that true.
                try:
                    for group_name in groups:
                        async_to_sync(channel_layer.group_send)(group_name, message)
                except Exception:
                    logger.debug(
                        "WebSocketHandler: publish failed for %s.%s",
                        envelope.domain,
                        envelope.event_type,
                    )

            # `on_commit`, not a bare call.
            #
            # These handlers run inside the publisher's transaction — measured
            # 2026-08-29: "WS push happens inside an uncommitted transaction?
            # **True**". The row the push announces is invisible to every other
            # database connection until that transaction commits, and the
            # connection serving the client's follow-up `GET /notifications/`
            # is a different one. So the client could be told about a row it
            # provably could not yet read.
            #
            # Outside a transaction `on_commit` runs the callback immediately,
            # so this is not a behaviour change for callers that publish
            # without one. If the transaction rolls back, the push is never
            # sent — which is correct: there is nothing to announce.
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
                transaction.on_commit(_publish)
            else:
                _publish()

        except Exception:
            logger.debug("WebSocketHandler: publish failed for %s.%s", envelope.domain, envelope.event_type)
