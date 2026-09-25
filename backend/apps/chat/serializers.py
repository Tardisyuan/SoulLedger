"""聊天接口的形状。**没有一个序列化器带消息正文出库** —— 正文在 Synapse,
`InboxMessageSerializer` 是一次转发,不是一张表的投影。
"""
import re
from datetime import datetime, timedelta

from django.conf import settings
from rest_framework import serializers

from apps.chat.models import Conversation, ConversationKind, InboxReplyTemplate


class ChatSessionSerializer(serializers.Serializer):
    """`GET /me/chat/session/`。`token` 是短时效的 Matrix 登录凭据,不是访问令牌。"""

    homeserver = serializers.CharField()
    user_id = serializers.CharField()
    login_type = serializers.CharField()
    token = serializers.CharField()
    expires_in = serializers.IntegerField()


class ConversationSerializer(serializers.ModelSerializer):
    peer_user = serializers.SerializerMethodField(
        help_text="对方会话那一世账号的 user_id(与朋友圈的 user_id 同一个)。收件箱为空。")
    peer_name = serializers.SerializerMethodField(
        help_text="对方**会话那一世**的显示名 —— 对方转世之后也不变。")
    hall = serializers.SerializerMethodField(help_text="殿司展示名(简体中文;收件箱)。私聊为空。")
    hall_names = serializers.SerializerMethodField(
        help_text="殿司展示名,按语言:{zh-Hans, en, egy}(`Tenant.hall_names`)。私聊为空。")
    mutual = serializers.SerializerMethodField(help_text="私聊:两人此刻互相关注。收件箱为 false。")
    initiated_by_me = serializers.SerializerMethodField(
        help_text="被节流的私聊由我发起:我只能经 `POST .../messages/` 每 24 小时发一条。")
    next_request_at = serializers.SerializerMethodField(
        help_text="我发起的被节流私聊:何时可以再发一条请求;还没发过、或不受节流时为空。")
    refusal = serializers.SerializerMethodField(
        help_text="此刻不能在这里说话的原因码(`muted` / `peer_retired` / `not_current_hall` / `closed`),"
                  "能说为空。与发送时服务端拒绝的是同一个判断(`services.refusal`)。")

    class Meta:
        model = Conversation
        fields = [
            "id", "kind", "room_id", "peer_user", "peer_name", "hall", "hall_names",
            "throttled", "last_request_at", "responded_at", "last_message_at", "created_at", "closed_at",
            "mutual", "initiated_by_me", "next_request_at", "refusal",
        ]
        read_only_fields = fields

    def _peer(self, obj):
        """对方**会话那一世**的账号 —— 不是对方此刻的本世账号:对方转世之后,这里仍是当时
        和我说话的那一个。灵魂身份不出库:认得的是朋友圈的 user_id 与显示名。"""
        account = self.context.get("account")
        if obj.kind != ConversationKind.DIRECT or account is None:
            return None
        return obj.other_account(account.pk)

    def get_peer_user(self, obj) -> int | None:
        peer = self._peer(obj)
        return peer.user_id if peer is not None else None

    def get_peer_name(self, obj) -> str:
        from apps.chat.identity import display_name

        peer = self._peer(obj)
        return display_name(peer) if peer is not None else ""

    def get_mutual(self, obj) -> bool:
        from apps.chat.services import _mutual

        account, peer = self.context.get("account"), self._peer(obj)
        return account is not None and peer is not None and _mutual(account, peer)

    def get_initiated_by_me(self, obj) -> bool:
        return obj.throttled and obj.initiator_id is not None and obj.initiator_id == self.context.get("soul_id")

    def get_next_request_at(self, obj) -> datetime | None:
        if not self.get_initiated_by_me(obj) or obj.last_request_at is None:
            return None
        return obj.last_request_at + timedelta(seconds=settings.CHAT_REQUEST_INTERVAL_SECONDS)

    def get_refusal(self, obj) -> str | None:
        from apps.chat.services import refusal

        account = self.context.get("account")
        if account is None:
            return None
        error = refusal(obj, account, self._peer(obj))
        return error.code if error is not None else None

    def get_hall(self, obj) -> str:
        """殿司名。私聊会话也有租户(建房时双方所在的文明),但那不是收件人,所以只给收件箱。"""
        return obj.tenant.hall_names["zh-Hans"] if obj.kind == ConversationKind.OFFICER_INBOX else ""

    def get_hall_names(self, obj) -> dict[str, str] | None:
        return obj.tenant.hall_names if obj.kind == ConversationKind.OFFICER_INBOX else None


class ConversationCreateSerializer(serializers.Serializer):
    """两种会话一个端点:给 `target_user`(朋友圈搜索结果的 user_id)就是私聊,
    `kind=OFFICER_INBOX` 就是当前所在殿司的收件箱。"""

    kind = serializers.ChoiceField(choices=ConversationKind.choices, default=ConversationKind.DIRECT)
    target_user = serializers.IntegerField(required=False, min_value=1)

    def validate(self, attrs):
        if attrs["kind"] == ConversationKind.DIRECT and not attrs.get("target_user"):
            raise serializers.ValidationError({"target_user": "私聊必须指定对方。"})
        return attrs


class MessageSendSerializer(serializers.Serializer):
    # 与 Matrix 的 `max_event_size` 相比很小。上限存在是因为这段文字会原样进一个
    # 我们不控制其解析的系统;正文长度不是产品决定,是边界校验。
    body = serializers.CharField(max_length=4000, trim_whitespace=True)
    # App 发件箱给每封信的事务号。同一个号重发,回的是第一次的 event_id,不再发第二条 ——
    # 见 `MeChatMessagesView`。可省:Web 不重发。
    txn_id = serializers.RegexField(r"^[A-Za-z0-9._~-]+$", max_length=64, required=False)


class MessageSentSerializer(serializers.Serializer):
    event_id = serializers.CharField()


class InboxMessageSerializer(serializers.Serializer):
    """官员后台读到的一条。`body` 从 Synapse 来,不经过我们的库,也不进审计。"""

    event_id = serializers.CharField()
    from_officer = serializers.BooleanField()
    sender_name = serializers.CharField()
    officer_title = serializers.CharField(help_text="回信官员的职位(官员回信;灵魂的信为空)。")
    body = serializers.CharField()
    timestamp = serializers.IntegerField()


class InboxOfficerSerializer(serializers.Serializer):
    """一位官员:经办人,或「标给同僚」弹层里的一个候选。"""

    user_id = serializers.IntegerField(source="pk")
    display_name = serializers.SerializerMethodField()

    def get_display_name(self, user) -> str:
        return user.display_name or user.username


class InboxAssignSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(min_value=1)


class OfficerInboxSerializer(serializers.ModelSerializer):
    soul = serializers.UUIDField(source="soul_a_id", read_only=True)
    soul_name = serializers.CharField(source="soul_a.name", read_only=True)
    soul_code = serializers.CharField(source="soul_a.soul_code", read_only=True)
    tenant_name = serializers.CharField(source="tenant.display_name", read_only=True)
    hall_names = serializers.DictField(source="tenant.hall_names", child=serializers.CharField(), read_only=True,
                                       help_text="殿司展示名,按语言:{zh-Hans, en, egy}。")

    last_from = serializers.ChoiceField(
        choices=[("soul", "soul"), ("hall", "hall")], allow_blank=True, read_only=True,
        help_text="最后一封是谁写的:`soul` / `hall`;还没有信为空串。")
    unread = serializers.BooleanField(read_only=True, help_text="**调用者**还没读过灵魂最新的来信。")
    has_draft = serializers.BooleanField(read_only=True, help_text="**调用者**在这个会话里有草稿。")
    archived = serializers.BooleanField(read_only=True, help_text="**调用者**归档了它。")
    assignee = InboxOfficerSerializer(read_only=True, allow_null=True,
                                      help_text="「标给同僚」的经办人,殿司共享;没有为 null。")

    class Meta:
        model = Conversation
        fields = ["id", "soul", "soul_name", "soul_code", "tenant", "tenant_name", "hall_names",
                  "last_message_at", "last_soul_message_at", "last_from", "unread", "has_draft", "archived",
                  "assignee", "assigned_at", "created_at", "closed_at"]
        read_only_fields = fields


class InboxHallCountSerializer(serializers.Serializer):
    tenant = serializers.IntegerField()
    hall_names = serializers.DictField(child=serializers.CharField())
    count = serializers.IntegerField()


class InboxFoldersSerializer(serializers.Serializer):
    """`GET /chat/inbox/folders/`:每个文件夹的总数(与列表的 `folder=` 同一个过滤,见 `apps/chat/inbox.py`)。"""

    all = serializers.IntegerField()
    awaiting_reply = serializers.IntegerField()
    replied = serializers.IntegerField()
    drafts = serializers.IntegerField()
    archived = serializers.IntegerField()
    assigned_to_me = serializers.IntegerField(help_text="未归档里同僚标给调用者的。")
    unread = serializers.IntegerField(help_text="未归档里调用者的未读数。")
    open = serializers.IntegerField(help_text="未归档里往来中的。")
    closed = serializers.IntegerField(help_text="未归档里已关闭的。")
    halls = InboxHallCountSerializer(many=True, help_text="未归档,按殿。")


class InboxStateSerializer(serializers.Serializer):
    """调用者对一个会话的私人状态。`draft` 只回给写它的那位官员。"""

    last_read_at = serializers.DateTimeField(allow_null=True)
    archived_at = serializers.DateTimeField(allow_null=True)
    draft = serializers.CharField(allow_blank=True)
    draft_saved_at = serializers.DateTimeField(allow_null=True)


class InboxDraftSerializer(serializers.Serializer):
    # 不 trim:草稿要原样还给官员,包括他刚打的那个换行。
    body = serializers.CharField(max_length=4000, allow_blank=True, trim_whitespace=False)


class OfficerReplySerializer(serializers.Serializer):
    body = serializers.CharField(max_length=4000, trim_whitespace=True)


class ChatLookupSerializer(serializers.Serializer):
    """`POST /me/chat/lookup/`。走请求体而不是查询串:编号是登录名,不该落进访问日志的 URL 里。"""

    soul_code = serializers.CharField(max_length=32, help_text="完整的灵魂编号,大小写不论;不做前缀或模糊匹配。")


class ChatErrorSerializer(serializers.Serializer):
    detail = serializers.CharField()
    code = serializers.CharField()
    retry_at = serializers.DateTimeField(required=False, help_text="429 时:何时可以再试。")


#: 模板里允许的占位符。客户端发送前替换(`packages/core/src/soulInboxTemplates.ts`),服务端只校验。
TEMPLATE_PLACEHOLDERS = ("soul_name", "hall_name")
_PLACEHOLDER = re.compile(r"\{\{\s*([^{}]*?)\s*\}\}")


class InboxReplyTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = InboxReplyTemplate
        fields = ["id", "title", "body", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {"body": {"max_length": 4000, "help_text": "占位符只有 `{{soul_name}}` 与 `{{hall_name}}`。"}}

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("标题不能为空。")
        return value

    def validate_body(self, value):
        unknown = sorted({name for name in _PLACEHOLDER.findall(value) if name not in TEMPLATE_PLACEHOLDERS})
        if unknown:
            raise serializers.ValidationError(
                f"不认识的占位符:{', '.join('{{' + n + '}}' for n in unknown)}。"
                f"只能用 {{{{soul_name}}}} 与 {{{{hall_name}}}}。")
        if not value.strip():
            raise serializers.ValidationError("正文不能为空。")
        return value
