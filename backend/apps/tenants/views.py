from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.models import AuditLog
from apps.audit.signals import explicit_audit_for
from apps.core.client_ip import get_client_ip
from apps.core.permissions import IsAdminPermission, TenantPermission
from apps.core.tenant import scope_to_tenant
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin
from apps.tenants.models import REBIRTH_COOLDOWN_SETTING, SELF_SERVICE_SETTING, VISIT_SETTINGS, Tenant
from apps.tenants.serializers import (
    HallOverviewSerializer,
    TenantCreateSerializer,
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
    for key in VISIT_SETTINGS:  # 没填 = None(存的是去空格后的值,空的不存键)
        snap[key] = (tenant.settings or {}).get(key)
    snap[SELF_SERVICE_SETTING] = (tenant.settings or {}).get(SELF_SERVICE_SETTING) is not False  # 缺省 = 开
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


class TenantViewSet(AuditUserViewSetMixin, CodenameViewSetMixin, mixins.CreateModelMixin, viewsets.ReadOnlyModelViewSet):
    """Tenant management API — read-only, except `seal-glyphs/` and `settings/` (ADMIN only), and
    (2026-10-25) create / `activate/` / `deactivate/` / `overview/` for the global role (ADMIN).
    A hall is never deleted: deactivating keeps every row and refuses new souls (`Soul.save`) and new death
    registrations (`DeathSyncService._process`). Non-ADMIN users see only their own tenant."""

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

    def get_permissions(self):
        if self.action == "create":
            return [TenantPermission(), IsAdminPermission()]
        return super().get_permissions()

    def get_serializer_class(self):
        return TenantCreateSerializer if self.action == "create" else TenantSerializer

    @extend_schema(request=TenantCreateSerializer, responses={201: TenantSerializer})
    def create(self, request, *args, **kwargs):
        """建殿(ADMIN)。审计一条 CREATE(由审计信号写)。"""
        serializer = TenantCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tenant = serializer.save()
        return Response(TenantSerializer(tenant).data, status=201)

    def _set_active(self, request, active):
        tenant = self.get_object()
        if tenant.is_active != active:
            with explicit_audit_for(tenant):
                tenant.is_active = active
                tenant.save(update_fields=["is_active"])
            AuditLog.objects.create(
                tenant=tenant, user=request.user, action="UPDATE", resource="tenant", resource_id=tenant.code,
                description=f"hall {'activated' if active else 'deactivated'} {tenant.code}",
                changes={"is_active": [not active, active]},
                ip_address=get_client_ip(request), user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
            )
        return Response(TenantSerializer(tenant).data)

    @extend_schema(request=None, responses={200: TenantSerializer})
    @action(detail=True, methods=["post"], permission_classes=[TenantPermission, IsAdminPermission])
    def deactivate(self, request, code=None):
        """停用殿(不删):数据保留,不再收新灵魂与死亡登记。已停用再停用不写。"""
        return self._set_active(request, False)

    @extend_schema(request=None, responses={200: TenantSerializer})
    @action(detail=True, methods=["post"], permission_classes=[TenantPermission, IsAdminPermission])
    def activate(self, request, code=None):
        """重新启用。"""
        return self._set_active(request, True)

    @extend_schema(responses={200: HallOverviewSerializer(many=True)})
    @action(detail=False, methods=["get"], permission_classes=[TenantPermission, IsAdminPermission])
    def overview(self, request):
        """跨殿总览(ADMIN):每个殿的待办、审判积压、本月转世配额、未结申诉。规则见 `apps/tenants/overview.py`。"""
        from apps.tenants.overview import overview

        return Response(overview(Tenant.objects.order_by("code")))

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

    @extend_schema(request=TenantSettingsSerializer, responses={200: TenantSerializer})
    @action(detail=True, methods=["patch"], url_path="settings",
            permission_classes=[TenantPermission, IsAdminPermission])
    def hall_settings(self, request, code=None):
        """殿的设置:说明、调拨开关、三语殿名、转生冷却天数、到殿办理三项、灵魂自己改邮箱的开关。只收已知字段,`settings` 里别的键不动。"""
        tenant = self.get_object()
        serializer = TenantSettingsSerializer(tenant, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        before = _snapshot(tenant)
        with explicit_audit_for(tenant):
            serializer.save()
        audit_hall_change(request, tenant, before, "hall settings")
        return Response(TenantSerializer(tenant).data)
