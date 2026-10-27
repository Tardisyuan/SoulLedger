"""申诉的两组接口(规则在 `apps/judgment/appeals.py`):

* 官员:`/api/v1/judgment/appeals/` —— 本殿的申诉列表 / 详情、认领复核、维持或改判。
  码名沿用审判那一族:看是 `judgment.read`,认领与决定是 `judgment.execute`(与结案同一个)。
* 灵魂:`/api/v1/me/judgment-appeals/` —— 本人本世可申诉的审判、提出、撤回。只从 `self.account` 出发。
"""
from drf_spectacular.utils import extend_schema, extend_schema_field
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.judgment import appeals
from apps.judgment.models import AppealStatus, Judgment, JudgmentAppeal, JudgmentKind, Verdict
from apps.judgment.serializers import JudgmentClaimRefusalSerializer
from apps.soul_accounts.me_views import SoulAPIView
from apps.soul_accounts.serializers import SoulErrorSerializer

# ── 序列化 ──────────────────────────────────────────────────────────────


class AppealCompensationSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    weight = serializers.IntegerField()
    description = serializers.CharField()
    #: 受刑计划里的第几站;原处置(不在计划里)为 null。
    order = serializers.SerializerMethodField()

    def get_order(self, obj) -> int | None:
        return (obj.evidence_json or {}).get("station_order")


class _AppealBase(serializers.ModelSerializer):
    case_number = serializers.CharField(source="judgment.case_number", read_only=True)
    current_verdict = serializers.CharField(source="judgment.verdict", read_only=True)
    judgment_concluded_at = serializers.DateTimeField(source="judgment.concluded_at", read_only=True)
    compensations = serializers.SerializerMethodField()
    #: 上诉到多站申诉流程时的那条流程(编号与状态);一次复核为 null。
    workflow_number = serializers.CharField(source="workflow.number", read_only=True, allow_null=True, default=None)
    workflow_status = serializers.CharField(source="workflow.status", read_only=True, allow_null=True, default=None)
    workflow_name = serializers.CharField(source="workflow.workflow_name", read_only=True, allow_null=True,
                                          default=None)

    FIELDS = ("id", "judgment", "case_number", "round", "reason", "evidence", "status", "original_verdict",
              "new_verdict", "current_verdict", "judgment_concluded_at", "decision_note", "decided_at",
              "create_time", "compensations", "workflow", "workflow_number", "workflow_status", "workflow_name")

    @extend_schema(responses=AppealCompensationSerializer(many=True))
    def get_compensations(self, obj) -> list:
        if obj.status != AppealStatus.AMENDED:
            return []
        return AppealCompensationSerializer(appeals.compensation_records(obj), many=True).data


class JudgmentAppealSerializer(_AppealBase):
    """官员看的:多了灵魂、复核人、认领时间,与原判的判词。"""

    soul_name = serializers.CharField(source="soul.name", read_only=True)
    reviewer_name = serializers.SerializerMethodField()
    judgment_notes = serializers.CharField(source="judgment.notes", read_only=True)
    original_officer_ids = serializers.SerializerMethodField()
    #: 申诉期截止(`appeals.deadline`:第二次申诉从第一次的结论算)。
    deadline = serializers.SerializerMethodField()

    class Meta:
        model = JudgmentAppeal
        fields = (*_AppealBase.FIELDS, "soul", "soul_name", "reviewer", "reviewer_name", "claimed_at",
                  "judgment_notes", "original_officer_ids", "deadline")
        read_only_fields = fields

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_deadline(self, obj):
        return serializers.DateTimeField().to_representation(appeals.deadline(obj.judgment))

    def get_reviewer_name(self, obj) -> str | None:
        return (obj.reviewer.display_name or obj.reviewer.username) if obj.reviewer_id else None

    def get_original_officer_ids(self, obj) -> list[int]:
        """作出原判的官员:界面据此把他的「认领复核」置灰(服务端照样拒,403 `original_judge`)。"""
        return sorted(appeals.original_officers(obj.judgment))


class MeJudgmentAppealSerializer(_AppealBase):
    """灵魂看的:不带复核人是谁(与事件、推送一样不说判官)。"""

    class Meta:
        model = JudgmentAppeal
        fields = _AppealBase.FIELDS
        read_only_fields = fields


class MeAppealableJudgmentSerializer(serializers.Serializer):
    judgment_id = serializers.UUIDField()
    case_number = serializers.CharField()
    verdict = serializers.CharField()
    concluded_at = serializers.DateTimeField()
    deadline = serializers.DateTimeField()
    rounds_used = serializers.IntegerField()
    can_appeal = serializers.BooleanField()
    #: 不能申诉的原因(`appeal_open` / `appeal_rounds_used` / `appeal_window_closed`);能申诉时为 null。
    refusal_code = serializers.CharField(allow_null=True)
    #: 能否上诉到本文明的多站申诉流程(上一轮一次复核维持原判、还有次数)。
    can_escalate = serializers.BooleanField()


class MeJudgmentAppealListSerializer(serializers.Serializer):
    judgments = MeAppealableJudgmentSerializer(many=True)
    results = MeJudgmentAppealSerializer(many=True)


class JudgmentAppealCreateSerializer(serializers.Serializer):
    judgment = serializers.UUIDField()
    reason = serializers.CharField(max_length=2000, trim_whitespace=True)
    evidence = serializers.CharField(max_length=4000, required=False, allow_blank=True, default="")
    #: true:上诉到多站申诉流程(`appeals.escalation_refusal` 的条件),而不是再一次一次复核。
    escalate = serializers.BooleanField(required=False, default=False)


class JudgmentAppealDecideSerializer(serializers.Serializer):
    outcome = serializers.ChoiceField(choices=[AppealStatus.UPHELD, AppealStatus.AMENDED])
    verdict = serializers.ChoiceField(choices=Verdict.choices, required=False)
    note = serializers.CharField(max_length=2000, trim_whitespace=True)
    #: 改判时联审带进来、还没开始的外地站:撤掉(false)还是保留(true)。有这样的站时必填(2026-10-24 用户决定:
    #: 由复审判官在改判时决定),没有时忽略。
    keep_foreign_stops = serializers.BooleanField(required=False, allow_null=True, default=None)

    def validate(self, attrs):
        if attrs["outcome"] == AppealStatus.AMENDED and not attrs.get("verdict"):
            raise serializers.ValidationError({"verdict": "An amended verdict is required."})
        return attrs


# ── 官员 ────────────────────────────────────────────────────────────────

_REFUSALS = {403: JudgmentClaimRefusalSerializer, 404: JudgmentClaimRefusalSerializer,
             409: JudgmentClaimRefusalSerializer}


class JudgmentAppealViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, AuditUserViewSetMixin,
                            mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """本殿的申诉。`?status=PENDING` 是待复核队列;`?status__in=UPHELD,AMENDED` 是「已结案」一个页签。"""

    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "judgment"
    extra_permissions = {"claim": ["judgment.execute"], "decide": ["judgment.execute"]}
    queryset = JudgmentAppeal.objects.select_related("judgment", "soul", "reviewer", "workflow").all()
    serializer_class = JudgmentAppealSerializer
    filterset_fields = {"status": ["exact", "in"]}

    def _answer(self, run):
        appeal = self.get_object()  # 别的殿的申诉在这里就是 404
        try:
            updated = run(appeal.pk)
        except appeals.AppealRefusedError as exc:
            return Response(exc.as_payload(), status=exc.status)
        return Response(self.get_serializer(self.get_queryset().get(pk=updated.pk)).data)

    @extend_schema(request=None, responses={200: JudgmentAppealSerializer, **_REFUSALS})
    @action(detail=True, methods=["post"])
    def claim(self, request, pk=None):
        """认领复核。作出原判的官员 → 403 `original_judge`;别人已认领 → 409 `already_claimed`。"""
        return self._answer(lambda pk: appeals.claim(pk, request.user))

    @extend_schema(request=JudgmentAppealDecideSerializer,
                   responses={200: JudgmentAppealSerializer, 400: JudgmentClaimRefusalSerializer, **_REFUSALS})
    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        """维持(UPHELD)或改判(AMENDED + verdict)。`note` 必填,灵魂看得到。"""
        body = JudgmentAppealDecideSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        return self._answer(lambda pk: appeals.decide(pk, request.user, outcome=data["outcome"], note=data["note"], keep_foreign_stops=data.get("keep_foreign_stops"),
                                                      verdict=data.get("verdict")))


# ── 灵魂 ────────────────────────────────────────────────────────────────


def _soul_error(exc):
    return Response({"detail": str(exc), "code": exc.code}, status=exc.status)


class MeJudgmentAppealsView(SoulAPIView):
    @extend_schema(responses={200: MeJudgmentAppealListSerializer, 403: SoulErrorSerializer})
    def get(self, request):
        account = self.account
        judgments = Judgment.objects.filter(
            soul=account.soul, cycle=account.cycle, kind=JudgmentKind.ORIGINAL, is_final=True,
            verdict__isnull=False,
        ).order_by("-concluded_at")
        rows = []
        for judgment in judgments:
            refusal = appeals.appeal_refusal(judgment, account)
            rows.append({
                "judgment_id": judgment.pk, "case_number": judgment.case_number, "verdict": judgment.verdict,
                "concluded_at": judgment.concluded_at, "deadline": appeals.deadline(judgment),
                "rounds_used": judgment.appeals.filter(is_deleted=False).count(),
                "can_appeal": refusal is None, "refusal_code": refusal.code if refusal else None,
                "can_escalate": refusal is None and appeals.escalation_refusal(judgment, account) is None,
            })
        mine = JudgmentAppeal.objects.filter(soul=account.soul, judgment__cycle=account.cycle).select_related(
            "judgment", "workflow")
        return Response({"judgments": MeAppealableJudgmentSerializer(rows, many=True).data,
                         "results": MeJudgmentAppealSerializer(mine, many=True).data})

    @extend_schema(request=JudgmentAppealCreateSerializer,
                   responses={201: MeJudgmentAppealSerializer, 403: SoulErrorSerializer, 404: SoulErrorSerializer,
                              409: SoulErrorSerializer})
    def post(self, request):
        body = JudgmentAppealCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        try:
            appeal = appeals.file(self.account, data["judgment"], reason=data["reason"], evidence=data["evidence"],
                                  escalate=data["escalate"])
        except appeals.AppealRefusedError as exc:
            return _soul_error(exc)
        return Response(MeJudgmentAppealSerializer(appeal).data, status=status.HTTP_201_CREATED)


class MeJudgmentAppealWithdrawView(SoulAPIView):
    @extend_schema(request=None, responses={200: MeJudgmentAppealSerializer, 404: SoulErrorSerializer,
                                            409: SoulErrorSerializer})
    def post(self, request, appeal_id):
        try:
            appeal = appeals.withdraw(self.account, appeal_id)
        except appeals.AppealRefusedError as exc:
            return _soul_error(exc)
        return Response(MeJudgmentAppealSerializer(appeal).data)
