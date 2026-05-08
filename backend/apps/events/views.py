"""
REST views for Events app (audit log).
"""
from rest_framework import viewsets
from django_filters.rest_framework import DjangoFilterBackend
from apps.events.models import SoulEvent
from apps.events.serializers import SoulEventSerializer


class SoulEventViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read-only audit log.
    """
    queryset = SoulEvent.objects.all()
    serializer_class = SoulEventSerializer
    filterset_fields = ["soul", "event_type", "actor"]
    ordering_fields = ["created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.user.role == 'ADMIN':
            return qs
        tenant = getattr(self.request, 'tenant', None)
        if tenant:
            return qs.filter(tenant=tenant)
        return qs.none()
