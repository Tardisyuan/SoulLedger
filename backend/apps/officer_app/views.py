"""`/api/v1/officer-app/`:官员端 App 专用的几个接口。

决定本身不在这里 —— 审批节点走 `workflows/<id>/approve_node/`(带 `require_reason: true`),
缩短冷却走 `soul-accounts/cooldown-shortenings/<id>/approve|reject/`,调拨走
`dispatch/records/<id>/approve|reject/`。这里只给「轮到我的有哪些」「这一条还能不能处理」
「加签能选谁」和推送设备。
"""
from django.contrib.auth import get_user_model
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.officer_app import push, todo
from apps.officer_app.serializers import (
    OfficerPushTokenSerializer,
    OfficerPushUnregisterSerializer,
    SignerCandidateSerializer,
    TodoItemDetailSerializer,
    TodoSerializer,
)
from apps.soul_accounts.authentication import OfficerJWTAuthentication

User = get_user_model()


class OfficerAppBaseView(APIView):
    """只认官员令牌(灵魂令牌在认证层就被挡),并要求有租户。"""

    authentication_classes = [OfficerJWTAuthentication]
    permission_classes = [TenantPermission]


class TodoView(OfficerAppBaseView):
    @extend_schema(operation_id="officer_app_todo", responses=TodoSerializer)
    def get(self, request):
        """「待我处理」四组:审批节点 / 改派请求 / 缩短冷却申请 / 转生申请,每组计数 + 前 10 条。"""
        return Response(todo.build(request.user, request))


class TodoItemView(OfficerAppBaseView):
    @extend_schema(operation_id="officer_app_todo_item", responses={200: TodoItemDetailSerializer, 404: None})
    def get(self, request, kind, item_id):
        """一条的详情:`actionable` 说我现在还能不能处理;已被处理时 `handled_by` 说是谁。"""
        data = todo.detail(request.user, kind, item_id, request)
        if data is None:
            raise NotFound()
        return Response(data)


class SignerCandidatesView(OfficerAppBaseView):
    """加签候选人。**只限本殿**(2026-10-09 用户决定:跨殿加签留给官员台)。"""

    permission_classes = [TenantPermission, CodenamePermission]

    def get_required_permissions(self):
        return ["workflow.approve"]

    @extend_schema(operation_id="officer_app_signer_candidates",
                   parameters=[OpenApiParameter("q", str, description="用户名或显示名包含")],
                   responses=SignerCandidateSerializer(many=True))
    def get(self, request):
        tenant_id = request.user.tenant_id
        if tenant_id is None:
            return Response([])
        rows = (User.objects.filter(tenant_id=tenant_id, is_active=True).exclude(role="SOUL")
                .exclude(pk=request.user.pk).order_by("display_name", "username"))
        q = (request.query_params.get("q") or "").strip()
        if q:
            from django.db.models import Q

            rows = rows.filter(Q(username__icontains=q) | Q(display_name__icontains=q))
        return Response([{"id": u.pk, "name": u.display_name or u.username, "username": u.username,
                          "role": u.role} for u in rows[:50]])


class PushTokenView(OfficerAppBaseView):
    @extend_schema(operation_id="officer_app_push_register", request=OfficerPushTokenSerializer,
                   responses={200: None, 201: None, 400: OpenApiResponse(description="token 格式不对")})
    def post(self, request):
        body = OfficerPushTokenSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        _, created = push.register_device(request.user, **body.validated_data)
        return Response(status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class PushTokenUnregisterView(OfficerAppBaseView):
    @extend_schema(operation_id="officer_app_push_unregister", request=OfficerPushUnregisterSerializer,
                   responses={204: None})
    def post(self, request):
        """204 与 token 是否存在、属于谁无关。"""
        body = OfficerPushUnregisterSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        push.unregister_device(request.user, body.validated_data["token"])
        return Response(status=status.HTTP_204_NO_CONTENT)
