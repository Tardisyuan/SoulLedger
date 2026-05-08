"""
REST views for Realms app.
"""
from rest_framework import viewsets
from apps.realms.models import Realm
from apps.realms.serializers import RealmSerializer, RealmListSerializer


class RealmViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read-only realm listing and detail.
    """
    queryset = Realm.objects.all()
    filterset_fields = ["civilization", "realm_type"]
    ordering_fields = ["civilization", "tier"]

    def get_serializer_class(self):
        if self.action == "list":
            return RealmListSerializer
        return RealmSerializer
