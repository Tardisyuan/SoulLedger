from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from apps.tenants.models import Tenant
from apps.tenants.serializers import TenantSerializer


class TenantViewSet(viewsets.ReadOnlyModelViewSet):
    """Tenant management API — read-only for all authenticated users, SYS_ADMIN gets full list."""

    serializer_class = TenantSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = "code"

    def get_queryset(self):
        return Tenant.objects.all().order_by("code")
