"""灵魂端 `/api/v1/me/chat/` 与官员端 `/api/v1/chat/inbox/`。

灵魂侧全部继承 `SoulAPIView`:只认灵魂令牌、只认当前(未停用)账号、首登改密前拒绝 ——
`tests/test_soul_auth_boundary.py::test_every_me_route_is_a_soul_api_view` 走真实 URLconf 钉住。

官员侧走 `TenantPermission + CodenamePermission` 与 `scope_to_tenant`,和别的官员接口一样。
**官员没有 Matrix 身份**:收件箱的官员一侧是服务账号,回复经这里代发,谁回的记在事件字段
与审计里。这样官员不必被拉进 Matrix,也不会出现在灵魂之间的房间里(用户决定)。

聊天没启用(`MATRIX_ENABLED=False`)时每条路由都是 **503**,不是 500:那不是故障,
是这套环境没部署 Synapse。
"""
import math
from datetime import timedelta

from django.db.models import F, Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, throttling, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.chat import services as svc
from apps.chat.matrix import MatrixError, MatrixNotConfiguredError
from apps.chat.models import Conversation, ConversationKind
from apps.chat.serializers import (
    ChatErrorSerializer,
    ChatLookupSerializer,
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
from apps.core.throttling import ClientIPIdentMixin
from apps.core.viewsets import CodenameViewSetMixin
from apps.social.soul_serializers import SoulCardSerializer
from apps.soul_accounts.me_views import SoulAPIView


def _error(exc):
    response = Response({"detail": str(exc), "code": exc.code}, status=exc.status)
    retry_at = getattr(exc, "retry_at", None)
    if retry_at is not None:
        response.data["retry_at"] = retry_at.isoformat()
    return response


def _unavailable(exc):
    """Synapse 没配 / 连不上。两者都不是调用者的错,所以是 503 而不是 4xx 也不是 500。"""
    code = "chat_not_configured" if isinstance(exc, MatrixNotConfiguredError) else "chat_unavailable"
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
            Q(soul_a_id=soul_id) | Q(soul_b_id=soul_id), closed_at__isnull=True
        ).select_related("soul_a", "soul_b", "tenant")
        context = {"soul_id": soul_id, "account": self.account}
        return Response(ConversationSerializer(rows, many=True, context=context).data)

    @extend_schema(request=ConversationCreateSerializer,
                   responses={200: ConversationSerializer, 201: ConversationSerializer,
                              403: ChatErrorSerializer, 409: ChatErrorSerializer,
                              503: ChatErrorSerializer})
    def post(self, request):
        from apps.authentication.models import User

        body = ConversationCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        account = self.account
        if body.validated_data["kind"] == ConversationKind.OFFICER_INBOX:
            conversation, created = svc.open_officer_inbox(account, request=request)
        else:
            # 存在与否、是否同文明,由 open_direct 按朋友圈搜索的同一个集合判断 —— 这里只取行。
            target = User.objects.filter(pk=body.validated_data["target_user"]).first()
            if target is None:
                raise svc.ChatError("找不到这个灵魂。", "not_found", status=404)
            conversation, created = svc.open_direct(account, target, request=request)
        return Response(
            ConversationSerializer(conversation, context={"soul_id": account.soul_id, "account": account}).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class ChatLookupThrottle(ClientIPIdentMixin, throttling.UserRateThrottle):
    """按灵魂账号(本世 User)计数;速率在 `DEFAULT_THROTTLE_RATES["chat_lookup"]`。
    未认证时 DRF 会退回按来源地址 —— 那条路走 `ClientIPIdentMixin`,不信客户端自报的 XFF。
    (这个视图要求灵魂令牌,节流在认证与权限之后才跑,所以实际上总是按账号。)"""

    scope = "chat_lookup"


class MeChatLookupView(ChatView):
    """`POST /me/chat/lookup/`:按完整灵魂编号找一个可私聊的灵魂,跨文明。

    返回朋友圈同一张名片(`SoulCardSerializer` 的白名单:user_id、显示名、头像、is_active)——
    **编号不回显**、UUID 不出库。拿到 `user_id` 之后走 `POST /me/chat/conversations/`,
    互关与 24 小时请求的规则都在那里,这里不另开一套。被禁言的灵魂可以查,发起时照旧 403 `muted`。
    """

    throttle_classes = [ChatLookupThrottle]

    def throttled(self, request, wait):
        # DRF 默认的 429 体没有 `code`;App 按 code 分支,所以翻成与聊天其余拒绝同一形状。
        error = svc.ChatError("查找太频繁,请稍后再试。", "rate_limited", status=429)
        error.retry_at = timezone.now() + timedelta(seconds=math.ceil(wait or 0))
        raise error

    @extend_schema(request=ChatLookupSerializer,
                   responses={200: SoulCardSerializer, 403: ChatErrorSerializer,
                              404: ChatErrorSerializer, 429: ChatErrorSerializer})
    def post(self, request):
        body = ChatLookupSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        target = svc.find_by_soul_code(self.account, body.validated_data["soul_code"])
        return Response(SoulCardSerializer(target).data)


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
        conversation = Conversation.objects.filter(pk=conversation_id).select_related("tenant").first()
        if conversation is None or (
            conversation.soul_a_id != account.soul_id and conversation.soul_b_id != account.soul_id
        ):
            raise svc.ChatError("会话不存在。", "not_found", status=404)
        if conversation.kind == ConversationKind.OFFICER_INBOX:
            event_id = svc.send_inbox_message(account, conversation, body.validated_data["body"],
                                              request=request)
        else:
            event_id = svc.send_direct_message(account, conversation, body.validated_data["body"],
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
        # 最近来信在前;从没来过信的排最后(PostgreSQL 的 DESC 默认把 NULL 放在最前)。
        qs = Conversation.objects.filter(kind=ConversationKind.OFFICER_INBOX).select_related(
            "soul_a", "tenant"
        ).order_by(F("last_message_at").desc(nulls_last=True), "-created_at")
        return scope_to_tenant(qs, self.request)

    @extend_schema(responses={200: InboxMessageSerializer(many=True), 503: ChatErrorSerializer})
    @action(detail=True, methods=["get"], pagination_class=None)
    def messages(self, request, pk=None):
        conversation = self.get_object()
        try:
            rows = svc.officer_messages(conversation, request.user, request=request)
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
