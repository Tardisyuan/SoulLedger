"""`/api/v1/judgment/wangsi/{id}/grievance/` 与 `…/decide/`:枉死城的冤情申诉(规则在 `apps/judgment/wangsi.py`)。

两个动作都要 `judgment.execute`;审核另要是这件案子城隍名下的官员或持 `judgment.assign`(服务里查)。
只看得到本殿枉死的案子(别的是 404)。答复是整件审判(`JudgmentSerializer`),审判台直接换上。

灵魂端:`/api/v1/me/wangsi/` —— 本人本世枉死的案子(还押与否、申诉到哪一步),与提出申诉。只从 `self.account` 出发,
规则与官员端是同一个函数(`wangsi.file_grievance`)。
"""
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.judgment import wangsi
from apps.judgment.claims import ClaimRefusedError
from apps.judgment.models import Judgment
from apps.judgment.serializers import JudgmentClaimRefusalSerializer, JudgmentSerializer
from apps.soul_accounts.me_views import SoulAPIView
from apps.soul_accounts.serializers import SoulErrorSerializer


class WangsiGrievanceSerializer(serializers.Serializer):
    plea = serializers.CharField(max_length=2000, trim_whitespace=True)


class WangsiDecisionSerializer(serializers.Serializer):
    upheld = serializers.BooleanField()
    note = serializers.CharField(max_length=2000, trim_whitespace=True)
    #: 属实且超度(只与 `upheld=true` 同用):出城到莲花台,免审结案。
    deliver = serializers.BooleanField(required=False, default=False)


class WangsiRefusalSerializer(JudgmentClaimRefusalSerializer):
    grievance_status = serializers.CharField(required=False)
    grievance_level = serializers.CharField(required=False)


_RESPONSES = {200: JudgmentSerializer, 403: WangsiRefusalSerializer, 404: WangsiRefusalSerializer,
              409: WangsiRefusalSerializer}


class WangsiViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, AuditUserViewSetMixin, viewsets.GenericViewSet):
    """本殿枉死的案子上的冤情申诉。"""

    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "judgment"
    extra_permissions = {"grievance": ["judgment.execute"], "decide": ["judgment.execute"]}
    queryset = Judgment.objects.filter(untimely=True)
    serializer_class = JudgmentSerializer

    def _answer(self, run):
        judgment = self.get_object()
        try:
            run(judgment.pk)
        except ClaimRefusedError as exc:  # 超度会结案:结案那一侧的拒绝(同一形状)也原样答复
            return Response(exc.as_payload(), status=exc.status)
        return Response(JudgmentSerializer(Judgment.objects.get(pk=judgment.pk),
                                           context=self.get_serializer_context()).data)

    @extend_schema(request=WangsiGrievanceSerializer, responses=_RESPONSES)
    @action(detail=True, methods=["post"])
    def grievance(self, request, pk=None):
        """提出冤情申诉。不在枉死城 → 409 `not_in_wangsi`;已有未决或已属实的 → 409 `grievance_open`。"""
        body = WangsiGrievanceSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return self._answer(lambda pk: wangsi.file_grievance(pk, request.user, body.validated_data["plea"]))

    @extend_schema(request=WangsiDecisionSerializer, responses=_RESPONSES)
    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        """审核:`upheld=true` 属实即提前释放(冤情等级须为重 / 极重,否则 409 `grievance_not_major`);
        再带 `deliver=true` 是超度:出城到莲花台、免审结案(案子还在城隍处 409 `at_city_god`)。
        阳寿已到或案子已结后仍可审,只记结论(属实记 UPHELD_LATE;此时超度 409 `not_in_wangsi`)。
        没有待审的申诉 → 409 `no_grievance_filed`;不是城隍名下官员也没有 `judgment.assign` → 403。"""
        body = WangsiDecisionSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        return self._answer(lambda pk: wangsi.decide_grievance(pk, request.user, upheld=data["upheld"],
                                                               note=data["note"], deliver=data["deliver"]))


# ── 灵魂 ────────────────────────────────────────────────────────────────


class MeWangsiCaseSerializer(serializers.ModelSerializer):
    """灵魂看的一件枉死的案子:不带城隍名下的官员是谁、不带审核人。"""

    judgment_id = serializers.UUIDField(source="pk", read_only=True)
    #: 此刻还押在枉死城(`wangsi.is_held`):阳寿未到、未提前释放、未结案。
    held = serializers.SerializerMethodField()
    #: 现在能不能提申诉;不能时 `refusal_code` 是原因(`not_pending` / `not_in_wangsi` / `grievance_open`)。
    can_file = serializers.SerializerMethodField()
    refusal_code = serializers.SerializerMethodField()

    class Meta:
        model = Judgment
        fields = ("judgment_id", "case_number", "held_until", "held", "wrongful_death_cause", "grievance_level",
                  "grievance_status", "grievance_plea", "grievance_note", "grievance_decided_at", "can_file",
                  "refusal_code")
        read_only_fields = fields

    def get_held(self, obj) -> bool:
        return wangsi.is_held(obj)

    def get_can_file(self, obj) -> bool:
        return wangsi.filing_refusal(obj) is None

    def get_refusal_code(self, obj) -> str | None:
        refusal = wangsi.filing_refusal(obj)
        return refusal.code if refusal else None


class MeWangsiFileSerializer(serializers.Serializer):
    judgment = serializers.UUIDField()
    plea = serializers.CharField(max_length=2000, trim_whitespace=True)


class MeWangsiView(SoulAPIView):
    def _mine(self):
        account = self.account
        return Judgment.objects.filter(soul_id=account.soul_id, cycle=account.cycle, untimely=True).order_by(
            "-created_at")

    @extend_schema(responses={200: MeWangsiCaseSerializer(many=True), 403: SoulErrorSerializer})
    def get(self, request):
        """本人本世枉死的案子(新的在前)。不是枉死的案子不在这里。"""
        return Response(MeWangsiCaseSerializer(self._mine(), many=True).data)

    @extend_schema(request=MeWangsiFileSerializer,
                   responses={201: MeWangsiCaseSerializer, 403: SoulErrorSerializer, 404: SoulErrorSerializer,
                              409: SoulErrorSerializer})
    def post(self, request):
        """提出冤情申诉。别人的或不是本世的案子 → 404 `not_found`;其余拒绝与官员端相同。"""
        body = MeWangsiFileSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        try:
            judgment = wangsi.file_grievance(data["judgment"], None, data["plea"], account=self.account)
        except wangsi.WangsiRefusedError as exc:
            return Response({"detail": str(exc), "code": exc.code}, status=exc.status)
        return Response(MeWangsiCaseSerializer(self._mine().get(pk=judgment.pk)).data,
                        status=status.HTTP_201_CREATED)
