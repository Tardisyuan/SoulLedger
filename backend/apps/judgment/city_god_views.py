"""城隍的两组接口(规则在 `apps/judgment/city_gods.py`):

* `/api/v1/judgment/city-gods/` —— 本殿的城隍:名字、管的出身地、兜底、名下官员。看是 `judgment.read`,
  增改删是 `judgment.assign`(殿管理员、殿主;分派别人的工作,与改派同一个码名)。只有地府能建。
* `/api/v1/judgment/city-god-cases/` —— 在城隍处初审的案子。默认只列还在城隍处的(PENDING / RETURNED),
  `?status=SENT_ON` 看已解送的,`?city_god=<id>` 只看一位,`?mine=true` 只看我被分到的城隍。
  解送 / 退回要 `judgment.execute`,且是这位城隍名下的官员(或持 `judgment.assign`);改交要 `judgment.assign`。
"""
from django.db import IntegrityError, transaction
from django.db.models import Case, Exists, IntegerField, OuterRef, Value, When
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_field
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.authentication.models import User
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.judgment import city_gods
from apps.judgment.claims import is_assignable
from apps.judgment.models import AT_CITY_GOD, CityGod, CityGodBureau, CityGodRank, CityGodStatus, Judgment
from apps.judgment.serializers import JudgmentClaimRefusalSerializer

REGION_MAX_LENGTH = 50
REGIONS_MAX = 100


def _name(user):
    return (user.display_name or user.username) if user else None


# ── 城隍 ────────────────────────────────────────────────────────────────


class CityGodOfficerSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


def _refusal(code, **facts):
    """字段错误的形状:`{"<字段>": {"code": …, 事实…}}` —— 界面按 `code` 选 `cityGods.error.<code>`,
    用事实填 `{{region}}` / `{{city_god}}`、把冲突的那枚标签描红(第五十三批 G-2)。"""
    return {"code": code, **facts}


class CityGodSerializer(serializers.ModelSerializer):
    regions = serializers.ListField(
        child=serializers.CharField(max_length=REGION_MAX_LENGTH, trim_whitespace=True, allow_blank=True),
        max_length=REGIONS_MAX, required=False,
    )
    #: 写:名下官员的 id 全量(替换)。读:`officers` 带名字。
    officer_ids = serializers.PrimaryKeyRelatedField(
        source="officers", many=True, queryset=User.objects.all(), required=False, write_only=True,
    )
    officers = serializers.SerializerMethodField()
    open_case_count = serializers.SerializerMethodField()
    #: 设了哪些司(docs/08 §三);去重,按 `CityGodBureau` 的顺序存。
    bureaus = serializers.ListField(child=serializers.ChoiceField(choices=CityGodBureau.choices), required=False)

    class Meta:
        model = CityGod
        fields = ("id", "tenant", "name", "rank", "bureaus", "regions", "is_default", "officer_ids", "officers",
                  "open_case_count", "create_time", "update_time")
        read_only_fields = ("id", "tenant", "create_time", "update_time")

    @extend_schema_field(CityGodOfficerSerializer(many=True))
    def get_officers(self, obj) -> list:
        return [{"id": u.pk, "name": _name(u)} for u in obj.officers.order_by("username")]

    def get_open_case_count(self, obj) -> int:
        return Judgment.objects.filter(city_god=obj, city_god_status__in=AT_CITY_GOD).count()

    def _tenant(self):
        return self.instance.tenant if self.instance else self.context["tenant"]

    def _siblings(self):
        others = CityGod.objects.filter(tenant=self._tenant())
        return others.exclude(pk=self.instance.pk) if self.instance else others

    def validate_name(self, value):
        if self._siblings().filter(name=value).exists():
            raise serializers.ValidationError(_refusal("name_taken", name=value))
        return value

    def validate_regions(self, value):
        """去空、去重;同一殿里一个地名只能属于一位城隍(匹配因此没有平局)。"""
        cleaned = list(dict.fromkeys(r for r in value if r))
        mine = {r.casefold() for r in cleaned}
        for other in self._siblings():
            taken = sorted(r for r in (other.regions or ()) if str(r).casefold() in mine)
            if taken:
                raise serializers.ValidationError(
                    _refusal("region_taken", region=taken[0], regions=taken, city_god=other.name))
        return cleaned

    def validate_rank(self, value):
        """土地公的上级只能是县城隍(`TudiGodSerializer.validate_city_god`):名下有土地公的城隍不能改成别的级。"""
        if (value and value != CityGodRank.COUNTY and self.instance is not None
                and self.instance.tudi_gods.filter(is_deleted=False).exists()):
            raise serializers.ValidationError(_refusal("city_god_has_tudi_gods", city_god=self.instance.name))
        return value

    def validate_bureaus(self, value):
        chosen = set(value)
        return [b for b in CityGodBureau.values if b in chosen]

    def validate_is_default(self, value):
        current = self._siblings().filter(is_default=True).first() if value else None
        if current is not None:
            raise serializers.ValidationError(_refusal("default_taken", city_god=current.name))
        return value

    def validate_officer_ids(self, value):
        """与改派同一条规则(`claims.is_assignable`):本殿、在职、能办案。"""
        tenant = self._tenant()
        bad = sorted(u.pk for u in value if not is_assignable(u, tenant.pk, codename="city_god.execute"))
        if bad:
            raise serializers.ValidationError(_refusal("invalid_officer", ids=bad))
        return value


class CityGodViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """本殿的城隍(只有地府有)。删除是软删,名下还有没解送的案子时 409 `city_god_has_open_cases`。"""

    permission_classes = [TenantPermission, CodenamePermission]
    # 城隍一族(用户 2026-10-29 第 3 条):看 city_god.read,增改删与候选名单 city_god.manage(原 judgment.assign)。
    permission_codename = "city_god"
    extra_permissions = {action: ["city_god.manage"]
                         for action in ("create", "update", "partial_update", "destroy", "officer_choices")}
    queryset = CityGod.objects.prefetch_related("officers").all()
    serializer_class = CityGodSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_serializer_context(self):
        return {**super().get_serializer_context(),
                "tenant": getattr(self.request, "tenant", None) or getattr(self.request.user, "tenant", None)}

    @extend_schema(responses={201: CityGodSerializer, 400: JudgmentClaimRefusalSerializer})
    def create(self, request, *args, **kwargs):
        from apps.souls.models import Civilization

        tenant = self.get_serializer_context()["tenant"]
        if tenant is None or tenant.known_civilization != Civilization.CHINESE:
            return Response({"error": "City gods belong to 地府 (CN_DIYU) only.", "code": "city_gods_diyu_only"},
                            status=status.HTTP_400_BAD_REQUEST)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        self._save(serializer, tenant=serializer.context["tenant"])

    def perform_update(self, serializer):
        self._save(serializer)

    @staticmethod
    def _save(serializer, **extra):
        # 两个请求同时抢同一个名字 / 兜底:部分唯一约束挡住,答 400 而不是 500。
        try:
            with transaction.atomic():
                serializer.save(**extra)
        except IntegrityError:
            raise serializers.ValidationError(
                {"non_field_errors": ["Another city god of this hall took this name or the default."]}) from None

    @extend_schema(responses=CityGodOfficerSerializer(many=True))
    @action(detail=False, methods=["get"], url_path="officer-choices")
    def officer_choices(self, request):
        """编辑抽屉里「名下官员」可选的人:本殿能办案的在职官员 —— 与 `officer_ids` 的校验、改派名单同一条规则
        (`claims.is_assignable`)。没有租户的调用者(全局 ADMIN)答空表。"""
        tenant = self.get_serializer_context()["tenant"]
        if tenant is None:
            return Response([])
        people = User.objects.filter(tenant=tenant, is_active=True).order_by("username")
        return Response([{"id": u.pk, "name": _name(u)} for u in people
                         if is_assignable(u, tenant.pk, codename="city_god.execute")])

    @extend_schema(responses={204: None, 409: JudgmentClaimRefusalSerializer})
    def destroy(self, request, *args, **kwargs):
        god = self.get_object()
        open_cases = Judgment.objects.filter(city_god=god, city_god_status__in=AT_CITY_GOD).count()
        if open_cases:
            return Response({"error": "This city god still has cases awaiting review; send them on or transfer "
                                      "them first.", "code": "city_god_has_open_cases", "count": open_cases},
                            status=status.HTTP_409_CONFLICT)
        god.soft_delete(user=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


# ── 初审的案子 ──────────────────────────────────────────────────────────


class CityGodCaseSerializer(serializers.ModelSerializer):
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    origin_location = serializers.CharField(source="soul.origin_location", read_only=True)
    city_god_name = serializers.CharField(source="city_god.name", read_only=True)
    #: 这位城隍的级别(docs/08 §二);未定级是空串。
    city_god_rank = serializers.CharField(source="city_god.rank", read_only=True)
    sent_on_by_name = serializers.SerializerMethodField()
    #: 调用者能否解送 / 退回(名下官员或殿管理员);界面据此置灰,服务端照样查。
    can_act = serializers.SerializerMethodField()
    #: 出身地里决定归属的那个地名(`city_gods.matched_region`);兜底收的为 null。
    matched_region = serializers.SerializerMethodField()
    #: 登记来源:死亡同步(`death_sync`)开的审判是 DEATH_SYNC,其余(官员登记)是 OFFICER。
    registered_via = serializers.SerializerMethodField()
    #: 退回补正的时刻(最近一次 CITY_GOD_RETURNED 事件);不在退回状态时为 null。批语在 `city_god_note`。
    returned_at = serializers.SerializerMethodField()
    #: 抽屉里的生卒与阳寿只写年(可能是公元前,`apps.souls.dates`);没有记的是 null。
    soul_birth_year = serializers.IntegerField(source="soul.birth_year", read_only=True, allow_null=True)
    soul_death_year = serializers.IntegerField(source="soul.death_year", read_only=True, allow_null=True)
    soul_fated_death_year = serializers.IntegerField(source="soul.fated_death_year", read_only=True, allow_null=True)

    class Meta:
        model = Judgment
        fields = ("id", "case_number", "soul", "soul_name", "origin_location", "matched_region", "city_god",
                  "city_god_name", "city_god_rank", "city_god_status", "city_god_note", "sent_on_at", "sent_on_by", "sent_on_by_name",
                  "untimely", "held_until", "created_at", "registered_via", "returned_at", "soul_birth_year", "soul_death_year",
                  "soul_fated_death_year",
                  "can_act")
        read_only_fields = fields

    def get_matched_region(self, obj) -> str | None:
        return city_gods.matched_region(obj)

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_returned_at(self, obj):
        from apps.events.models import SoulEvent

        if obj.city_god_status != CityGodStatus.RETURNED:
            return None
        at = (SoulEvent.objects.filter(soul_id=obj.soul_id, event_type="CITY_GOD_RETURNED",
                                       payload__judgment_id=str(obj.pk))
              .order_by("-create_time").values_list("create_time", flat=True).first())
        return serializers.DateTimeField().to_representation(at)

    @extend_schema_field(serializers.ChoiceField(choices=["OFFICER", "DEATH_SYNC"]))
    def get_registered_via(self, obj):
        return "DEATH_SYNC" if getattr(obj, "from_death_sync", False) else "OFFICER"

    def get_sent_on_by_name(self, obj) -> str | None:
        return _name(obj.sent_on_by)

    def get_can_act(self, obj) -> bool:
        request = self.context.get("request")
        return bool(request and obj.city_god_status in AT_CITY_GOD and city_gods.may_act(request.user, obj))


class CityGodSendOnSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="", trim_whitespace=True)


class CityGodReturnSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=2000, trim_whitespace=True)


class CityGodTransferSerializer(serializers.Serializer):
    city_god = serializers.UUIDField()


class CityGodCaseRefusalSerializer(JudgmentClaimRefusalSerializer):
    city_god = serializers.UUIDField(required=False)
    city_god_status = serializers.CharField(required=False)


_REFUSALS = {400: CityGodCaseRefusalSerializer, 403: CityGodCaseRefusalSerializer,
             404: CityGodCaseRefusalSerializer, 409: CityGodCaseRefusalSerializer}


class CityGodCaseViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, AuditUserViewSetMixin,
                         mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """在城隍处初审的案子(本殿)。"""

    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "city_god"
    extra_permissions = {"send_on": ["city_god.execute"], "return_case": ["city_god.execute"],
                         "transfer": ["city_god.manage"]}
    queryset = Judgment.objects.filter(city_god__isnull=False).select_related("soul", "city_god", "sent_on_by")
    serializer_class = CityGodCaseSerializer

    def get_queryset(self):
        from apps.death_sync.models import DeathRegistrationRequest

        qs = super().get_queryset().annotate(
            from_death_sync=Exists(DeathRegistrationRequest.objects.filter(judgment=OuterRef("pk"))))
        if self.action != "list":
            return qs
        params = self.request.query_params
        wanted = params.get("status")
        qs = qs.filter(city_god_status=wanted) if wanted in CityGodStatus.values else qs.filter(
            city_god_status__in=AT_CITY_GOD)
        if params.get("city_god"):
            qs = qs.filter(city_god_id=params["city_god"])
        if params.get("mine", "").lower() in ("1", "true", "yes"):
            qs = qs.filter(city_god__officers=self.request.user)
        # 退回补正的排在待初审前面:它们等的是补资料,往往已经补好了(第五十三批 Q-1)。
        returned_first = Case(When(city_god_status=CityGodStatus.RETURNED, then=Value(0)), default=Value(1),
                              output_field=IntegerField())
        return qs.order_by(returned_first, "created_at", "id")

    @extend_schema(parameters=[
        OpenApiParameter("status", enum=CityGodStatus.values, required=False,
                         description="PENDING / RETURNED / SENT_ON. Omitted: the cases still with a city god."),
        OpenApiParameter("city_god", str, required=False, description="Only this city god's cases."),
        OpenApiParameter("mine", bool, required=False, description="Only city gods the caller is assigned to."),
    ])
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def _answer(self, run):
        judgment = self.get_object()  # 别的殿的案子在这里就是 404
        try:
            run(judgment.pk)
        except city_gods.CityGodRefusedError as exc:
            return Response(exc.as_payload(), status=exc.status)
        return Response(self.get_serializer(self.get_queryset().get(pk=judgment.pk)).data)

    @extend_schema(request=CityGodSendOnSerializer, responses={200: CityGodCaseSerializer, **_REFUSALS})
    @action(detail=True, methods=["post"])
    def send_on(self, request, pk=None):
        """解送十殿。`note` 可空。不在城隍处 → 409 `not_at_city_god`;不是名下官员 → 403 `not_city_god_officer`。"""
        body = CityGodSendOnSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return self._answer(lambda pk: city_gods.send_on(pk, request.user, body.validated_data["note"]))

    @extend_schema(request=CityGodReturnSerializer, responses={200: CityGodCaseSerializer, **_REFUSALS})
    @action(detail=True, methods=["post"], url_path="return")
    def return_case(self, request, pk=None):
        """退回补正(缺资料)。`note` 必填。只有 PENDING 的能退回;补好之后用 `send_on/` 解送。"""
        body = CityGodReturnSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return self._answer(lambda pk: city_gods.return_case(pk, request.user, body.validated_data["note"]))

    @extend_schema(request=CityGodTransferSerializer, responses={200: CityGodCaseSerializer, **_REFUSALS})
    @action(detail=True, methods=["post"])
    def transfer(self, request, pk=None):
        """改交本殿另一位城隍(状态回到 PENDING)。不是本殿的城隍 → 400 `invalid_city_god`。"""
        body = CityGodTransferSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        target = CityGod.all_objects.filter(pk=body.validated_data["city_god"]).first()
        return self._answer(lambda pk: city_gods.transfer(pk, request.user, target))
