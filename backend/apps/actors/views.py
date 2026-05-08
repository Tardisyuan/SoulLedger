"""
REST views for Actors app.
"""
from rest_framework import viewsets
from apps.actors.models import Actor
from apps.actors.serializers import ActorSerializer, ActorListSerializer


class ActorViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read-only actor listing and detail.
    """
    queryset = Actor.objects.filter(is_active=True)
    filterset_fields = ["civilization", "role"]
    ordering_fields = ["civilization", "role", "name"]

    def get_serializer_class(self):
        if self.action == "list":
            return ActorListSerializer
        return ActorSerializer
