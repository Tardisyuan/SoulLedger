"""
REST views for Judgment app.
"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters import rest_framework as filters
from apps.judgment.models import Judgment
from apps.judgment.serializers import JudgmentSerializer, JudgmentConcludeSerializer
from apps.souls.models import SoulState
from apps.core.permissions import TenantPermission
from apps.core.mixins import TenantQuerySetMixin, TenantCreateMixin
from apps.core.viewsets import AuditUserViewSetMixin


class JudgmentFilter(filters.FilterSet):
    """Custom filter for Judgment - handles verdict=null for pending judgments."""
    has_verdict = filters.BooleanFilter(field_name="verdict", lookup_expr="isnull", exclude=True)
    verdict_null = filters.BooleanFilter(field_name="verdict", lookup_expr="isnull")

    class Meta:
        model = Judgment
        fields = ["soul", "civilization", "verdict", "is_final"]


class JudgmentViewSet(TenantQuerySetMixin, TenantCreateMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    Judgment CRUD + conclude action.
    Tenant-isolated via TenantPermission.
    """
    permission_classes = [TenantPermission]
    queryset = Judgment.objects.select_related("soul", "soul__tenant", "tenant").all()
    serializer_class = JudgmentSerializer
    filterset_class = JudgmentFilter
    ordering_fields = ["created_at", "concluded_at"]

    def perform_create(self, serializer):
        judgment = serializer.save()
        soul = judgment.soul
        if soul.current_state == SoulState.ALIVE:
            soul.transition_to(SoulState.JUDGING, f"Judgment {judgment.id} initiated")

    @action(detail=True, methods=["post"])
    def conclude(self, request, pk=None):
        """
        Conclude a judgment with a verdict.
        Calls Judgment.conclude() which creates disposition and transitions soul to DISPOSED.
        Optionally creates an ApprovalWorkflow if create_workflow=true.
        """
        judgment = self.get_object()
        if judgment.is_final:
            return Response({"error": "Judgment already concluded"}, status=status.HTTP_400_BAD_REQUEST)

        serializer = JudgmentConcludeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        verdict = serializer.validated_data["verdict"]
        notes = serializer.validated_data.get("notes", "")
        create_workflow = serializer.validated_data.get("create_workflow", False)

        judgment.conclude(verdict, notes, create_workflow=create_workflow)
        return Response(JudgmentSerializer(judgment).data)
