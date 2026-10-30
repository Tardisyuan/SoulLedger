"""
AuditHandler — writes SoulEvent audit log entries.

Replaces: EventService.log() and its convenience methods.

Only handles events that carry a soul_id in their payload.
"""
import logging

from apps.events.event_bus import DomainEventHandler, EventEnvelope

logger = logging.getLogger(__name__)


class SoulEventTargetError(LookupError):
    """The envelope names a soul this handler may not record: soft-deleted, unknown, or in a tenant that is neither
    the soul's current nor its home tenant. Raised, not skipped (2026-10-30): the event row is part of the
    business record, so a write that cannot record it rolls back with it."""


class AuditHandler(DomainEventHandler):
    """
    The SoulEvent row is part of the business record, so a failure to write it is NOT swallowed
    (`propagate_errors`): the exception reaches the caller of `EventService.log*`, the surrounding transaction
    rolls back, and the error is the failed insert itself rather than a later TransactionManagementError.

    Filters:
        - Requires ``soul_id`` in envelope.payload
        - Raises `SoulEventTargetError` if the soul is missing / soft-deleted, the tenant code is unknown, or the
          tenant is neither the soul's current nor its home tenant. Until 2026-10-30 these were a debug log and
          a silent return, so the business write committed without its event.
    """

    propagate_errors = True

    def should_handle(self, envelope: EventEnvelope) -> bool:
        return bool(envelope.payload.get("soul_id"))

    def handle(self, envelope: EventEnvelope) -> None:
        if not envelope.payload.get("soul_id"):
            return  # `should_handle` already says so; direct callers get the same answer instead of a KeyError

        from django.db.models import Q

        from apps.events.models import SoulEvent
        from apps.souls.models import Soul
        from apps.tenants.models import Tenant

        soul_id = envelope.payload["soul_id"]
        tenant = None
        if envelope.tenant_code:
            tenant = Tenant.objects.filter(code=envelope.tenant_code).first()
            if tenant is None:
                raise SoulEventTargetError(f"event {envelope.event_type}: unknown tenant {envelope.tenant_code!r}")

        # The soul lookup is scoped by the envelope's own tenant, not global: an envelope carrying tenant B's code
        # and tenant A's soul_id once produced a SoulEvent whose `tenant` said B while its `soul` pointed into A,
        # and every SoulEvent read path filters on `tenant`, so B could read A's soul. The event's tenant must be
        # the soul's current tenant or its home tenant (a residing soul's dispatch decisions are recorded in the
        # hall that sent it, `publish_soul_event(tenant=...)`).
        in_tenant = Q(tenant=tenant) | Q(home_tenant=tenant) if tenant is not None else Q(tenant__isnull=True)
        soul = Soul.objects.filter(in_tenant, id=soul_id).first()
        if soul is None:
            raise SoulEventTargetError(
                f"event {envelope.event_type}: soul {soul_id} is not a live soul of tenant {envelope.tenant_code}"
            )

        row = SoulEvent.objects.create(
            tenant=tenant,
            soul=soul,
            event_type=envelope.event_type,
            payload=envelope.payload,
            actor=envelope.actor,
        )
        envelope.event_id = str(row.pk)
