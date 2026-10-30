"""
REST views for Events app (audit log).
"""
from django.db.models import Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.views import parse_date_param
from apps.core.permissions import TenantPermission
from apps.core.viewsets import CodenameViewSetMixin, DataScopeViewSetMixin
from apps.events.models import SoulEvent
from apps.events.serializers import SoulEventSerializer

#: 系统事件:`EventService.log*` 不给 actor 时写 "system";老数据里也有空串。
SYSTEM_ACTOR = Q(actor="") | Q(actor="system")
# ponytail: 操作人下拉最多 200 个名字;某殿真有更多操作人时改成带搜索的接口。
ACTORS_LIMIT = 200

_RANGE_PARAMS = [
    OpenApiParameter("start_date", OpenApiTypes.DATE, description="YYYY-MM-DD, inclusive, on create_time"),
    OpenApiParameter("end_date", OpenApiTypes.DATE, description="YYYY-MM-DD, inclusive, on create_time"),
    OpenApiParameter("exclude_system", OpenApiTypes.BOOL, description="1 hides events whose actor is empty or 'system'"),
]


@extend_schema_view(list=extend_schema(parameters=_RANGE_PARAMS))
class SoulEventViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """A soul's own timeline. NOT the administrative audit log.

    The docstring here used to read "Read-only audit log", and that one line has
    now caused the same question to be raised twice: why can a VIEWER read this
    when `AuditLog` requires `audit.read` (ADMIN and MODERATOR only)?

    Because they are different things. `AuditLog` records who changed what, for
    review. `SoulEvent` records what happened to a soul, and it is what
    `SoulLifecycleTimeline` draws on the soul detail page — through
    `packages/core/src/api/events.ts` → `frontend/src/components/souls/
    SoulLifecycleTimeline.tsx`. VIEWER holds `soul.read`
    (`apps/perm/models.py:388-394`), so VIEWER can open that page; gating this
    endpoint behind a codename VIEWER does not hold would leave the page
    rendering with an empty timeline and no explanation.

    The payload is soul-domain facts (`{"soul_id": …, …}`,
    `apps/events/event_bus.py:209`) — the same facts the page already shows —
    not credentials or cross-tenant data. Tenant scoping still applies through
    `DataScopeViewSetMixin`.
    """
    permission_classes = [TenantPermission]
    # EXEMPT, and deliberately so — not a queued decision.
    #
    # The earlier note here said a seeded `event.read` was "queued rather than
    # invented". Re-examined 2026-09-07: there is nothing to queue. A codename
    # would have to be granted to every role that can open a soul page, which is
    # every role including VIEWER, and a permission held by everyone is a
    # permission that only adds a way to get it wrong. The previous "event"
    # declaration produced `event.read` held by nobody, which would have hidden
    # the timeline from ADMIN too.
    permission_codename = None
    queryset = SoulEvent.objects.select_related("soul", "tenant").all()
    serializer_class = SoulEventSerializer
    # 暂居只读例外(apps/core/tenant.py):原属租户看得到暂居地的时间线,
    # 包括回归被拦下的 DISPATCH_RETURN_BLOCKED。
    residence_read_actions = ("list", "retrieve", "actors")
    filterset_fields = ["soul", "event_type", "actor"]
    # 「灵魂事件」页(/events)的灵魂搜索:姓名、出生名包含,灵魂编号整串相等。
    # 编号只认整串 —— 它是灵魂端的登录名,`SoulSerializer` 不给它,这里不该能按片段试出来。
    search_fields = ["soul__name", "soul__birth_name", "=soul__soul_code"]
    # `create_time`, not `created_at` — `SoulEvent` has no `created_at`.
    # DRF's OrderingFilter silently drops an unknown field, so
    # `?ordering=created_at` answered 200 and sorted by nothing: **a knob that
    # returns success and does nothing**. `occurred_at` used to be listed here
    # too, but `SoulEvent` has no such column either: the whitelist let it
    # through to `order_by`, which raised (2026-10-17). Only real columns.
    ordering_fields = ["create_time", "event_type"]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        # 与审计日志同一个解析:坏日期是 400,不是 500;两端都含。
        start_date = parse_date_param(params, "start_date")
        if start_date:
            qs = qs.filter(create_time__date__gte=start_date)
        end_date = parse_date_param(params, "end_date")
        if end_date:
            qs = qs.filter(create_time__date__lte=end_date)
        # 「含系统事件」不勾时页面带 exclude_system=1。系统 = actor 为空或 "system"
        # (`EventService.log*` 的默认 actor),与前端 `isSystemActor` 同一个定义。
        if params.get("exclude_system") in ("1", "true"):
            qs = qs.exclude(SYSTEM_ACTOR)
        return qs

    @extend_schema(
        parameters=_RANGE_PARAMS,
        responses={200: serializers.ListSerializer(child=serializers.CharField())},
    )
    @action(detail=False, methods=["get"])
    def actors(self, request):
        """「全部操作人」下拉的选项:本殿出现过的非系统操作人,按名字排。"""
        names = (
            self.get_queryset().exclude(SYSTEM_ACTOR)
            .order_by("actor").values_list("actor", flat=True).distinct()[:ACTORS_LIMIT]
        )
        return Response(list(names))
