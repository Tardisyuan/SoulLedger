"""
REST views for Actors app.
"""
from rest_framework import viewsets

from apps.actors.filters import ActorFilter
from apps.actors.models import Actor
from apps.actors.serializers import ActorListSerializer, ActorLocalizedSerializer, ActorSerializer
from apps.core.permissions import TenantPermission
from apps.core.viewsets import CodenameViewSetMixin, DataScopeViewSetMixin


class ActorViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """
    Read-only actor listing and detail.
    Use '?localized=true' query param to get display_name resolved by Accept-Language.
    """
    permission_classes = [TenantPermission]
    # Plural, matching the seeded `actors.read` in DEFAULT_PERMISSIONS — same
    # singular/plural mismatch as realms had. Renaming the view is free;
    # renaming the Permission rows would need another data migration.
    # Read-only viewset: `actors.read` is the whole family, no write codename.
    permission_codename = "actors"
    queryset = Actor.objects.filter(is_active=True)
    filterset_class = ActorFilter
    search_fields = ActorFilter.search_fields
    ordering_fields = ActorFilter.ordering_fields

    def get_serializer_class(self):
        if self.request.query_params.get("localized"):
            return ActorLocalizedSerializer
        if self.action == "list":
            return ActorListSerializer
        return ActorSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context
