"""
REST views for Reincarnation app.
"""
from rest_framework import viewsets
from apps.reincarnation.models import Reincarnation
from apps.reincarnation.serializers import ReincarnationSerializer


class ReincarnationViewSet(viewsets.ModelViewSet):
    queryset = Reincarnation.objects.all()
    serializer_class = ReincarnationSerializer
    filterset_fields = ["soul", "rebirth_form", "cycle_count"]
    ordering_fields = ["reincarnated_at"]
