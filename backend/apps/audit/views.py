"""
Audit views - AuditLog ViewSet with filtering support.
"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from apps.core.permissions import TenantPermission
from django_filters.rest_framework import DjangoFilterBackend

from .models import AuditLog, AuditAction
from .serializers import AuditLogSerializer, AuditLogDetailSerializer
from apps.core.viewsets import CodenameViewSetMixin


class AuditLogViewSet(CodenameViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """
    AuditLog ViewSet with filtering support.

    Supports filtering by:
    - user: User ID who performed the action
    - action: Action type (CREATE, UPDATE, DELETE, etc.)
    - resource: Resource type (soul, judgment, karma, etc.)
    - resource_id: Specific resource ID
    - start_date/end_date: Time range filter

    Example:
        GET /api/v1/audit-logs/?user=1&action=CREATE&resource=soul
        GET /api/v1/audit-logs/?start_date=2024-01-01&end_date=2024-12-31
    """
    permission_classes = [TenantPermission]
    permission_codename = "audit_log"
    extra_permissions = {
        'actions': ['audit_log.read'],
        'resources': ['audit_log.read'],
        'stats': ['audit_log.read'],
    }
    serializer_class = AuditLogSerializer
    filterset_fields = ["user", "action", "resource", "resource_id"]
    ordering_fields = ["timestamp", "action", "resource"]
    ordering = ["-timestamp"]

    def get_queryset(self):
        """Filter queryset based on user permissions and query params."""
        user = self.request.user

        # Non-admin users can only see their own tenant's logs
        qs = AuditLog.objects.select_related("user", "tenant").all()

        if getattr(user, 'role', None) != 'ADMIN':
            tenant = getattr(self.request, 'tenant', None)
            if tenant:
                qs = qs.filter(tenant=tenant)
            else:
                qs = qs.none()

        # Apply query param filters
        user_id = self.request.query_params.get('user_id')
        if user_id:
            qs = qs.filter(user_id=user_id)

        action_param = self.request.query_params.get('action')
        if action_param:
            qs = qs.filter(action=action_param.upper())

        resource = self.request.query_params.get('resource')
        if resource:
            qs = qs.filter(resource__icontains=resource)

        resource_id = self.request.query_params.get('resource_id')
        if resource_id:
            qs = qs.filter(resource_id=resource_id)

        start_date = self.request.query_params.get('start_date')
        if start_date:
            qs = qs.filter(timestamp__date__gte=start_date)

        end_date = self.request.query_params.get('end_date')
        if end_date:
            qs = qs.filter(timestamp__date__lte=end_date)

        return qs

    def get_serializer_class(self):
        if self.action == "retrieve":
            return AuditLogDetailSerializer
        return AuditLogSerializer

    @action(detail=False, methods=["get"])
    def actions(self, request):
        """
        GET /api/v1/audit-logs/actions/
        Returns all available action types.
        """
        return Response([
            {"value": choice[0], "label": choice[1]}
            for choice in AuditAction.choices
        ])

    @action(detail=False, methods=["get"])
    def resources(self, request):
        """
        GET /api/v1/audit-logs/resources/
        Returns all resource types that have audit logs (tenant-scoped).
        """
        qs = AuditLog.objects.all()
        if getattr(request.user, 'role', None) != 'ADMIN':
            tenant = getattr(request, 'tenant', None)
            if tenant:
                qs = qs.filter(tenant=tenant)
            else:
                return Response([])
        resources = (
            qs.values_list("resource", flat=True)
            .distinct()
            .order_by("resource")
        )
        return Response(list(resources))

    @action(detail=False, methods=["get"])
    def stats(self, request):
        """
        GET /api/v1/audit-logs/stats/
        Returns statistics about audit logs.
        Requires ADMIN role.
        """
        if getattr(request.user, 'role', None) != 'ADMIN':
            return Response(
                {"error": "Admin access required"},
                status=status.HTTP_403_FORBIDDEN
            )

        from django.db.models import Count

        # Filter by tenant for non-admin users
        qs = AuditLog.objects.all()
        if request.user.role != 'ADMIN':
            tenant = getattr(request, 'tenant', None)
            if tenant:
                qs = qs.filter(tenant=tenant)
            else:
                qs = qs.none()

        action_stats = (
            qs.values("action")
            .annotate(count=Count("id"))
            .order_by("-count")
        )

        resource_stats = (
            qs.values("resource")
            .annotate(count=Count("id"))
            .order_by("-count")[:20]
        )

        return Response({
            "action_distribution": list(action_stats),
            "top_resources": list(resource_stats),
            "total_logs": qs.count(),
        })

    @action(detail=False, methods=["get"], url_path="timeline")
    def timeline(self, request):
        """
        GET /api/v1/audit-logs/timeline/
        权限变更时间线 — 查询权限相关操作的审计日志。

        Query params:
            resource: 资源类型过滤 (Role, RolePermission, Menu, MenuButton, FieldPermission, RowLevelDataScope)
            action: 操作类型过滤 (CREATE, UPDATE, DELETE, PERMISSION_CHANGE)
            start_date: 开始日期 (YYYY-MM-DD)
            end_date: 结束日期 (YYYY-MM-DD)
            limit: 返回条数 (默认 50)
        """
        qs = AuditLog.objects.select_related("user").all()

        # Tenant filter
        if getattr(request.user, 'role', None) != 'ADMIN':
            tenant = getattr(request, 'tenant', None)
            if tenant:
                qs = qs.filter(tenant=tenant)
            else:
                return Response([])

        # Permission-related resource types
        permission_resources = [
            'Role', 'RolePermission', 'Menu', 'MenuButton',
            'FieldPermission', 'RowLevelDataScope', 'DataScope', 'Permission'
        ]

        resource_filter = request.query_params.get('resource')
        if resource_filter:
            qs = qs.filter(resource__icontains=resource_filter)
        else:
            # Default: only permission-related resources
            qs = qs.filter(resource__in=permission_resources)

        action_filter = request.query_params.get('action')
        if action_filter:
            qs = qs.filter(action=action_filter.upper())

        start_date = request.query_params.get('start_date')
        if start_date:
            qs = qs.filter(timestamp__date__gte=start_date)

        end_date = request.query_params.get('end_date')
        if end_date:
            qs = qs.filter(timestamp__date__lte=end_date)

        limit = int(request.query_params.get('limit', 50))
        qs = qs.order_by('-timestamp')[:limit]

        serializer = AuditLogSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="trace/(?P<trace_id>[^/.]+)")
    def by_trace(self, request, trace_id=None):
        """
        GET /api/v1/audit-logs/trace/{trace_id}/
        按 trace_id 查询关联操作 — 查看同一请求内的所有变更。
        """
        qs = AuditLog.objects.select_related("user").filter(trace_id=trace_id)

        # Tenant filter
        if getattr(request.user, 'role', None) != 'ADMIN':
            tenant = getattr(request, 'tenant', None)
            if tenant:
                qs = qs.filter(tenant=tenant)
            else:
                return Response([])

        qs = qs.order_by('timestamp')
        serializer = AuditLogSerializer(qs, many=True)
        return Response(serializer.data)
