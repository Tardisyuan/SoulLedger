"""两套接口,同一个服务层(docs/ARCHITECTURE-officer-assist.md §1):

- `/api/v1/me/assist/`(docs/ARCHITECTURE-soul-assist.md §4.3):继承 `SoulAPIView`,
  只认灵魂令牌,所有查询从 `self.account` 出发;
- `/api/v1/assist/`:只认官员令牌(`OfficerJWTAuthentication`),`TenantPermission` 要求
  非 ADMIN 必须解析出殿(无殿即 403,同 `scope_to_tenant` 的失败即关);所有查询从
  `request.user` 出发。不要求额外权限码:能登录即能问,数据由工具按权限码把关。
"""
import math
from datetime import timedelta

from django.db.models import Prefetch
from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status, throttling
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.locale import locale_from_request
from apps.core.permissions import TenantPermission
from apps.core.throttling import ClientIPIdentMixin
from apps.soul_accounts.authentication import OfficerJWTAuthentication
from apps.soul_accounts.me_views import SoulAPIView
from apps.soul_assist import config, service, usage
from apps.soul_assist.models import AssistConversation, AssistMessage
from apps.soul_assist.serializers import (
    AssistAnswerSerializer,
    AssistAskSerializer,
    AssistConversationSerializer,
    AssistErrorSerializer,
    AssistMessageSerializer,
    OfficerAssistAskSerializer,
    OfficerAssistConversationSerializer,
)


class AssistThrottle(ClientIPIdentMixin, throttling.UserRateThrottle):
    """按灵魂账号计。速率是生效配置(管理页可改,没改过就是 `DEFAULT_THROTTLE_RATES["assist"]`)。"""

    scope = "assist"
    side = "soul"

    def get_rate(self):
        return config.effective().rate(self.side)


class OfficerAssistThrottle(AssistThrottle):
    """按官员账号计。两端的每殿开关共用(Q3 = A),每小时次数在管理页上各一个数;
    没改过时两端都是 `DEFAULT_THROTTLE_RATES["assist"]`。"""

    scope = "assist_officer"
    side = "officer"


class _AssistErrors:
    """`AssistError` 与节流都答 `{detail, code}`:App 与 Web 按 code 分支(DRF 默认的 429 体没有 code)。"""

    def handle_exception(self, exc):
        if isinstance(exc, service.AssistError):
            body = {"detail": str(exc), "code": exc.code}
            retry_at = getattr(exc, "retry_at", None)
            if retry_at is not None:
                body["retry_at"] = retry_at.isoformat()
            return Response(body, status=exc.status)
        return super().handle_exception(exc)

    def throttled(self, request, wait):
        if isinstance(self, OfficerAssistBaseView):
            usage.record("officer", getattr(request, "tenant", None), "rate_limited")
        else:
            soul = getattr(getattr(self, "account", None), "soul", None)
            usage.record("soul", soul and (soul.home_tenant or soul.tenant), "rate_limited")
        error = service.AssistError("提问太频繁,请稍后再问。", "rate_limited", 429)
        error.retry_at = timezone.now() + timedelta(seconds=math.ceil(wait or 0))
        raise error


class AssistView(_AssistErrors, SoulAPIView):
    pass


class MeAssistView(AssistView):
    throttle_classes = [AssistThrottle]

    @extend_schema(request=AssistAskSerializer,
                   responses={200: AssistAnswerSerializer, 400: OpenApiResponse(description="字段校验失败"),
                              403: AssistErrorSerializer, 404: AssistErrorSerializer,
                              429: AssistErrorSerializer, 503: AssistErrorSerializer})
    def post(self, request):
        body = AssistAskSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        conversation, reply = service.answer(
            self.account, data["question"], data["screen"], locale=locale_from_request(request),
            conversation_id=data.get("conversation_id"), request=request,
        )
        return Response({"conversation_id": conversation.pk, "answer": AssistMessageSerializer(reply).data})


class MeAssistConversationsView(AssistView):
    @extend_schema(responses={200: AssistConversationSerializer(many=True), 403: AssistErrorSerializer})
    def get(self, request):
        rows = (AssistConversation.objects.filter(account=self.account, is_eval=False)
                .prefetch_related(Prefetch("messages", queryset=AssistMessage.objects.order_by("created_at", "id"))))
        return Response(AssistConversationSerializer(rows, many=True).data)


class MeAssistConversationDetailView(AssistView):
    @extend_schema(request=None, responses={204: None, 403: AssistErrorSerializer, 404: AssistErrorSerializer})
    def delete(self, request, conversation_id):
        service.delete_conversation(self.account, conversation_id, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


# ── 官员端 /api/v1/assist/ ────────────────────────────────────────────────


class OfficerAssistBaseView(_AssistErrors, APIView):
    authentication_classes = [OfficerJWTAuthentication]
    permission_classes = [TenantPermission]


class OfficerAssistView(OfficerAssistBaseView):
    throttle_classes = [OfficerAssistThrottle]

    @extend_schema(operation_id="officer_assist_ask", request=OfficerAssistAskSerializer,
                   responses={200: AssistAnswerSerializer, 400: OpenApiResponse(description="字段校验失败"),
                              403: AssistErrorSerializer, 404: AssistErrorSerializer,
                              429: AssistErrorSerializer, 503: AssistErrorSerializer})
    def post(self, request):
        body = OfficerAssistAskSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        conversation, reply = service.officer_answer(
            request, data["question"], data["screen"], locale=locale_from_request(request),
            conversation_id=data.get("conversation_id"),
        )
        return Response({"conversation_id": conversation.pk, "answer": AssistMessageSerializer(reply).data})


class OfficerAssistConversationsView(OfficerAssistBaseView):
    @extend_schema(operation_id="officer_assist_conversations_list",
                   responses={200: OfficerAssistConversationSerializer(many=True), 403: AssistErrorSerializer})
    def get(self, request):
        rows = (AssistConversation.objects.filter(user=request.user, is_eval=False)
                .prefetch_related(Prefetch("messages", queryset=AssistMessage.objects.order_by("created_at", "id"))))
        return Response(OfficerAssistConversationSerializer(rows, many=True).data)


class OfficerAssistConversationDetailView(OfficerAssistBaseView):
    @extend_schema(operation_id="officer_assist_conversation_delete", request=None,
                   responses={204: None, 403: AssistErrorSerializer, 404: AssistErrorSerializer})
    def delete(self, request, conversation_id):
        service.officer_delete_conversation(request, conversation_id)
        return Response(status=status.HTTP_204_NO_CONTENT)
