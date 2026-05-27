"""
REST views for Disposition app.
"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from apps.disposition.models import Disposition
from apps.disposition.serializers import DispositionSerializer, DispositionExecuteSerializer
from apps.disposition.services import DispositionService
from apps.core.permissions import TenantPermission
from apps.core.viewsets import AuditUserViewSetMixin


class DispositionViewSet(AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    Disposition CRUD + execute action.
    Tenant-isolated via TenantPermission.
    """
    permission_classes = [TenantPermission]
    queryset = Disposition.objects.select_related(
        "soul", "soul__tenant", "destination_realm", "tenant"
    ).all()
    serializer_class = DispositionSerializer
    filterset_fields = ["soul", "is_executed", "is_eternal", "memory_reset"]
    ordering_fields = ["created_at", "executed_at"]
    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not user.is_authenticated:
            return qs.none()
        if user.role == "ADMIN":
            return qs
        tenant = getattr(self.request, "tenant", None)
        if tenant:
            return qs.filter(tenant=tenant)
        return qs.none()

    @action(detail=True, methods=["post"])
    def execute(self, request, pk=None):
        """
        Execute a disposition: mark executed, transition soul to REINCARNATING.
        POST /disposition/{id}/execute/
        """
        disposition = self.get_object()
        if disposition.is_executed:
            return Response({"error": "Already executed"}, status=status.HTTP_400_BAD_REQUEST)

        serializer = DispositionExecuteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        DispositionService.execute(disposition)

        # Also trigger ReincarnationService.execute
        from apps.reincarnation.services import ReincarnationService
        ReincarnationService.execute(disposition)

        return Response(DispositionSerializer(disposition).data)
