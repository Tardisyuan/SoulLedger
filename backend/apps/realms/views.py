"""
REST views for Realms app.
"""
from rest_framework import viewsets
from apps.realms.models import Realm
from apps.realms.serializers import RealmSerializer, RealmListSerializer, RealmLocalizedSerializer


class RealmViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read-only realm listing and detail.
    Use '?localized=true' query param to get display_name resolved by Accept-Language.
    """
    queryset = Realm.objects.all()
    filterset_fields = ["civilization", "realm_type"]
    ordering_fields = ["civilization", "tier"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.user.role == 'ADMIN':
            return qs
        tenant = getattr(self.request, 'tenant', None)
        if tenant:
            return qs.filter(tenant=tenant)
        return qs.none()

    def get_serializer_class(self):
        if self.action == "list":
            return RealmListSerializer
        if self.request.query_params.get("localized"):
            return RealmLocalizedSerializer
        return RealmSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context
