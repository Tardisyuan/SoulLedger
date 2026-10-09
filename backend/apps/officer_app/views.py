"""`/api/v1/officer-app/`:官员端 App 专用的几个接口。

决定本身不在这里 —— 审批节点走 `workflows/<id>/approve_node/`(带 `require_reason: true`),
缩短冷却走 `soul-accounts/cooldown-shortenings/<id>/approve|reject/`,调拨走
`dispatch/records/<id>/approve|reject/`。这里只给「轮到我的有哪些」「这一条还能不能处理」
「加签能选谁」和推送设备。
"""
from django.contrib.auth import get_user_model
from django.db import transaction
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.officer_app import push, todo
from apps.perm.checker import check_permission
from apps.officer_app.serializers import (
    CosignAddSerializer,
    CosignerSerializer,
    CosignRefusalSerializer,
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
        # Only people `cosign.add` would accept (hold workflow.approve): a role without it -- 书吏 and
        # the like, a custom role -- is not offered a row that can only end in `not_eligible`.
        people = [u for u in rows if check_permission(u, "workflow.approve")][:50]
        return Response([{"id": u.pk, "name": u.display_name or u.username, "username": u.username,
                          "role": u.role} for u in people])


class CosignView(OfficerAppBaseView):
    """加签:当前节点的指定审批人,把本殿一位同僚加为联署人(`apps/workflow/cosign.py` 写明规则)。

    403 `not_allowed`:这一条现在不能加签(不是你的节点、节点已被处理、会签节点…)——App 据此置灰;
    400 `not_eligible`:这个人不能被加(不在本殿 / 无审批权 / 已停用…);400 `duplicate`:已是联署人,
    或本来就能单独决定这个节点。留痕:一条审计;被加的人收到通知与官员端推送。
    """

    permission_classes = [TenantPermission, CodenamePermission]

    def get_required_permissions(self):
        return ["workflow.approve"]

    @extend_schema(operation_id="officer_app_cosign_add", request=CosignAddSerializer,
                   responses={201: CosignerSerializer, 400: CosignRefusalSerializer,
                              403: CosignRefusalSerializer, 404: None})
    def post(self, request, kind, item_id):
        from apps.audit.models import AuditAction, AuditLog
        from apps.events.services import EventService
        from apps.workflow import cosign
        from apps.workflow.models import ApprovalNode

        body = CosignAddSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        scope = todo.scope_of(request.user, request)
        workflow = todo.workflow_for(scope, kind, item_id)
        if workflow is None or workflow.current_node_id is None:
            raise NotFound()
        candidate = User.objects.filter(pk=body.validated_data["user_id"]).first()
        try:
            with transaction.atomic():
                node = ApprovalNode.objects.select_for_update().get(pk=workflow.current_node_id)
                if candidate is None:
                    raise cosign.CosignRefusedError(cosign.NOT_ELIGIBLE, "unknown user")
                entry = cosign.add(node, request.user, candidate)
                node.save(update_fields=["cosigners_json"])
                AuditLog.objects.create(
                    tenant=workflow.tenant, user=request.user, action=AuditAction.EXECUTE,
                    resource="workflow.cosign", resource_id=str(workflow.id),
                    description=f"加签:{node.node_name} — {entry['user_name']}"[:500],
                    changes={"node": str(node.id), "node_name": node.node_name, "cosigner_id": candidate.pk,
                             "cosigner": entry["user_name"]},
                    ip_address=request.META.get("REMOTE_ADDR"),
                    user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
                )
        except cosign.CosignRefusedError as refused:
            denied = refused.code == cosign.NOT_ALLOWED
            return Response({"code": refused.code, "detail": refused.detail},
                            status=status.HTTP_403_FORBIDDEN if denied else status.HTTP_400_BAD_REQUEST)
        EventService.notify_workflow_assigned(candidate, workflow)
        push.notify_users([candidate], target={"kind": kind, "id": str(item_id)})
        return Response({k: entry[k] for k in ("user_id", "user_name", "added_at", "signed_at")},
                        status=status.HTTP_201_CREATED)


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
