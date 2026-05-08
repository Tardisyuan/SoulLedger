"""
REST views for Disposition app.
"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from apps.disposition.models import Disposition
from apps.disposition.serializers import DispositionSerializer, DispositionExecuteSerializer
from apps.disposition.services import DispositionService


class DispositionViewSet(viewsets.ModelViewSet):
    queryset = Disposition.objects.all()
    serializer_class = DispositionSerializer
    filterset_fields = ["soul", "is_executed", "is_eternal", "memory_reset"]
    ordering_fields = ["created_at", "executed_at"]

    @action(detail=True, methods=["post"])
    def execute(self, request, pk=None):
        """Execute a disposition and trigger reincarnation."""
        disposition = self.get_object()
        if disposition.is_executed:
            return Response({"error": "Already executed"}, status=status.HTTP_400_BAD_REQUEST)

        serializer = DispositionExecuteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        DispositionService.execute(disposition)
        return Response(DispositionSerializer(disposition).data)
