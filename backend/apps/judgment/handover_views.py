"""官员交接的接口。规则在 `handover.py`。

    POST /api/v1/judgment/handover/preview/   {from, to} → 每类几件 + problems,不写
    POST /api/v1/judgment/handover/           {from, to} → 每类实际移了几件

要 `judgment.assign`(殿管理员、殿主;与改派同一码名)。非 ADMIN 只能交接本殿的官员:别的殿的人与不存在的人
答同一个 404。接手人必须是交出人所在殿的在职官员(400 `invalid_target`)。
"""
from django.contrib.auth import get_user_model
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.tenant import is_tenant_exempt
from apps.judgment import handover

User = get_user_model()


class HandoverRequestSerializer(serializers.Serializer):
    # 预览可不填 `to`:只数件数(停用官员前问一句「他手上还有没有事」,那时还没选接手人)。提交必须填。
    to = serializers.IntegerField(required=False, allow_null=True)


# `from` is a Python keyword, so the body key is declared outside the class body.
HandoverRequestSerializer._declared_fields["from"] = serializers.IntegerField()


class HandoverPreviewSerializer(serializers.Serializer):
    judgments = serializers.IntegerField()
    appeals = serializers.IntegerField()
    appeals_returned_to_pool = serializers.IntegerField(help_text="接手人是原判官员的申诉:退回待复核")
    city_gods = serializers.ListField(child=serializers.CharField())
    letters = serializers.IntegerField()
    problems = serializers.ListField(child=serializers.ChoiceField(["target_cannot_judge", "target_cannot_reply"]))


class HandoverResultSerializer(serializers.Serializer):
    judgments = serializers.IntegerField()
    appeals = serializers.IntegerField()
    appeals_returned_to_pool = serializers.IntegerField()
    city_gods = serializers.IntegerField()
    letters = serializers.IntegerField()


class _HandoverBase(APIView):
    permission_classes = [TenantPermission, CodenamePermission]

    def get_required_permissions(self):
        return ["judgment.assign"]

    def _people(self, request):
        body = HandoverRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        officers = User.objects.exclude(role="SOUL")
        if not is_tenant_exempt(request.user):
            tenant = getattr(request, "tenant", None)
            officers = officers.filter(tenant=tenant) if tenant else officers.none()
        source = officers.filter(pk=body.validated_data["from"], tenant__isnull=False).first()
        if source is None:
            raise NotFound()
        to = body.validated_data.get("to")
        target = User.objects.filter(pk=to).first() if to is not None else None
        return source, target

    def _refused(self, exc):
        return Response(exc.as_payload(), status=exc.status)


class HandoverPreviewView(_HandoverBase):
    @extend_schema(operation_id="judgment_handover_preview", request=HandoverRequestSerializer,
                   responses={200: HandoverPreviewSerializer})
    def post(self, request):
        source, target = self._people(request)
        try:
            return Response(handover.preview(source, target, source.tenant_id))
        except handover.HandoverRefusedError as exc:
            return self._refused(exc)


class HandoverCommitView(_HandoverBase):
    @extend_schema(operation_id="judgment_handover_commit", request=HandoverRequestSerializer,
                   responses={200: HandoverResultSerializer})
    def post(self, request):
        source, target = self._people(request)
        try:
            return Response(handover.commit(source, target, source.tenant_id, actor=request.user, request=request))
        except handover.HandoverRefusedError as exc:
            return self._refused(exc)
