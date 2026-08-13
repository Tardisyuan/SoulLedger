from rest_framework import viewsets

from apps.core.permissions import TenantPermission
from apps.core.tenant import scope_to_tenant
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
        # field="pk": Tenant is the degenerate case — it has no `tenant` FK
        # because it *is* the tenant, so "scoped to your tenant" means the one
        # row. Same ADMIN bypass and same fail-closed rule as everywhere else;
        # see apps/core/tenant.py.
        return scope_to_tenant(
            Tenant.objects.all().order_by("code"), self.request, field="pk"
        )
