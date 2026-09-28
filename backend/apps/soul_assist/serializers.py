from rest_framework import serializers

from apps.soul_assist.models import SCREENS, AssistConversation, AssistMessage

MAX_QUESTION_LENGTH = 1000


class AssistAskSerializer(serializers.Serializer):
    question = serializers.CharField(max_length=MAX_QUESTION_LENGTH, trim_whitespace=True)
    screen = serializers.ChoiceField(choices=SCREENS)
    #: 续哪个会话;不给则按「同一页面 30 分钟内续上次」找,找不到就新开。
    conversation_id = serializers.UUIDField(required=False, allow_null=True)


class AssistMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssistMessage
        fields = ["id", "role", "content", "created_at"]


class AssistAnswerSerializer(serializers.Serializer):
    conversation_id = serializers.UUIDField()
    answer = AssistMessageSerializer()


class AssistConversationSerializer(serializers.ModelSerializer):
    #: 列表里显示的首个问题(设计稿 1f)。
    first_question = serializers.SerializerMethodField()
    messages = AssistMessageSerializer(many=True, read_only=True)

    class Meta:
        model = AssistConversation
        fields = ["id", "screen", "created_at", "last_active_at", "first_question", "messages"]

    def get_first_question(self, obj) -> str:
        first = next((m for m in obj.messages.all() if m.role == "user"), None)
        return first.content if first else ""


class AssistErrorSerializer(serializers.Serializer):
    detail = serializers.CharField()
    code = serializers.CharField()
    retry_at = serializers.DateTimeField(required=False)
