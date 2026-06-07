"""
REST views for Organization app.
"""
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.mixins import TenantQuerySetMixin
from apps.core.permissions import TenantPermission
from apps.core.viewsets import AuditUserViewSetMixin
from apps.org.models import Organization
from apps.org.serializers import OrganizationSerializer


class OrganizationViewSet(TenantQuerySetMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    Organization CRUD.
    Tenant-isolated via TenantPermission.
    """
    permission_classes = [TenantPermission]
    queryset = Organization.objects.all()
    serializer_class = OrganizationSerializer

    @action(detail=False, methods=["get"])
    def tree(self, request):
        """Return organization hierarchy as a tree."""
        tenant = getattr(request, "tenant", None)
        orgs = Organization.objects.filter(tenant=tenant) if tenant else Organization.objects.all()
        # Build tree structure
        roots = orgs.filter(parent__isnull=True)
        return Response(OrganizationSerializer(roots, many=True).data)
