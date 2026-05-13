"""
Audit views - AuditLog ViewSet with filtering support.
"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend

from .models import AuditLog, AuditAction
from .serializers import AuditLogSerializer, AuditLogDetailSerializer


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
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
    permission_classes = [IsAuthenticated]
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
                qs = qs.filter(user=user)

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
        Returns all resource types that have audit logs.
        """
        resources = (
            AuditLog.objects
            .values_list("resource", flat=True)
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

        action_stats = (
            AuditLog.objects
            .values("action")
            .annotate(count=Count("id"))
            .order_by("-count")
        )

        resource_stats = (
            AuditLog.objects
            .values("resource")
            .annotate(count=Count("id"))
            .order_by("-count")[:20]
        )

        return Response({
            "action_distribution": list(action_stats),
            "top_resources": list(resource_stats),
            "total_logs": AuditLog.objects.count(),
        })
