"""
REST views for Realms app.
"""
from datetime import datetime, time
from zoneinfo import ZoneInfo

from django.db.models import Avg, Count, DateTimeField, DurationField, ExpressionWrapper, F, Value
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.tenant import scope_to_tenant
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.realms.filters import RealmFilter
from apps.realms.models import Realm, SoulPathEntry
from apps.realms.serializers import (
    RealmCapacityResultSerializer,
    RealmCapacitySerializer,
    RealmListSerializer,
    RealmLocalizedSerializer,
    RealmOccupancySerializer,
    RealmSerializer,
)


class RealmViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, AuditUserViewSetMixin,
                   mixins.UpdateModelMixin, viewsets.ReadOnlyModelViewSet):
    """
    Realm listing and detail, plus one write: `PATCH /realms/{id}/` with `capacity`.
    Use '?localized=true' query param to get display_name resolved by Accept-Language.

    Capacity is the only editable column. It is operational — how many souls a
    realm holds at once — and not mythology: `seed_mythology` does not seed it
    (apps/actors/mythology/seeding.py). Everything else on the row comes from
    the corpus and stays read-only. `realms.manage` (ADMIN by default) gates it;
    the row is found through `get_object`, i.e. tenant-scoped like every read;
    `Realm` is an `AuditUserFields` model, so the write lands in AuditLog with
    its before/after, and `AuditUserViewSetMixin` puts the user on that row.
    """
    # No PUT: a full-row replace is exactly the write this endpoint refuses.
    http_method_names = ["get", "patch", "head", "options"]
    # Same shape as apps/actors/views.py: declared `realms`, enforced nothing.
    permission_classes = [TenantPermission, CodenamePermission]
    # Plural, matching the seeded `realms.read` in DEFAULT_PERMISSIONS. This
    # used to read "realm", which generated realm.read — a codename no role
    # holds and no migration ever seeded, so the view could only ever have
    # denied everyone once enforcement came on. The Permission rows are already
    # in the DB under the plural name, so the view moves, not the data.
    # `realms.read` for every read; the one write is `realms.manage`.
    permission_codename = "realms"
    # `update` (PUT) is refused by `http_method_names` before any permission
    # check; it is mapped anyway so no action can resolve to an unseeded
    # `realms.update` (apps/perm/test_codename_coverage.py).
    extra_permissions = {
        "occupancy": ["realms.read"],
        "partial_update": ["realms.manage"],
        "update": ["realms.manage"],
    }
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

    @extend_schema(request=RealmCapacitySerializer, responses=RealmCapacityResultSerializer)
    def partial_update(self, request, *args, **kwargs):
        """Change `capacity` — and nothing else (any other field is a 400).

        Lowering it below the number of souls already there is allowed: nobody
        is moved, and from now on the destination picker refuses this realm
        with 409 `realm_full` (`disposition/destination.py`). `is_full` in the
        response says whether that is now the case, counted the same way."""
        from apps.disposition.destination import realm_held

        realm = self.get_object()
        serializer = RealmCapacitySerializer(realm, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        realm.held = realm_held(realm.pk)
        realm.is_full = realm.capacity is not None and realm.held >= realm.capacity
        return Response(RealmCapacityResultSerializer(realm, context=self.get_serializer_context()).data)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context

    @extend_schema(responses=RealmOccupancySerializer(many=True))
    @action(detail=False, methods=["get"], pagination_class=None)
    def occupancy(self, request):
        """在押:每个界域里此刻有多少灵魂(官员端界域页的树表与冥界地图的小卡)。

        * `count` —— **未离开**的行程站(`SoulPathEntry.left_at` 为空)。一个灵魂同时只有一条
          (`soulpath_one_open_entry_per_soul` 约束),所以这是人数,不是人次。
        * `arrived_today` / `left_today` —— 今天(殿的时区,`Tenant.hall_timezone`,与概览
          `judgment/hall_stats.py` 同一取法;没有殿的调用者按 UTC)0 点起 `entered_at` / `left_at`
          落在这个界域的行程站数:人次,同一灵魂进出两次算两次。
        * `avg_stay_days` —— 此刻在押的灵魂到现在已经待了多少天的平均,一位小数;没人在押是 null。
          取在押而不取「已离开的停留」:在押是这张卡的主语,而永不离开的界域(`is_eternal`)
          没有已结束的停留可平均。

        按行程站自己的租户划界,与 `GET /souls/{id}/path/` 同一口径;三个数各一次分组查询,
        不按界域逐个查。三个数都为 0 的界域不出现在结果里(前端读作 0,那是事实,不是缺值)。
        """
        now = timezone.now()
        tenant = getattr(request, "tenant", None)
        tz = ZoneInfo(tenant.hall_timezone if tenant is not None else "UTC")
        day_start = datetime.combine(now.astimezone(tz).date(), time.min, tzinfo=tz)
        entries = scope_to_tenant(
            SoulPathEntry.objects.filter(realm__isnull=False, soul__is_deleted=False),
            request,
        )
        stay = ExpressionWrapper(Value(now, output_field=DateTimeField()) - F("entered_at"), output_field=DurationField())
        rows: dict = {}

        def row(realm_id):
            return rows.setdefault(realm_id, {
                "realm_id": realm_id, "count": 0, "arrived_today": 0, "left_today": 0, "avg_stay_days": None,
            })

        held = (entries.filter(left_at__isnull=True).values("realm_id")
                .annotate(n=Count("id"), stay=Avg(stay)).order_by())
        for r in held:
            row(r["realm_id"]).update(
                count=r["n"], avg_stay_days=round(r["stay"].total_seconds() / 86400, 1) if r["stay"] is not None else None,
            )
        for field, key in (("entered_at", "arrived_today"), ("left_at", "left_today")):
            for r in entries.filter(**{f"{field}__gte": day_start}).values("realm_id").annotate(n=Count("id")).order_by():
                row(r["realm_id"])[key] = r["n"]
        ordered = [rows[k] for k in sorted(rows, key=str)]
        return Response(RealmOccupancySerializer(ordered, many=True).data)
