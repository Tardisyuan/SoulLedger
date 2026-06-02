"""
REST views for Realms app.
"""
from rest_framework import viewsets
from apps.realms.models import Realm
from apps.realms.serializers import RealmSerializer, RealmListSerializer, RealmLocalizedSerializer
from apps.realms.filters import RealmFilter
from apps.core.permissions import TenantPermission
from apps.core.viewsets import CodenameViewSetMixin, DataScopeViewSetMixin


class RealmViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """
    Read-only realm listing and detail.
    Use '?localized=true' query param to get display_name resolved by Accept-Language.
    """
    permission_classes = [TenantPermission]
    permission_codename = "realm"
    queryset = Realm.objects.select_related("parent_realm").all()
    filterset_class = RealmFilter
    search_fields = RealmFilter.search_fields
    ordering_fields = RealmFilter.ordering_fields

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
