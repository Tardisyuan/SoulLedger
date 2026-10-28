"""`/api/v1/judgment/wangsi/{id}/grievance/` 与 `…/decide/`:枉死城的冤情申诉(规则在 `apps/judgment/wangsi.py`)。

两个动作都要 `judgment.execute`;审核另要是这件案子城隍名下的官员或持 `judgment.assign`(服务里查)。
只看得到本殿枉死的案子(别的是 404)。答复是整件审判(`JudgmentSerializer`),审判台直接换上。
"""
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.judgment import wangsi
from apps.judgment.models import Judgment
from apps.judgment.serializers import JudgmentClaimRefusalSerializer, JudgmentSerializer


class WangsiGrievanceSerializer(serializers.Serializer):
    plea = serializers.CharField(max_length=2000, trim_whitespace=True)


class WangsiDecisionSerializer(serializers.Serializer):
    upheld = serializers.BooleanField()
    note = serializers.CharField(max_length=2000, trim_whitespace=True)


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
        except wangsi.WangsiRefusedError as exc:
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
        """审核:`upheld=true` 属实即提前释放(冤情等级须为重 / 极重,否则 409 `grievance_not_major`)。
        没有待审的申诉 → 409 `no_grievance_filed`;不是城隍名下官员也没有 `judgment.assign` → 403。"""
        body = WangsiDecisionSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        return self._answer(lambda pk: wangsi.decide_grievance(pk, request.user, upheld=data["upheld"],
                                                               note=data["note"]))
