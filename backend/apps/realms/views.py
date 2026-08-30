"""
REST views for Realms app.
"""
from rest_framework import viewsets

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.viewsets import CodenameViewSetMixin, DataScopeViewSetMixin
from apps.realms.filters import RealmFilter
from apps.realms.models import Realm
from apps.realms.serializers import RealmListSerializer, RealmLocalizedSerializer, RealmSerializer


class RealmViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """
    Read-only realm listing and detail.
    Use '?localized=true' query param to get display_name resolved by Accept-Language.
    """
    # Same shape as apps/actors/views.py: declared `realms`, enforced nothing.
    permission_classes = [TenantPermission, CodenamePermission]
    # Plural, matching the seeded `realms.read` in DEFAULT_PERMISSIONS. This
    # used to read "realm", which generated realm.read — a codename no role
    # holds and no migration ever seeded, so the view could only ever have
    # denied everyone once enforcement came on. The Permission rows are already
    # in the DB under the plural name, so the view moves, not the data.
    # Read-only viewset: `realms.read` is the whole family, no write codename.
    permission_codename = "realms"
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
