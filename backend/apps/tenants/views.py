from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.models import AuditLog
from apps.audit.signals import explicit_audit_for
from apps.core.client_ip import get_client_ip
from apps.core.permissions import IsAdminPermission, TenantPermission
from apps.core.tenant import scope_to_tenant
from apps.core.viewsets import CodenameViewSetMixin
from apps.tenants.models import REBIRTH_COOLDOWN_SETTING, Tenant
from apps.tenants.serializers import (
    TenantMfaRoleRowSerializer,
    TenantSealGlyphsSerializer,
    TenantSerializer,
    TenantSettingsSerializer,
)

#: 管理员改殿时审计逐字段记 [旧, 新] 的模型字段;`soul_rebirth_cooldown_days` 与 `seal_glyphs` 在 `_snapshot` 里另取。
_AUDITED_FIELDS = ("description", "dispatch_enabled", "hall_name", "hall_name_en", "hall_name_egy")


def _snapshot(tenant):
    snap = {f: getattr(tenant, f) for f in _AUDITED_FIELDS}
    snap["soul_rebirth_cooldown_days"] = (tenant.settings or {}).get(REBIRTH_COOLDOWN_SETTING)
    snap["seal_glyphs"] = list(tenant.seal_glyphs or [])
    return snap


def audit_hall_change(request, tenant, before, what):
    """管理员改了殿的设置或印字:谁、何时、哪个殿、每个变了的字段 `[旧, 新]`。一个字段都没变就不写。

    与 `soul_assist/config.py::audit`(助手开关)同一形状,但 `tenant` 记被改的殿而不是 None。
    调用方在 `explicit_audit_for(tenant)` 里保存,`apps/audit/signals.py` 因此不再另写一条泛化的 UPDATE 行
    (整份 `settings` 的 str):每次编辑恰好一行,就是这一条。
    """
    after = _snapshot(tenant)
    changes = {k: [before[k], after[k]] for k in before if before[k] != after[k]}
    if not changes:
        return None
    return AuditLog.objects.create(
        tenant=tenant, user=request.user, action="UPDATE", resource="tenant", resource_id=tenant.code,
        description=f"{what} {tenant.code}"[:500], changes=changes,
        ip_address=get_client_ip(request), user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
    )


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
        before = _snapshot(tenant)
        with explicit_audit_for(tenant):
            serializer.save()
        audit_hall_change(request, tenant, before, "hall seal glyphs")
        return Response(TenantSerializer(tenant).data)

    @extend_schema(request=TenantSettingsSerializer, responses={200: TenantSerializer})
    @extend_schema(responses={200: TenantMfaRoleRowSerializer(many=True)})
    @action(detail=True, methods=["get"], url_path="mfa-roles",
            permission_classes=[TenantPermission, IsAdminPermission])
    def mfa_roles(self, request, code=None):
        """殿设置 › 安全(A12):每个可持有的角色一行 —— 要不要求、本殿几人持有、几人已开启。"""
        from django.db.models import Count, Q

        from apps.authentication.mfa import MFA_REQUIRED_ROLES_SETTING
        from apps.authentication.models import User, UserRole
        from apps.perm.models import Role

        tenant = self.get_object()
        required = set((tenant.settings or {}).get(MFA_REQUIRED_ROLES_SETTING) or [])
        counts = {
            row["role"]: row for row in User.objects.filter(tenant=tenant).exclude(role=UserRole.SOUL)
            .values("role").annotate(total=Count("id"), enabled=Count("id", filter=Q(mfa__confirmed_at__isnull=False)))
        }
        names = [r for r in UserRole.values if r != UserRole.SOUL]
        names += list(Role.objects.exclude(name__in=names).order_by("name").values_list("name", flat=True))
        rows = [{
            "role": name,
            "required": name == UserRole.ADMIN or name in required,
            "always": name == UserRole.ADMIN,
            "total": counts.get(name, {}).get("total", 0),
            "enabled": counts.get(name, {}).get("enabled", 0),
        } for name in names]
        return Response(rows)

    @action(detail=True, methods=["patch"], url_path="settings",
            permission_classes=[TenantPermission, IsAdminPermission])
    def hall_settings(self, request, code=None):
        """殿的设置:说明、调拨开关、三语殿名、转生冷却天数。只收已知字段,`settings` 里别的键不动。"""
        tenant = self.get_object()
        serializer = TenantSettingsSerializer(tenant, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        before = _snapshot(tenant)
        with explicit_audit_for(tenant):
            serializer.save()
        audit_hall_change(request, tenant, before, "hall settings")
        return Response(TenantSerializer(tenant).data)
