"""卷宗(dossier):一件案子的读模型 —— 案子 + 它的灵魂 + 灵魂此刻在哪 + 引用摘要 + 调用者能做的动作。

`GET /api/v1/dossiers/{judgment_id}/`(用户 2026-11-14 决定:只加这个只读聚合,记录各自的路径不变)。
按**案子**取,不按灵魂取:案台与审判台打开的是一件案子,一个灵魂跨几世会有几件
(`docs/audit/2026-11-14-expert-design/raw/review-architect.md` 的裁决)。按灵魂取的版本等「前世」页真的存在时再加。

不是新表,也不是新规则:
- 权限、租户、数据范围、暂居只读例外全部继承 `JudgmentViewSet`(同一个 get_queryset / get_object、
  同一个 `judgment.read`);嵌入的灵魂走 `SoulViewSet` 的 queryset 与 `soul.read`,和 `GET /souls/{id}/` 同一个答案,
  看不到就是 `soul: null, soul_redacted: true`。
- `actions` 读 `claims.allowed_actions`,与认领 / 释放 / 结案同一组断言。
- `whereabouts.spine` 是前端 `frontend/src/components/dossier/spineModel.ts::spineNow` 的移植,形状逐字段相同。
  案台(2026-11-14 起)读这里;审判台、灵魂页与演示的替身(`frontend/demo/flows.ts::dossier`)仍用前端那份,
  两份改一份要改两处。
- `GET /dossiers/desk/`(`desk`):案台一屏 —— 四组头几件 + 计数 + 本月已结,一个请求替掉此前的六个。
"""
import hashlib
import json

from django.db.models import TextChoices
from django.utils.cache import get_conditional_response, patch_vary_headers
from django_filters.utils import translate_validation
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_field
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.tenant import scope_to_tenant
from apps.judgment import claims, hall_stats, sources
from apps.judgment.claims import ferry_barred
from apps.judgment.models import AT_CITY_GOD, DUAT_BARRED, JudgmentCitation
from apps.judgment.serializers import JudgmentListSerializer, JudgmentQueueCountsSerializer, QueueGroup, _locale_from
from apps.judgment.views import PENDING, JudgmentFilter, JudgmentViewSet, group_q, queue_counts_of
from apps.souls.models import Soul
from apps.souls.serializers import SoulRecordSerializer, SoulSerializer

#: 案台每组带几件(与 `/judgment/` 的一页同长,`REST_FRAMEWORK.PAGE_SIZE`)。
DESK_ROWS = 20

# ---------------------------------------------------------------------------
# 脊上的「现在」(spineModel.ts 的移植)
# ---------------------------------------------------------------------------

_CIV = {"CHINESE": "cn", "EUROPEAN": "eu", "EGYPTIAN": "eg", "GREEK": "gr"}
_CIRCLE = {"1ST": 1, "2ND": 2, "3RD": 3, "4TH": 4, "5TH": 5, "6TH": 6, "7TH": 7, "8TH": 8, "9TH": 9}
# 十殿的写法(`packages/core/src/domain/courts.ts` 的 court_1 … court_10)。
_COURT_N = {
    spelling.lower(): n
    for n, (zh, en) in enumerate(zip(
        "一二三四五六七八九十",
        ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"],
        strict=True,
    ), start=1)
    for spelling in (f"第{zh}殿", f"{en} Court")
}
_STATIONS = list(Soul.DiyuStation.values)


def court_ordinal(court: str | None) -> int | None:
    """`第五殿` / `Fifth Court` → 5;别的殿名 None。"""
    return _COURT_N.get((court or "").strip().lower())


def spine_now(civilization, current_state, diyu_station, court, realm_code) -> dict | None:
    """灵魂此刻在脊上的哪一点;认不出是 None(脊照画,没有点 —— 不猜一个位置)。"""
    civ = _CIV.get(civilization or "")
    realm = realm_code or ""
    judging = current_state == "JUDGING"
    if civ == "cn":
        at = _STATIONS.index(diyu_station) + 1 if diyu_station in _STATIONS else None
        hall = court_ordinal(court)
        if current_state == "REINCARNATING" or (at is not None and at >= 12):
            return {"civ": civ, "at": "rebirth"}
        if at == 11:
            return {"civ": civ, "at": "hell", "n": hall or 1}
        if at == 10 or (at is None and judging and hall):
            return {"civ": civ, "at": "hall", "n": hall or 1}
        if at is not None:
            return {"civ": civ, "at": "pre", "n": at}
        return None
    if civ == "eu":
        if realm.startswith("EU_HELL_") and realm[8:] in _CIRCLE:
            return {"civ": civ, "at": "circle", "n": _CIRCLE[realm[8:]]}
        return {"civ": civ, "at": "gate"} if judging or realm in ("EU_ACHERON", "EU_ANTINFERNO") else None
    if civ == "eg":
        if realm == "EG_AARU":
            return {"civ": civ, "at": "aaru"}
        if realm in ("EG_ANNIHILATION", "EG_DEVOURER"):
            return {"civ": civ, "at": "annihilation"}
        if realm == "EG_HALL_TWO_TRUTHS" or judging:
            return {"civ": civ, "at": "scale"}
        return {"civ": civ, "at": "gate"} if realm.startswith("EG_") else None
    if civ == "gr":
        fixed = {"GR_ISLES_OF_THE_BLESSED": "isles", "GR_ASPHODEL_MEADOW": "asphodel", "GR_PLATO_MEADOW": "asphodel",
                 "GR_TARTARUS": "tartarus", "GR_ACHERON": "ferry"}
        if realm in fixed:
            return {"civ": civ, "at": fixed[realm]}
        return {"civ": civ, "at": "fork"} if realm == "GR_HADES" or judging else None
    return None


def whereabouts(soul: Soul, court: str, request) -> dict:
    """灵魂在哪:所在殿、是否暂居、没离开的那一站(与 `GET /souls/{id}/path/` 同一个逐站租户划界)与脊上的点。"""
    from apps.realms.models import SoulPathEntry

    stop = scope_to_tenant(
        SoulPathEntry.objects.filter(soul=soul, left_at__isnull=True).select_related("realm"),
        request, residence_read=True,
    ).first()
    realm_code = stop.realm.realm_code if stop is not None and stop.realm_id else None
    return {
        "hall": soul.tenant.code if soul.tenant_id else None,
        "residing": soul.is_residing,
        "realm_code": realm_code,
        "since": stop.entered_at if stop is not None else None,
        "spine": spine_now(soul.civilization, soul.current_state, soul.diyu_station, court, realm_code),
    }


# ---------------------------------------------------------------------------
# 案子的阶段(be-domain §3.6 的 `case.phase`)
# ---------------------------------------------------------------------------


class DossierPhase(TextChoices):
    UNCLAIMED = "UNCLAIMED", "未认领"
    HEARING = "HEARING", "已认领"
    DEFERRED = "DEFERRED", "暂缓"
    AT_CITY_GOD = "AT_CITY_GOD", "在城隍"
    BARRED = "BARRED", "到不了殿"
    AWAITING_REVIEW = "AWAITING_REVIEW", "已结案、审批未完"
    CLOSED = "CLOSED", "已结"


def phase_of(judgment) -> str:
    """一件看得见的案子此刻在哪一段。撤案(软删)的案子本来就不在 queryset 里,所以没有 WITHDRAWN。"""
    from apps.workflow.models import ApprovalWorkflowStatus as S

    if judgment.verdict is not None or judgment.is_final:
        flow = judgment.approval_workflow
        if flow is not None and flow.decides_judgment and flow.status in (S.PENDING, S.IN_PROGRESS, S.APPEAL, S.EXCEPTION):
            return DossierPhase.AWAITING_REVIEW
        return DossierPhase.CLOSED
    if judgment.city_god_status in AT_CITY_GOD:
        return DossierPhase.AT_CITY_GOD
    if judgment.duat_stage in DUAT_BARRED or ferry_barred(judgment):
        return DossierPhase.BARRED
    if judgment.deferred_at is not None:
        return DossierPhase.DEFERRED
    return DossierPhase.HEARING if judgment.claimed_by_id else DossierPhase.UNCLAIMED


# ---------------------------------------------------------------------------
# 序列化
# ---------------------------------------------------------------------------


class DossierSoulSerializer(SoulSerializer):
    """卷宗里的灵魂:`SoulSerializer` 的子集,字段规则(VIEWER 底线、FieldPermission、记录权重遮蔽)原样继承。
    `records` 只带最近三条,排序同案台(`OpenCase.tsx::recentRecords`:事件日期新的在前,没日期的最后)。"""

    records = SoulRecordSerializer(many=True, read_only=True, source="dossier_records")

    class Meta(SoulSerializer.Meta):
        fields = [
            "id", "name", "civilization", "current_state", "diyu_station", "is_residing",
            "birth_date", "death_date", "origin_location", "records",
        ]


def _recent_records(soul, n=3):
    def key(r):
        y = r.event_year
        return (y * 10_000 + (r.event_month or 0) * 100 + (r.event_day or 0) if y is not None else float("-inf"),
                r.recorded_at)
    return sorted(soul.records.all(), key=key, reverse=True)[:n]


class DossierCitationSerializer(serializers.ModelSerializer):
    """引用行 + 法条标识;全文走 `GET /judgment/statutes/{id}/`。"""

    code = serializers.CharField(source="statute.code", read_only=True)
    title = serializers.SerializerMethodField()

    class Meta:
        model = JudgmentCitation
        fields = ["id", "statute", "code", "title", "note"]

    def get_title(self, obj) -> str:
        return obj.statute.get_localized_title(_locale_from(self.context))


class SpineSerializer(serializers.Serializer):
    civ = serializers.ChoiceField(choices=["cn", "eu", "eg", "gr"])
    at = serializers.ChoiceField(choices=[
        "pre", "hall", "hell", "rebirth", "gate", "circle", "scale", "aaru", "annihilation",
        "ferry", "fork", "isles", "asphodel", "tartarus",
    ])
    n = serializers.IntegerField(required=False)


class WhereaboutsSerializer(serializers.Serializer):
    hall = serializers.CharField(allow_null=True)
    residing = serializers.BooleanField()
    realm_code = serializers.CharField(allow_null=True)
    since = serializers.DateTimeField(allow_null=True)
    spine = SpineSerializer(allow_null=True)


class DossierActionsSerializer(serializers.Serializer):
    claim = serializers.BooleanField()
    release = serializers.BooleanField()
    conclude = serializers.BooleanField()
    refusals = serializers.DictField(child=serializers.CharField())


class DossierSerializer(serializers.Serializer):
    """`soul` / `judgment` 在方法里带着请求的上下文实例化:FieldPermissionMixin 在 __init__ 时读上下文,
    作为嵌套字段声明的话那一刻没有请求,字段规则就落空了。"""

    id = serializers.UUIDField()
    version = serializers.IntegerField()
    phase = serializers.SerializerMethodField()
    judgment = serializers.SerializerMethodField()
    citations = DossierCitationSerializer(many=True, source="citations.all")
    soul = serializers.SerializerMethodField()
    soul_redacted = serializers.SerializerMethodField()
    whereabouts = serializers.SerializerMethodField()
    actions = serializers.SerializerMethodField()

    @extend_schema_field(serializers.ChoiceField(choices=DossierPhase.choices))
    def get_phase(self, obj) -> str:
        return phase_of(obj)

    @extend_schema_field(JudgmentListSerializer)
    def get_judgment(self, obj):
        return JudgmentListSerializer(obj, context=self.context).data

    @extend_schema_field(DossierSoulSerializer(allow_null=True))
    def get_soul(self, obj):
        soul = obj.dossier_soul
        return None if soul is None else DossierSoulSerializer(soul, context=self.context).data

    def get_soul_redacted(self, obj) -> bool:
        return obj.dossier_soul is None

    @extend_schema_field(WhereaboutsSerializer(allow_null=True))
    def get_whereabouts(self, obj):
        soul = obj.dossier_soul
        if soul is None:
            return None
        return WhereaboutsSerializer(whereabouts(soul, obj.court, self.context["request"])).data

    @extend_schema_field(DossierActionsSerializer)
    def get_actions(self, obj):
        return claims.allowed_actions(obj, self.context["request"].user)


class DossierRowSerializer(JudgmentListSerializer):
    """案台一行(be-scale 的 `DeskRowSerializer`):列表的字段规则,只带一行要显示的这些。"""

    class Meta(JudgmentListSerializer.Meta):
        # 后七个是行上的标签与第二行要的(`frontend/src/components/desk/deskRules.ts` 的 deskTag / rowNotes /
        # heldBeforeClaim):期限、退回重审、待宣判、杜阿特、候至、结案拦阻、枉死。
        fields = [
            "id", "case_number", "soul", "soul_name", "civilization", "court", "source",
            "deadline_at", "is_overdue", "claimed_by", "claimed_by_name", "deferred_at", "stale_since",
            "deadline_remaining_seconds", "retrial_of", "is_final", "duat_stage", "held_until",
            "conclude_refusal", "untimely",
        ]


class DeskGroupSerializer(serializers.Serializer):
    group = serializers.ChoiceField(choices=QueueGroup.CHOICES)
    #: 这一组在当前 `source` 下的件数(与 `queue-counts?source=` 的组数同一条查询);`rows` 只是头 `DESK_ROWS` 件。
    total = serializers.IntegerField()
    rows = DossierRowSerializer(many=True)


class DossierDeskSerializer(serializers.Serializer):
    """`GET /dossiers/desk/`:案台一屏 —— 四组各头几件 + 不筛的计数(概览、来源 chip)+ 本月已结的百分比。"""

    groups = DeskGroupSerializer(many=True)
    counts = JudgmentQueueCountsSerializer()
    month_done_pct = serializers.IntegerField(allow_null=True)


# ---------------------------------------------------------------------------
# 视图
# ---------------------------------------------------------------------------


class DossierViewSet(JudgmentViewSet):
    """只挂 list / retrieve(`config/urls.py` 显式 `as_view`,不走路由器 —— 路由器会把父类的每个 @action 也挂上)。
    动作名仍是 list / retrieve,所以码名(`judgment.read`)、暂居只读例外、筛选、分页、`source` 全与 `/judgment/` 相同。"""

    http_method_names = ["get", "head", "options"]
    # 父类的四个里只有这两个挂在这里(暂居地对灵魂的审判进展,同 `/judgment/` 的 list / retrieve)。
    # `desk` 不在里面:它是待办队列,与 `next_pending`、`queue-counts` 同一个范围 —— 原属租户对暂居地的案子
    # 什么都做不了。此前四个 `?group=` 列表走 list 的范围而组数走 queue-counts 的,两者在暂居的案子上对不上。
    residence_read_actions = ("list", "retrieve")
    # `desk` 读的就是 list + queue-counts + hall-stats,三者都是 `judgment.read`。
    extra_permissions = {**JudgmentViewSet.extra_permissions, "desk": ["judgment.read"]}

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list":
            return qs.select_related(None).select_related("soul", "claimed_by", "tenant")
        if self.action == "retrieve":
            return qs.prefetch_related(None).prefetch_related("citations__statute")
        # desk:父类的 select_related 原样留着 —— 行上的 `conclude_refusal` 读城隍 / 流程 / 灵魂,与 `/judgment/` 列表同一份。
        return qs

    def get_serializer_class(self):
        return DossierRowSerializer if self.action == "list" else DossierSerializer

    def _visible_soul(self, soul_id):
        """`GET /souls/{id}/` 会不会给这个灵魂:同一个码名、同一个 queryset。"""
        from apps.perm.checker import check_permission
        from apps.souls.views import SoulViewSet

        if not check_permission(self.request.user, "soul.read"):
            return None
        view = SoulViewSet(request=self.request, action="retrieve", kwargs={"pk": soul_id}, format_kwarg=None)
        soul = view.get_queryset().filter(pk=soul_id).first()
        if soul is not None:
            soul.dossier_records = _recent_records(soul)
        return soul

    @extend_schema(responses={200: DossierSerializer, 304: None})
    def retrieve(self, request, *args, **kwargs):
        """一份卷宗。`ETag` 是整份响应的摘要(灵魂、所在站、可做动作变了都会变,不只是案子的 version);
        带 `If-None-Match` 且没变,回 304。"""
        judgment = self.get_object()
        judgment.dossier_soul = self._visible_soul(judgment.soul_id)
        data = self.get_serializer(judgment).data
        body = json.dumps(data, sort_keys=True, default=str, ensure_ascii=False).encode()
        etag = f'W/"{hashlib.sha256(body).hexdigest()[:32]}"'
        response = get_conditional_response(request, etag=etag) or Response(data)
        response["ETag"] = etag
        response["Cache-Control"] = "private, no-cache"
        patch_vary_headers(response, ("Authorization", "Accept-Language"))
        return response

    @extend_schema(
        responses=DossierDeskSerializer,
        parameters=[OpenApiParameter(
            "source", str, enum=sources.VALUES,
            description="只摞这一个来源的案子;组数跟着收窄,`counts` 不随它变(概览与来源 chip 用不筛的数)。",
        )],
    )
    # 挂在 `config/urls.py` 的 `dossiers/desk/`(不经路由器);`@action` 让暂居只读契约看得见它只接 GET。
    @action(detail=False, methods=["get"], url_path="desk", pagination_class=None, filter_backends=[])
    def desk(self, request):
        """案台一屏,一个请求:此前是四个 `GET /judgment/?group=…`、`queue-counts`(筛与不筛各一)和 `hall-stats`。
        范围、筛选、计数都调 `/judgment/` 的同一组函数(`JudgmentFilter`、`group_q`、`queue_counts_of`、
        `hall_stats.overview`),所以三处的数不会对不上;四组出自同一个快照,服务端互斥,不用前端再去重。"""
        base = self.get_queryset()

        def pending(params):
            filterset = JudgmentFilter(params, queryset=base.filter(PENDING), request=request)
            if not filterset.is_valid():
                raise translate_validation(filterset.errors)
            return filterset.qs

        source = request.query_params.get("source")
        everything = pending({})
        counts = queue_counts_of(everything, request.user)
        counts["elsewhere"] = sources.elsewhere_counts(request)
        narrowed = pending({"source": source}) if source else everything
        totals = queue_counts_of(narrowed, request.user) if source else counts

        # ponytail: 每组头 DESK_ROWS 件(与此前每组取第一页同长);一组上百件时加游标。
        rows = {
            group: list(narrowed.filter(group_q(group, request.user)).order_by("created_at", "pk")[:DESK_ROWS])
            for group, _label in QueueGroup.CHOICES
        }
        sources.attach([j for page in rows.values() for j in page])
        context = self.get_serializer_context()
        return Response({
            "groups": [
                {"group": group, "total": totals[group], "rows": DossierRowSerializer(page, many=True, context=context).data}
                for group, page in rows.items()
            ],
            "counts": counts,
            "month_done_pct": hall_stats.overview(base, PENDING, getattr(request, "tenant", None))["month_done_pct"],
        })
