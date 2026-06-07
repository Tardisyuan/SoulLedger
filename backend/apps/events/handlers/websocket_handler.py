"""
WebSocketHandler — publishes events to Django Channels layer.

Replaces: RealtimeEventPublisher.publish() and its convenience methods.

Delivers to:
    - Tenant-wide broadcast (rt_tenant_{code})
    - Per-user targeted delivery (rt_user_{id})
"""
import logging

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

            # Tenant-wide delivery
            if envelope.tenant_code:
                group_name = ChannelNaming.tenant_group(envelope.tenant_code)
                async_to_sync(channel_layer.group_send)(group_name, message)

            # Targeted user delivery
            if envelope.user_ids:
                for uid in envelope.user_ids:
                    group_name = ChannelNaming.user_group(uid)
                    async_to_sync(channel_layer.group_send)(group_name, message)

        except Exception:
            logger.debug("WebSocketHandler: publish failed for %s.%s", envelope.domain, envelope.event_type)
