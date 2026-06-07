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
    permission_codename = "event"
    queryset = SoulEvent.objects.select_related("soul", "tenant").all()
    serializer_class = SoulEventSerializer
    filterset_fields = ["soul", "event_type", "actor"]
    ordering_fields = ["created_at"]
