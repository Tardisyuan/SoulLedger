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

            tenant = None
            if envelope.tenant_code:
                tenant = Tenant.objects.filter(code=envelope.tenant_code).first()

            # The soul lookup is scoped by the envelope's own tenant, not
            # global. Unscoped, this method resolved the soul from the whole
            # table and then stamped the SoulEvent with whatever tenant
            # `envelope.tenant_code` named — so an envelope carrying tenant B's
            # code and tenant A's soul_id produced a SoulEvent whose `tenant`
            # said B while its `soul` FK pointed into A. Every read path
            # downstream (SoulEventViewSet via DataScopeViewSetMixin, the
            # timeline endpoints) filters SoulEvent by `tenant`, so that row
            # was visible to B and leaked A's soul through the serialized
            # `soul` relation. The event and the soul it describes must agree
            # on their tenant.
            soul = Soul.objects.filter(
                id=envelope.payload["soul_id"], tenant=tenant
            ).first()
            if soul is None:
                logger.debug(
                    "AuditHandler: soul %s not found in tenant %s, skipping",
                    envelope.payload["soul_id"],
                    envelope.tenant_code,
                )
                return

            SoulEvent.objects.create(
                tenant=tenant,
                soul=soul,
                event_type=envelope.event_type,
                payload=envelope.payload,
                actor=envelope.actor,
            )
        except Exception:
            logger.exception("AuditHandler: failed to write audit event %s", envelope.event_type)
