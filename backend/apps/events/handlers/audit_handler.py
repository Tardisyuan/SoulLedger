"""
AuditHandler — writes SoulEvent audit log entries.

Replaces: EventService.log() and its convenience methods.

Only handles events that carry a soul_id in their payload.
"""
import logging

from apps.events.event_bus import DomainEventHandler, EventEnvelope

logger = logging.getLogger(__name__)


class AuditHandler(DomainEventHandler):
    """
    Writes SoulEvent audit log entries for soul-domain events.

    Filters:
        - Requires ``soul_id`` in envelope.payload
        - Skips silently if soul or tenant not found
    """

    def should_handle(self, envelope: EventEnvelope) -> bool:
        return bool(envelope.payload.get("soul_id"))

    def handle(self, envelope: EventEnvelope) -> None:
        try:
            from apps.events.models import SoulEvent
            from apps.souls.models import Soul
            from apps.tenants.models import Tenant

            soul = Soul.objects.filter(id=envelope.payload["soul_id"]).first()
            if soul is None:
                logger.debug("AuditHandler: soul %s not found, skipping", envelope.payload["soul_id"])
                return

            tenant = None
            if envelope.tenant_code:
                tenant = Tenant.objects.filter(code=envelope.tenant_code).first()

            SoulEvent.objects.create(
                tenant=tenant,
                soul=soul,
                event_type=envelope.event_type,
                payload=envelope.payload,
                actor=envelope.actor,
            )
        except Exception:
            logger.exception("AuditHandler: failed to write audit event %s", envelope.event_type)
