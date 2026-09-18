"""灵魂端 `/api/v1/me/chat/` 与官员端 `/api/v1/chat/inbox/`。

灵魂侧全部继承 `SoulAPIView`:只认灵魂令牌、只认当前(未停用)账号、首登改密前拒绝 ——
`tests/test_soul_auth_boundary.py::test_every_me_route_is_a_soul_api_view` 走真实 URLconf 钉住。

官员侧走 `TenantPermission + CodenamePermission` 与 `scope_to_tenant`,和别的官员接口一样。
**官员没有 Matrix 身份**:收件箱的官员一侧是服务账号,回复经这里代发,谁回的记在事件字段
与审计里。这样官员不必被拉进 Matrix,也不会出现在灵魂之间的房间里(用户决定)。

聊天没启用(`MATRIX_ENABLED=False`)时每条路由都是 **503**,不是 500:那不是故障,
是这套环境没部署 Synapse。
"""
from django.db.models import Q
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.chat import services as svc
from apps.chat.matrix import MatrixError, MatrixNotConfigured
from apps.chat.models import Conversation, ConversationKind
from apps.chat.serializers import (
    ChatErrorSerializer,
    ChatSessionSerializer,
    ConversationCreateSerializer,
    ConversationSerializer,
    InboxMessageSerializer,
    MessageSendSerializer,
    MessageSentSerializer,
    OfficerInboxSerializer,
    OfficerReplySerializer,
)
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.tenant import scope_to_tenant
from apps.core.viewsets import CodenameViewSetMixin
from apps.soul_accounts.me_views import SoulAPIView


def _error(exc):
    response = Response({"detail": str(exc), "code": exc.code}, status=exc.status)
    retry_at = getattr(exc, "retry_at", None)
    if retry_at is not None:
        response.data["retry_at"] = retry_at.isoformat()
    return response


def _unavailable(exc):
    """Synapse 没配 / 连不上。两者都不是调用者的错,所以是 503 而不是 4xx 也不是 500。"""
    code = "chat_not_configured" if isinstance(exc, MatrixNotConfigured) else "chat_unavailable"
    return Response({"detail": str(exc), "code": code},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE)


class ChatView(SoulAPIView):
    """把两类异常翻成响应,省得每个方法各写一遍 try。"""

    def handle_exception(self, exc):
        if isinstance(exc, svc.ChatError):
            return _error(exc)
        if isinstance(exc, MatrixError):
            return _unavailable(exc)
        return super().handle_exception(exc)


class MeChatSessionView(ChatView):
    @extend_schema(responses={200: ChatSessionSerializer, 403: ChatErrorSerializer,
                              503: ChatErrorSerializer})
    def get(self, request):
        return Response(svc.chat_session(self.account))


class MeChatConversationsView(ChatView):
    @extend_schema(responses={200: ConversationSerializer(many=True), 403: ChatErrorSerializer})
    def get(self, request):
        soul_id = self.account.soul_id
        rows = Conversation.objects.filter(
            Q(soul_a_id=soul_id) | Q(soul_b_id=soul_id)
        ).select_related("soul_a", "soul_b", "tenant")
        return Response(ConversationSerializer(rows, many=True, context={"soul_id": soul_id}).data)

    @extend_schema(request=ConversationCreateSerializer,
                   responses={200: ConversationSerializer, 201: ConversationSerializer,
                              403: ChatErrorSerializer, 409: ChatErrorSerializer,
                              503: ChatErrorSerializer})
    def post(self, request):
        from apps.souls.models import Soul

        body = ConversationCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        account = self.account
        if body.validated_data["kind"] == ConversationKind.OFFICER_INBOX:
            conversation, created = svc.open_officer_inbox(account, request=request)
        else:
            # 只在**当前所在**文明里找对方:跨文明在 open_direct 里也会被拒,这里先一层
            # 是为了不把「这个灵魂存在吗」答成和「他在哪个文明」不同的两种错误。
            target = Soul.objects.filter(
                pk=body.validated_data["target_soul"], tenant_id=account.soul.tenant_id
            ).first()
            if target is None:
                raise svc.ChatError("找不到这个灵魂。", "not_found", status=404)
            conversation, created = svc.open_direct(account, target, request=request)
        return Response(
            ConversationSerializer(conversation, context={"soul_id": account.soul_id}).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class MeChatMessagesView(ChatView):
    """被节流的私聊、以及殿司收件箱的发送口。

    **互关(或已解除节流)的私聊不走这里** —— 那种房间灵魂直接用 Matrix 发,后端不在
    消息路径上。这里照样接受,因为客户端不必分两条路;服务层判断之后仍然代发一次。
    """

    @extend_schema(request=MessageSendSerializer,
                   responses={201: MessageSentSerializer, 403: ChatErrorSerializer,
                              409: ChatErrorSerializer, 429: ChatErrorSerializer,
                              503: ChatErrorSerializer})
    def post(self, request, conversation_id):
        body = MessageSendSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        account = self.account
        conversation = Conversation.objects.filter(pk=conversation_id).first()
        if conversation is None or (
            conversation.soul_a_id != account.soul_id and conversation.soul_b_id != account.soul_id
        ):
            raise svc.ChatError("会话不存在。", "not_found", status=404)
        if conversation.kind == ConversationKind.OFFICER_INBOX:
            event_id = svc.send_inbox_message(account, conversation, body.validated_data["body"],
                                              request=request)
        else:
            event_id = svc.send_request_message(account, conversation, body.validated_data["body"],
                                                request=request)
        return Response({"event_id": event_id}, status=status.HTTP_201_CREATED)


class OfficerInboxViewSet(CodenameViewSetMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                          viewsets.GenericViewSet):
    """`/api/v1/chat/inbox/` —— 灵魂写给殿司的信。

    租户隔离走 `scope_to_tenant` 的**直接 tenant 列**:收件人就是那一列,而它在灵魂
    暂居结束回归原文明之后不会改变(见 `apps/chat/models.py` 的注释)。所以一个殿司
    永远只看得见写给自己的那些,包括当初暂居在这里的灵魂写的。
    """

    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "soul_inbox"
    extra_permissions = {
        "list": ["soul_inbox.read"],
        "retrieve": ["soul_inbox.read"],
        "messages": ["soul_inbox.read"],
        "reply": ["soul_inbox.reply"],
    }
    serializer_class = OfficerInboxSerializer
    queryset = Conversation.objects.filter(kind=ConversationKind.OFFICER_INBOX)
    filterset_fields = ["soul_a"]

    def get_queryset(self):
        qs = Conversation.objects.filter(kind=ConversationKind.OFFICER_INBOX).select_related(
            "soul_a", "tenant"
        )
        return scope_to_tenant(qs, self.request)

    @extend_schema(responses={200: InboxMessageSerializer(many=True), 503: ChatErrorSerializer})
    @action(detail=True, methods=["get"])
    def messages(self, request, pk=None):
        conversation = self.get_object()
        try:
            rows = svc.officer_messages(conversation)
        except MatrixError as exc:
            return _unavailable(exc)
        return Response(InboxMessageSerializer(rows, many=True).data)

    @extend_schema(request=OfficerReplySerializer,
                   responses={201: MessageSentSerializer, 409: ChatErrorSerializer,
                              503: ChatErrorSerializer})
    @action(detail=True, methods=["post"])
    def reply(self, request, pk=None):
        conversation = self.get_object()
        body = OfficerReplySerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            event_id = svc.officer_reply(conversation, request.user, body.validated_data["body"],
                                         request=request)
        except svc.ChatError as exc:
            return _error(exc)
        except MatrixError as exc:
            return _unavailable(exc)
        return Response({"event_id": event_id}, status=status.HTTP_201_CREATED)
