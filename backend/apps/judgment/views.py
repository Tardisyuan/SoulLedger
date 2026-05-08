"""
REST views for Judgment app.
"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from apps.judgment.models import Judgment
from apps.judgment.serializers import JudgmentSerializer, JudgmentConcludeSerializer
from apps.souls.models import SoulState


class JudgmentViewSet(viewsets.ModelViewSet):
    queryset = Judgment.objects.all()
    serializer_class = JudgmentSerializer
    filterset_fields = ["soul", "civilization", "verdict", "is_final"]
    ordering_fields = ["created_at", "concluded_at"]

    def perform_create(self, serializer):
        judgment = serializer.save()
        # Transition soul to JUDGING state
        soul = judgment.soul
        if soul.current_state == SoulState.ALIVE:
            soul.transition_to(SoulState.JUDGING, f"Judgment {judgment.id} initiated")

    @action(detail=True, methods=["post"])
    def conclude(self, request, pk=None):
        """Conclude a judgment with a verdict."""
        judgment = self.get_object()
        if judgment.is_final:
            return Response({"error": "Judgment already concluded"}, status=status.HTTP_400_BAD_REQUEST)

        serializer = JudgmentConcludeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        verdict = serializer.validated_data["verdict"]
        notes = serializer.validated_data.get("notes", "")

        judgment.conclude(verdict, notes)

        # Transition soul to DISPOSED
        judgment.soul.transition_to(SoulState.DISPOSED, f"Judgment concluded: {verdict}")

        return Response(JudgmentSerializer(judgment).data)
