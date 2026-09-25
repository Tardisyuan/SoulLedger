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

from django.conf import settings
from django.core.cache import cache
from django.db.models import F, Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, serializers, status, throttling, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.chat import hook, inbox
from apps.chat import services as svc
from apps.chat.matrix import MatrixError, MatrixNotConfiguredError
from apps.chat.models import Conversation, ConversationKind, InboxReplyTemplate
from apps.chat.serializers import (
    ChatErrorSerializer,
    ChatLookupSerializer,
    ChatSessionSerializer,
    ConversationCreateSerializer,
    ConversationSerializer,
    InboxDraftSerializer,
    InboxFoldersSerializer,
    InboxMessageSerializer,
    InboxReplyTemplateSerializer,
    InboxStateSerializer,
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
        """**这一世**参与的会话,包括已闭的(只读,带 `closed_at`)。按账号筛,不按灵魂:
        新一世看不见前世的会话,前世那一个账号也不会因为灵魂转世而多看见什么。"""
        account = self.account
        rows = Conversation.objects.filter(
            Q(account_a=account) | Q(account_b=account)
        ).select_related(*svc.ACCOUNT_JOINS, "tenant")
        context = {"soul_id": account.soul_id, "account": account}
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

    带 `txn_id` 的重发(App 丢了响应、或重启后续送)回第一次的 event_id,不再发。
    不能交给 Synapse 去重:后端代发不带客户端的设备,而被节流的房间里重发会先撞上
    24 小时限制,答 429 —— 信其实已经送到。
    ponytail: 同一个 txn_id 的两个请求**同时**到达仍可能各发一条;App 同一封信不并发送。
    """

    TXN_TTL_SECONDS = 7 * 24 * 3600  # 发件箱在本机可以躺过重启与断网,比 Synapse 的 30–60 分钟长得多

    @extend_schema(request=MessageSendSerializer,
                   responses={201: MessageSentSerializer, 403: ChatErrorSerializer,
                              409: ChatErrorSerializer, 429: ChatErrorSerializer,
                              503: ChatErrorSerializer})
    def post(self, request, conversation_id):
        body = MessageSendSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        account = self.account
        conversation = Conversation.objects.filter(pk=conversation_id).select_related("tenant").first()
        # 按这一世的账号认参与方:同一个灵魂的新一世对前世的会话答 404(不是 409 closed ——
        # 那会说出「这个会话存在」)。
        if conversation is None or not conversation.has_account(account.pk):
            raise svc.ChatError("会话不存在。", "not_found", status=404)
        txn_id = body.validated_data.get("txn_id")
        txn_key = f"chat:txn:{account.pk}:{conversation.pk}:{txn_id}" if txn_id else None
        if txn_key and (sent := cache.get(txn_key)):
            return Response({"event_id": sent}, status=status.HTTP_201_CREATED)
        if conversation.kind == ConversationKind.OFFICER_INBOX:
            event_id = svc.send_inbox_message(account, conversation, body.validated_data["body"],
                                              request=request)
        else:
            event_id = svc.send_direct_message(account, conversation, body.validated_data["body"],
                                               request=request)
        if txn_key:
            cache.set(txn_key, event_id, self.TXN_TTL_SECONDS)
        return Response({"event_id": event_id}, status=status.HTTP_201_CREATED)


class ChatPushHookView(APIView):
    """`POST /api/v1/chat/hooks/new-message/` —— Synapse 模块在新消息落库后回调这里。

    **不认任何令牌,只认签名**(`apps/chat/hook.py`,密钥即 grant_secret = `MATRIX_JWT_SECRET`)。
    签名不对 403、没启用聊天 503:两种都不写任何东西。收件人由会话定(`services.notify_new_message`),
    回调里的字段只用来找会话与发送者,伪造不出「推给谁」。

    这是内部接口,不进 OpenAPI(App 与 Web 都不调它)。回调失败不影响消息本身:
    Synapse 在消息落库之后才调,模块把它放进后台进程,异常只记日志。
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    @extend_schema(exclude=True)
    def post(self, request):
        if not settings.MATRIX_ENABLED or not settings.MATRIX_JWT_SECRET:
            return Response({"detail": "聊天未启用。", "code": "chat_not_configured"},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if not hook.verify(settings.MATRIX_JWT_SECRET, request.data):
            return Response({"detail": "签名无效。", "code": "bad_signature"}, status=status.HTTP_403_FORBIDDEN)
        ids = svc.notify_new_message(request.data["room_id"], request.data["event_id"], request.data["sender"])
        return Response({"queued": len(ids)})


class InboxListQuerySerializer(serializers.Serializer):
    """列表的查询参数。文件夹的定义在 `apps/chat/inbox.py`。"""

    folder = serializers.ChoiceField(choices=inbox.FOLDERS, default="all", required=False)
    status = serializers.ChoiceField(choices=["open", "closed"], required=False,
                                     help_text="`open` 往来中 / `closed` 已关闭(灵魂已转世)。")
    hall = serializers.IntegerField(required=False, min_value=1, help_text="收件殿司(租户 id)。")


class OfficerInboxViewSet(CodenameViewSetMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                          viewsets.GenericViewSet):
    """`/api/v1/chat/inbox/` —— 灵魂写给殿司的信。

    租户隔离走 `scope_to_tenant` 的**直接 tenant 列**:收件人就是那一列,而它在灵魂
    暂居结束回归原文明之后不会改变(见 `apps/chat/models.py` 的注释)。所以一个殿司
    永远只看得见写给自己的那些,包括当初暂居在这里的灵魂写的。

    未读、归档、草稿是**调用者自己的**(`apps/chat/inbox.py`):每一行上的 `unread` / `archived` /
    `has_draft` 是对调用者那一行 `InboxOfficerState` 的子查询。列表按 `folder=` 切,分页照
    全站默认(`PageNumberPagination`,每页 20)。
    """

    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "soul_inbox"
    extra_permissions = {
        "list": ["soul_inbox.read"],
        "retrieve": ["soul_inbox.read"],
        "messages": ["soul_inbox.read"],
        "folders": ["soul_inbox.read"],
        "read": ["soul_inbox.read"],
        "archive": ["soul_inbox.read"],
        "unarchive": ["soul_inbox.read"],
        # 草稿是没发出的回复:读、写、清都要能回复。
        "draft": ["soul_inbox.read", "soul_inbox.reply"],
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
        return inbox.annotate_for(scope_to_tenant(qs, self.request), self.request.user)

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        if self.action != "list":
            return queryset
        params = InboxListQuerySerializer(data=self.request.query_params)
        params.is_valid(raise_exception=True)
        query = params.validated_data
        folder = query.get("folder", "all")
        queryset = queryset.filter(inbox.folder_q(folder))
        if query.get("status") == "open":
            queryset = queryset.filter(closed_at__isnull=True)
        elif query.get("status") == "closed":
            queryset = queryset.filter(closed_at__isnull=False)
        if query.get("hall"):
            queryset = queryset.filter(tenant_id=query["hall"])
        if folder == "awaiting_reply":
            # 设计稿 C · 09:待回复「最早在上」—— 等得最久的先回。
            queryset = queryset.order_by(F("last_soul_message_at").asc(nulls_last=True), "created_at")
        return queryset

    @extend_schema(parameters=[InboxListQuerySerializer])
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(responses={200: InboxFoldersSerializer})
    @action(detail=False, methods=["get"], pagination_class=None)
    def folders(self, request):
        return Response(inbox.counts(self.get_queryset()))

    @extend_schema(responses={200: InboxMessageSerializer(many=True), 503: ChatErrorSerializer})
    @action(detail=True, methods=["get"], pagination_class=None)
    def messages(self, request, pk=None):
        conversation = self.get_object()
        try:
            rows = svc.officer_messages(conversation, request.user, request=request)
        except MatrixError as exc:
            return _unavailable(exc)
        return Response(InboxMessageSerializer(rows, many=True).data)

    @extend_schema(request=None, responses={200: InboxStateSerializer})
    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        """我读到此刻。关闭的会话也可以(只读,不是不可读)。"""
        return Response(InboxStateSerializer(inbox.mark_read(self.get_object(), request.user)).data)

    @extend_schema(request=None, responses={200: InboxStateSerializer})
    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        """只从**我的**默认文件夹里拿走;别的官员照旧看得见。灵魂再来信不会自动取消归档。"""
        return Response(InboxStateSerializer(inbox.set_archived(self.get_object(), request.user, True)).data)

    @extend_schema(request=None, responses={200: InboxStateSerializer})
    @action(detail=True, methods=["post"])
    def unarchive(self, request, pk=None):
        return Response(InboxStateSerializer(inbox.set_archived(self.get_object(), request.user, False)).data)

    @extend_schema(methods=["GET"], request=None, responses={200: InboxStateSerializer})
    @extend_schema(methods=["PUT"], request=InboxDraftSerializer,
                   responses={200: InboxStateSerializer, 409: ChatErrorSerializer})
    @extend_schema(methods=["DELETE"], request=None, responses={200: InboxStateSerializer})
    @action(detail=True, methods=["get", "put", "delete"])
    def draft(self, request, pk=None):
        """我的草稿。只存在我们的库里、只回给写它的官员;不进 Synapse、不进审计。
        关闭的会话只读:PUT 答 409 `closed`;DELETE 仍可(清掉留下的草稿)。"""
        conversation = self.get_object()
        if request.method == "GET":
            return Response(InboxStateSerializer(inbox.state_for(conversation, request.user)).data)
        if request.method == "DELETE":
            return Response(InboxStateSerializer(inbox.save_draft(conversation, request.user, "")).data)
        if conversation.closed_at is not None:
            return _error(svc.ChatError("会话已关闭(对方已转世),不能再存草稿。", "closed", status=409))
        body = InboxDraftSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        text = body.validated_data["body"]
        # 只有空白 = 清掉:恢复出一份全是空格的草稿没有意义。
        state = inbox.save_draft(conversation, request.user, text if text.strip() else "")
        return Response(InboxStateSerializer(state).data)

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
        inbox.after_reply(conversation, request.user)
        return Response({"event_id": event_id}, status=status.HTTP_201_CREATED)


class InboxReplyTemplateViewSet(CodenameViewSetMixin, viewsets.ModelViewSet):
    """`/api/v1/chat/inbox-templates/` —— 殿司的回复模板,同一殿司的官员共用。

    **每个动作都要 `soul_inbox.reply`**,读也是:模板只在回复框里用,没有回复权的人用不上它。
    没有另开一个「管理模板」的权限码 —— 有回复权的官员就是写回复的人,由他们维护回复的
    常用句最自然;要收紧时再加 `soul_inbox.template`。

    不分页:回复框的选择器要一次拿全,而一个殿司的模板是几条到几十条,不是几千条。
    """

    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "soul_inbox"
    extra_permissions = {action: ["soul_inbox.reply"] for action in
                         ("list", "retrieve", "create", "update", "partial_update", "destroy")}
    serializer_class = InboxReplyTemplateSerializer
    queryset = InboxReplyTemplate.objects.all()
    pagination_class = None

    def get_queryset(self):
        return scope_to_tenant(InboxReplyTemplate.objects.all(), self.request)

    def perform_create(self, serializer):
        tenant = getattr(self.request, "tenant", None)
        if tenant is None:
            raise serializers.ValidationError({"detail": "模板属于一个殿司;当前请求没有殿司。"})
        serializer.save(tenant=tenant, created_by=self.request.user)
