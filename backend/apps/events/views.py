"""
REST views for Events app (audit log).
"""
from rest_framework import viewsets

from apps.core.permissions import TenantPermission
from apps.core.viewsets import CodenameViewSetMixin, DataScopeViewSetMixin
from apps.events.models import SoulEvent
from apps.events.serializers import SoulEventSerializer


class SoulEventViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """A soul's own timeline. NOT the administrative audit log.

    The docstring here used to read "Read-only audit log", and that one line has
    now caused the same question to be raised twice: why can a VIEWER read this
    when `AuditLog` requires `audit.read` (ADMIN and MODERATOR only)?

    Because they are different things. `AuditLog` records who changed what, for
    review. `SoulEvent` records what happened to a soul, and it is what
    `SoulLifecycleTimeline` draws on the soul detail page — through
    `packages/core/src/api/events.ts` → `frontend/src/components/souls/
    SoulLifecycleTimeline.tsx`. VIEWER holds `soul.read`
    (`apps/perm/models.py:388-394`), so VIEWER can open that page; gating this
    endpoint behind a codename VIEWER does not hold would leave the page
    rendering with an empty timeline and no explanation.

    The payload is soul-domain facts (`{"soul_id": …, …}`,
    `apps/events/event_bus.py:209`) — the same facts the page already shows —
    not credentials or cross-tenant data. Tenant scoping still applies through
    `DataScopeViewSetMixin`.
    """
    permission_classes = [TenantPermission]
    # EXEMPT, and deliberately so — not a queued decision.
    #
    # The earlier note here said a seeded `event.read` was "queued rather than
    # invented". Re-examined 2026-09-07: there is nothing to queue. A codename
    # would have to be granted to every role that can open a soul page, which is
    # every role including VIEWER, and a permission held by everyone is a
    # permission that only adds a way to get it wrong. The previous "event"
    # declaration produced `event.read` held by nobody, which would have hidden
    # the timeline from ADMIN too.
    permission_codename = None
    queryset = SoulEvent.objects.select_related("soul", "tenant").all()
    serializer_class = SoulEventSerializer
    filterset_fields = ["soul", "event_type", "actor"]
    # `create_time`, not `created_at` — `SoulEvent` has no `created_at`.
    # DRF's OrderingFilter silently drops an unknown field, so
    # `?ordering=created_at` answered 200 and sorted by nothing: **a knob that
    # returns success and does nothing**. `occurred_at` is the domain time and
    # is worth offering beside the row's own.
    ordering_fields = ["create_time", "occurred_at", "event_type"]
