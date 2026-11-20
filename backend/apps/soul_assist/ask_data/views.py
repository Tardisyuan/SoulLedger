"""`POST /api/v1/ask-data/ {"question": "…"}`:官员问本殿的数据(docs/ARCHITECTURE-ask-data.md §2)。

官员令牌、`judgment.read`、殿只来自 `request.tenant`。这里不碰 ORM:读库的只有执行器,走只读角色的连接,
租户由库里的 RLS 与 `request.tenant` 保证(ADR 0007),不经 `scope_to_tenant`。
"""
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.response import Response

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.problems import problem
from apps.soul_assist.ask_data import service
from apps.soul_assist.serializers import AssistErrorSerializer
from apps.soul_assist.views import OfficerAssistBaseView, OfficerAssistThrottle


class AskDataRequestSerializer(serializers.Serializer):
    question = serializers.CharField(max_length=service.MAX_QUESTION, trim_whitespace=True)


class AskDataResultSerializer(serializers.Serializer):
    sql = serializers.CharField()
    columns = serializers.ListField(child=serializers.CharField())
    rows = serializers.ListField(child=serializers.ListField(child=serializers.JSONField()))
    truncated = serializers.BooleanField()
    elapsed_ms = serializers.IntegerField()


class AskDataErrorSerializer(AssistErrorSerializer):
    #: 闸门或执行器拒掉的那条 SQL(400 时有;模型没出 SQL 时是空串)。
    sql = serializers.CharField(required=False)


class AskDataView(OfficerAssistBaseView):
    permission_classes = [TenantPermission, CodenamePermission]
    throttle_classes = [OfficerAssistThrottle]

    def get_required_permissions(self):
        return ["judgment.read"]

    @extend_schema(operation_id="ask_data", request=AskDataRequestSerializer,
                   responses={200: AskDataResultSerializer, 400: AskDataErrorSerializer,
                              403: AskDataErrorSerializer, 409: AskDataErrorSerializer,
                              429: AskDataErrorSerializer, 503: AskDataErrorSerializer})
    def post(self, request):
        body = AskDataRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            return Response(service.ask(request, body.validated_data["question"]))
        except service.AskDataError as exc:
            extra = {} if exc.sql is None else {"sql": exc.sql}
            return problem(exc.status, exc.code, exc.code, **extra)
