from rest_framework import viewsets

from apps.core.permissions import TenantPermission
from apps.core.viewsets import CodenameViewSetMixin
from apps.tenants.models import Tenant
from apps.tenants.serializers import TenantSerializer


class TenantViewSet(CodenameViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """Tenant management API — read-only. Non-ADMIN users see only their own tenant."""

    serializer_class = TenantSerializer
    permission_classes = [TenantPermission]
    # EXEMPT. There is no `tenant.*` codename anywhere — not in
    # DEFAULT_PERMISSIONS, not in ROLE_PERMISSIONS, not seeded by any
    # migration. This used to declare "tenant", which generated `tenant.read`,
    # a codename no role holds; enforcing it would lock every non-ADMIN out of
    # their own tenant. Inventing one here would need a seeding migration plus
    # a grant to all five roles, so that decision is deferred rather than
    # guessed. Access is not ungoverned in the meantime: get_queryset() below
    # already scopes non-ADMIN callers to their own tenant, which is the
    # isolation that actually matters here.
    permission_codename = None
    lookup_field = "code"

    def get_queryset(self):
        user = self.request.user
        if getattr(user, 'role', None) == 'ADMIN':
            return Tenant.objects.all().order_by("code")
        tenant = getattr(self.request, 'tenant', None)
        if tenant:
            return Tenant.objects.filter(pk=tenant.pk)
        return Tenant.objects.none()
