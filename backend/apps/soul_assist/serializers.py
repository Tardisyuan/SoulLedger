from rest_framework import serializers

from apps.soul_assist.models import OFFICER_SCREENS, SCREENS, AssistConversation, AssistMessage

MAX_QUESTION_LENGTH = 1000


class AssistAskSerializer(serializers.Serializer):
    question = serializers.CharField(max_length=MAX_QUESTION_LENGTH, trim_whitespace=True)
    screen = serializers.ChoiceField(choices=SCREENS)
    #: 续哪个会话;不给则按「同一页面 30 分钟内续上次」找,找不到就新开。
    conversation_id = serializers.UUIDField(required=False, allow_null=True)
    stream = serializers.BooleanField(
        required=False,
        help_text="true = 以 Server-Sent Events 逐段返回(text/event-stream,事件见 AssistStreamEvent);"
                  "缺省 false = 答完一次返回 JSON。进门的错误(未开通、限流、忙、会话不存在)两种都答 JSON 与状态码。")


class OfficerAssistAskSerializer(AssistAskSerializer):
    #: 官员端 Web 的路由段(`frontend/app/<段>/`);只作提示,不改变数据范围。
    screen = serializers.ChoiceField(choices=OFFICER_SCREENS)


class AssistMessageSerializer(serializers.ModelSerializer):
    interruption = serializers.ChoiceField(
        choices=AssistMessage.INTERRUPTIONS, allow_blank=True, read_only=True,
        help_text="流式没答完:stopped = 停止或断开,interrupted = 出过字后出错或超时;空 = 答完了。内容是已发出的部分")

    class Meta:
        model = AssistMessage
        fields = ["id", "role", "content", "interruption", "created_at"]


class AssistAnswerSerializer(serializers.Serializer):
    conversation_id = serializers.UUIDField()
    answer = AssistMessageSerializer()


class AssistConversationSerializer(serializers.ModelSerializer):
    #: 列表里显示的首个问题(设计稿 1f)。
    first_question = serializers.SerializerMethodField()
    #: 按端声明选项集:模型列上的选项是两端之并,直接用它会让两端的生成类型都变成那个并集。
    screen = serializers.ChoiceField(choices=SCREENS, read_only=True)
    messages = AssistMessageSerializer(many=True, read_only=True)

    class Meta:
        model = AssistConversation
        fields = ["id", "screen", "created_at", "last_active_at", "first_question", "messages"]

    def get_first_question(self, obj) -> str:
        first = next((m for m in obj.messages.all() if m.role == "user"), None)
        return first.content if first else ""


class OfficerAssistConversationSerializer(AssistConversationSerializer):
    screen = serializers.ChoiceField(choices=OFFICER_SCREENS, read_only=True)


class AssistErrorSerializer(serializers.Serializer):
    detail = serializers.CharField()
    code = serializers.CharField()
    retry_at = serializers.DateTimeField(required=False)


# ── 流式(docs/ARCHITECTURE-soul-assist.md §13)。每个事件是一行 `event: <名>` 加一行 `data: <JSON>`,
# JSON 里也带 `event`,自成一体。顺序:meta → delta* → done | error;进门的错误不走这里。


class AssistStreamMetaSerializer(serializers.Serializer):
    event = serializers.CharField(help_text="meta")
    conversation_id = serializers.UUIDField(help_text="续的会话,或这次新开的会话(答完才落库)")


class AssistStreamDeltaSerializer(serializers.Serializer):
    event = serializers.CharField(help_text="delta")
    text = serializers.CharField(help_text="接在已收到的文本后面")


class AssistUsageSummarySerializer(serializers.Serializer):
    input_tokens = serializers.IntegerField()
    output_tokens = serializers.IntegerField()
    cache_read_tokens = serializers.IntegerField()


class AssistStreamDoneSerializer(AssistAnswerSerializer):
    """与非流式的 JSON 回答同形(`conversation_id` + `answer`),多一个用量。`conversation_id` 以这里为准:
    续的会话在作答时被删,回答会落进新开的会话。"""

    event = serializers.CharField(help_text="done")
    usage = AssistUsageSummarySerializer()


class AssistStreamErrorSerializer(serializers.Serializer):
    event = serializers.CharField(help_text="error")
    kind = serializers.ChoiceField(choices=("unavailable", "interrupted"),
                                   help_text="unavailable = 一个字都没出(同非流式的 503);interrupted = 出过字后断了")
    text_sent = serializers.BooleanField(help_text="出错前是否已经发过 delta")
    detail = serializers.CharField()
    conversation_id = serializers.UUIDField(required=False, help_text="interrupted 时:已发出的部分存在这个会话里")
    message_id = serializers.IntegerField(required=False, help_text="interrupted 时:存下的那条回答")


def stream_event_serializer(component_name, done):
    """一种 SSE 事件的并集(OpenAPI 的 oneOf + 按 `event` 判别)。"""
    from drf_spectacular.utils import PolymorphicProxySerializer

    return PolymorphicProxySerializer(
        component_name=component_name, resource_type_field_name="event", many=False,
        serializers={"meta": AssistStreamMetaSerializer, "delta": AssistStreamDeltaSerializer, "done": done,
                     "error": AssistStreamErrorSerializer})


def usage_summary(tokens):
    return {"input_tokens": tokens.get("input", 0), "output_tokens": tokens.get("output", 0),
            "cache_read_tokens": tokens.get("cache_read", 0)}
