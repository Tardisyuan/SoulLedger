"""
REST views for Events app (audit log).
"""
from rest_framework import viewsets
from django_filters.rest_framework import DjangoFilterBackend
from apps.events.models import SoulEvent
from apps.events.serializers import SoulEventSerializer
from apps.core.permissions import TenantPermission
from apps.core.viewsets import CodenameViewSetMixin, DataScopeViewSetMixin


class SoulEventViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """
    Read-only audit log.
    """
    permission_classes = [TenantPermission]
    permission_codename = "event"
    queryset = SoulEvent.objects.all()
    serializer_class = SoulEventSerializer
    filterset_fields = ["soul", "event_type", "actor"]
    ordering_fields = ["created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not user.is_authenticated:
            return qs.none()
        if user.role == 'ADMIN':
            return qs
        tenant = getattr(self.request, 'tenant', None)
        if tenant:
            return qs.filter(tenant=tenant)
        return qs.none()
