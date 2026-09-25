"""
REST views for Realms app.
"""
from django.db.models import Count
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.tenant import scope_to_tenant
from apps.core.viewsets import CodenameViewSetMixin, DataScopeViewSetMixin
from apps.realms.filters import RealmFilter
from apps.realms.models import Realm, SoulPathEntry
from apps.realms.serializers import (
    RealmListSerializer,
    RealmLocalizedSerializer,
    RealmOccupancySerializer,
    RealmSerializer,
)


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
    extra_permissions = {"occupancy": ["realms.read"]}
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

    @extend_schema(responses=RealmOccupancySerializer(many=True))
    @action(detail=False, methods=["get"], pagination_class=None)
    def occupancy(self, request):
        """在押:每个界域里此刻有多少灵魂(官员端界域页的树表)。

        数的是**未离开**的行程站(`SoulPathEntry.left_at` 为空)—— 一个灵魂同时
        只有一条(`soulpath_one_open_entry_per_soul` 约束),所以这是人数,不是人次。
        按行程站自己的租户划界,与 `GET /souls/{id}/path/` 同一口径;没有一站的
        界域不出现在结果里(前端读作 0,那是事实,不是缺值)。
        """
        entries = scope_to_tenant(
            SoulPathEntry.objects.filter(
                left_at__isnull=True, realm__isnull=False, soul__is_deleted=False,
            ),
            request,
        )
        rows = entries.values("realm_id").annotate(count=Count("id")).order_by("realm_id")
        return Response(RealmOccupancySerializer(rows, many=True).data)
