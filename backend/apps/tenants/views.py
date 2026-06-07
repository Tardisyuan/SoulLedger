from rest_framework import viewsets

from apps.core.permissions import TenantPermission
from apps.core.viewsets import CodenameViewSetMixin
from apps.tenants.models import Tenant
from apps.tenants.serializers import TenantSerializer


class TenantViewSet(CodenameViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """Tenant management API — read-only. Non-ADMIN users see only their own tenant."""

    serializer_class = TenantSerializer
    permission_classes = [TenantPermission]
    permission_codename = "tenant"
    lookup_field = "code"

    def get_queryset(self):
        user = self.request.user
        if getattr(user, 'role', None) == 'ADMIN':
            return Tenant.objects.all().order_by("code")
        tenant = getattr(self.request, 'tenant', None)
        if tenant:
            return Tenant.objects.filter(pk=tenant.pk)
        return Tenant.objects.none()
