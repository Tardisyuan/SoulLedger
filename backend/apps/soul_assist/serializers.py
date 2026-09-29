from rest_framework import serializers

from apps.soul_assist.models import OFFICER_SCREENS, SCREENS, AssistConversation, AssistMessage

MAX_QUESTION_LENGTH = 1000


class AssistAskSerializer(serializers.Serializer):
    question = serializers.CharField(max_length=MAX_QUESTION_LENGTH, trim_whitespace=True)
    screen = serializers.ChoiceField(choices=SCREENS)
    #: 续哪个会话;不给则按「同一页面 30 分钟内续上次」找,找不到就新开。
    conversation_id = serializers.UUIDField(required=False, allow_null=True)


class OfficerAssistAskSerializer(AssistAskSerializer):
    #: 官员端 Web 的路由段(`frontend/app/<段>/`);只作提示,不改变数据范围。
    screen = serializers.ChoiceField(choices=OFFICER_SCREENS)


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
