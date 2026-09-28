"""`/api/v1/me/assist/`(docs/ARCHITECTURE-soul-assist.md §4.3)。全部继承 `SoulAPIView`:
只认灵魂令牌,所有查询从 `self.account` 出发。"""
import math
from datetime import timedelta

from django.db.models import Prefetch
from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status, throttling
from rest_framework.response import Response

from apps.core.locale import locale_from_request
from apps.core.throttling import ClientIPIdentMixin
from apps.soul_accounts.me_views import SoulAPIView
from apps.soul_assist import service
from apps.soul_assist.models import AssistConversation, AssistMessage
from apps.soul_assist.serializers import (
    AssistAnswerSerializer,
    AssistAskSerializer,
    AssistConversationSerializer,
    AssistErrorSerializer,
    AssistMessageSerializer,
)


class AssistThrottle(ClientIPIdentMixin, throttling.UserRateThrottle):
    """按灵魂账号计;速率在 `DEFAULT_THROTTLE_RATES["assist"]`。同 `ChatLookupThrottle`。"""

    scope = "assist"


class AssistView(SoulAPIView):
    def handle_exception(self, exc):
        if isinstance(exc, service.AssistError):
            body = {"detail": str(exc), "code": exc.code}
            retry_at = getattr(exc, "retry_at", None)
            if retry_at is not None:
                body["retry_at"] = retry_at.isoformat()
            return Response(body, status=exc.status)
        return super().handle_exception(exc)


class MeAssistView(AssistView):
    throttle_classes = [AssistThrottle]

    def throttled(self, request, wait):
        # DRF 默认的 429 体没有 `code`;App 按 code 分支。
        error = service.AssistError("提问太频繁,请稍后再问。", "rate_limited", 429)
        error.retry_at = timezone.now() + timedelta(seconds=math.ceil(wait or 0))
        raise error

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
        rows = (AssistConversation.objects.filter(account=self.account)
                .prefetch_related(Prefetch("messages", queryset=AssistMessage.objects.order_by("created_at", "id"))))
        return Response(AssistConversationSerializer(rows, many=True).data)


class MeAssistConversationDetailView(AssistView):
    @extend_schema(request=None, responses={204: None, 403: AssistErrorSerializer, 404: AssistErrorSerializer})
    def delete(self, request, conversation_id):
        service.delete_conversation(self.account, conversation_id, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)
