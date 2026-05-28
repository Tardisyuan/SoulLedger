"""
REST views for Actors app.
"""
from rest_framework import viewsets
from apps.actors.models import Actor
from apps.actors.serializers import ActorSerializer, ActorListSerializer, ActorLocalizedSerializer
from apps.core.permissions import TenantPermission
from apps.core.viewsets import CodenameViewSetMixin, DataScopeViewSetMixin


class ActorViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """
    Read-only actor listing and detail.
    Use '?localized=true' query param to get display_name resolved by Accept-Language.
    """
    permission_classes = [TenantPermission]
    permission_codename = "actor"
    queryset = Actor.objects.filter(is_active=True)
    filterset_fields = ["civilization", "role"]
    ordering_fields = ["civilization", "role", "name"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not user.is_authenticated:
            return qs.none()
        if user.role == 'ADMIN':
            return qs
        tenant = getattr(self.request, 'tenant', None)
        if tenant:
            return qs.filter(tenant=tenant)
        return qs.none()

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
