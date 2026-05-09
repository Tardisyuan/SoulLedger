"""
REST views for Judgment app.
"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from apps.judgment.models import Judgment
from apps.judgment.serializers import JudgmentSerializer, JudgmentConcludeSerializer
from apps.souls.models import SoulState
from apps.core.permissions import TenantPermission


class JudgmentViewSet(viewsets.ModelViewSet):
    """
    Judgment CRUD + conclude action.
    Tenant-isolated via TenantPermission.
    """
    permission_classes = [TenantPermission]
    queryset = Judgment.objects.select_related("soul", "soul__tenant", "tenant").all()
    serializer_class = JudgmentSerializer
    filterset_fields = ["soul", "civilization", "verdict", "is_final"]
    ordering_fields = ["created_at", "concluded_at"]

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
        """
        judgment = self.get_object()
        if judgment.is_final:
            return Response({"error": "Judgment already concluded"}, status=status.HTTP_400_BAD_REQUEST)

        serializer = JudgmentConcludeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        verdict = serializer.validated_data["verdict"]
        notes = serializer.validated_data.get("notes", "")

        judgment.conclude(verdict, notes)
        return Response(JudgmentSerializer(judgment).data)
