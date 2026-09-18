"""聊天接口的形状。**没有一个序列化器带消息正文出库** —— 正文在 Synapse,
`InboxMessageSerializer` 是一次转发,不是一张表的投影。
"""
from rest_framework import serializers

from apps.chat.models import Conversation, ConversationKind


class ChatSessionSerializer(serializers.Serializer):
    """`GET /me/chat/session/`。`token` 是短时效的 Matrix 登录凭据,不是访问令牌。"""

    homeserver = serializers.CharField()
    user_id = serializers.CharField()
    login_type = serializers.CharField()
    token = serializers.CharField()
    expires_in = serializers.IntegerField()


class ConversationSerializer(serializers.ModelSerializer):
    peer_name = serializers.SerializerMethodField()
    peer_soul = serializers.SerializerMethodField()
    hall = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = [
            "id", "kind", "room_id", "peer_soul", "peer_name", "hall",
            "throttled", "last_request_at", "responded_at", "last_message_at", "created_at",
        ]
        read_only_fields = fields

    def _peer(self, obj):
        soul_id = self.context.get("soul_id")
        if obj.kind != ConversationKind.DIRECT or soul_id is None:
            return None
        return obj.soul_b if obj.soul_a_id == soul_id else obj.soul_a

    def get_peer_soul(self, obj):
        peer = self._peer(obj)
        return str(peer.pk) if peer is not None else None

    def get_peer_name(self, obj):
        peer = self._peer(obj)
        return peer.name if peer is not None else ""

    def get_hall(self, obj):
        """殿司名。私聊会话也有租户(建房时双方所在的文明),但那不是收件人,所以只给收件箱。"""
        return obj.tenant.display_name if obj.kind == ConversationKind.OFFICER_INBOX else ""


class ConversationCreateSerializer(serializers.Serializer):
    """两种会话一个端点:给 `target_soul` 就是私聊,`kind=OFFICER_INBOX` 就是殿司收件箱。"""

    kind = serializers.ChoiceField(choices=ConversationKind.choices, default=ConversationKind.DIRECT)
    target_soul = serializers.UUIDField(required=False)

    def validate(self, attrs):
        if attrs["kind"] == ConversationKind.DIRECT and not attrs.get("target_soul"):
            raise serializers.ValidationError({"target_soul": "私聊必须指定对方。"})
        return attrs


class MessageSendSerializer(serializers.Serializer):
    # 与 Matrix 的 `max_event_size` 相比很小。上限存在是因为这段文字会原样进一个
    # 我们不控制其解析的系统;正文长度不是产品决定,是边界校验。
    body = serializers.CharField(max_length=4000, trim_whitespace=True)


class MessageSentSerializer(serializers.Serializer):
    event_id = serializers.CharField()


class InboxMessageSerializer(serializers.Serializer):
    """官员后台读到的一条。`body` 从 Synapse 来,不经过我们的库,也不进审计。"""

    event_id = serializers.CharField()
    from_officer = serializers.BooleanField()
    sender_name = serializers.CharField()
    body = serializers.CharField()
    timestamp = serializers.IntegerField()


class OfficerInboxSerializer(serializers.ModelSerializer):
    soul = serializers.UUIDField(source="soul_a_id", read_only=True)
    soul_name = serializers.CharField(source="soul_a.name", read_only=True)
    soul_code = serializers.CharField(source="soul_a.soul_code", read_only=True)
    tenant_name = serializers.CharField(source="tenant.display_name", read_only=True)

    class Meta:
        model = Conversation
        fields = ["id", "soul", "soul_name", "soul_code", "tenant", "tenant_name",
                  "last_message_at", "created_at"]
        read_only_fields = fields


class OfficerReplySerializer(serializers.Serializer):
    body = serializers.CharField(max_length=4000, trim_whitespace=True)


class ChatErrorSerializer(serializers.Serializer):
    detail = serializers.CharField()
    code = serializers.CharField()
