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
    # `select_related("parent_realm")` is inert with the current serializer and
    # is kept only against the day it is not.
    #
    # Measured 2026-08-31 (10 children under one parent): **4 queries with it,
    # 4 without**. `RealmSerializer` renders `parent_realm` as a bare primary
    # key, so nothing dereferences the parent row and there is no join to save.
    # `tests/test_realm_actor_api.py` used to carry a test *named* after this
    # line whose only assertion was `status_code == 200`.
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
