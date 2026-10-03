from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import IsAdminPermission, TenantPermission
from apps.core.tenant import scope_to_tenant
from apps.core.viewsets import CodenameViewSetMixin
from apps.tenants.models import Tenant
from apps.tenants.serializers import TenantSealGlyphsSerializer, TenantSerializer, TenantSettingsSerializer


class TenantViewSet(CodenameViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """Tenant management API — read-only, except `seal-glyphs/` and `settings/` (ADMIN only).
    Non-ADMIN users see only their own tenant."""

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

    @extend_schema(request=TenantSealGlyphsSerializer, responses={200: TenantSerializer})
    @action(detail=True, methods=["patch"], url_path="seal-glyphs",
            permission_classes=[TenantPermission, IsAdminPermission])
    def seal_glyphs(self, request, code=None):
        """匾上的印字。只收这一个字段,其余租户字段仍然只读。"""
        tenant = self.get_object()
        serializer = TenantSealGlyphsSerializer(tenant, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(TenantSerializer(tenant).data)

    @extend_schema(request=TenantSettingsSerializer, responses={200: TenantSerializer})
    @action(detail=True, methods=["patch"], url_path="settings",
            permission_classes=[TenantPermission, IsAdminPermission])
    def hall_settings(self, request, code=None):
        """殿的设置:说明、调拨开关、三语殿名、转生冷却天数。只收已知字段,`settings` 里别的键不动。"""
        tenant = self.get_object()
        serializer = TenantSettingsSerializer(tenant, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(TenantSerializer(tenant).data)
