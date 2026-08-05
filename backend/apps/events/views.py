"""
REST views for Events app (audit log).
"""
from rest_framework import viewsets

from apps.core.permissions import TenantPermission
from apps.core.viewsets import CodenameViewSetMixin, DataScopeViewSetMixin
from apps.events.models import SoulEvent
from apps.events.serializers import SoulEventSerializer


class SoulEventViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """
    Read-only audit log.
    """
    permission_classes = [TenantPermission]
    # EXEMPT. No `event.*` codename exists in DEFAULT_PERMISSIONS or
    # ROLE_PERMISSIONS. The previous "event" declaration produced `event.read`,
    # held by nobody, so enforcement would have hidden the soul event log from
    # every role including ADMIN's own reviewers. Needs a seeded `event.read`
    # granted to the roles that should see the log — a decision, not a rename,
    # so it is queued rather than invented. Tenant scoping still applies via
    # DataScopeViewSetMixin.
    permission_codename = None
    queryset = SoulEvent.objects.select_related("soul", "tenant").all()
    serializer_class = SoulEventSerializer
    filterset_fields = ["soul", "event_type", "actor"]
    ordering_fields = ["created_at"]
