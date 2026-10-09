from rest_framework import serializers

from apps.soul_push.models import PushPlatform
from apps.soul_push.views import EXPO_TOKEN_RE


class TodoTargetSerializer(serializers.Serializer):
    """推送与列表行落到哪一条:`GET items/<kind>/<id>/`。"""

    kind = serializers.CharField(help_text="approval / reassignment / cooldown / rebirth")
    id = serializers.CharField()


class TodoItemSerializer(serializers.Serializer):
    kind = serializers.CharField(help_text="approval / reassignment / cooldown / rebirth")
    id = serializers.CharField()
    title = serializers.CharField()
    created_at = serializers.DateTimeField()
    target = TodoTargetSerializer()
    node_name = serializers.CharField(required=False, help_text="仅审批节点:轮到的节点名。")


class TodoGroupSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    items = TodoItemSerializer(many=True)


class TodoSerializer(serializers.Serializer):
    approvals = TodoGroupSerializer()
    reassignments = TodoGroupSerializer()
    cooldowns = TodoGroupSerializer()
    rebirths = TodoGroupSerializer()


class HandledBySerializer(serializers.Serializer):
    id = serializers.IntegerField(allow_null=True)
    name = serializers.CharField()


class TodoItemDetailSerializer(serializers.Serializer):
    """`state`:actionable / already_handled / deadline_passed / permission_changed
    (与决定失败的 `code` 同一组词)。`handled_by` 在调拨上恒为 null(调拨记录不存决定人)。"""

    kind = serializers.CharField(help_text="approval / reassignment / cooldown / rebirth")
    id = serializers.CharField()
    title = serializers.CharField()
    created_at = serializers.DateTimeField()
    actionable = serializers.BooleanField()
    state = serializers.CharField()
    handled_by = HandledBySerializer(allow_null=True)
    handled_at = serializers.DateTimeField(allow_null=True)
    workflow_id = serializers.CharField(required=False, help_text="审批节点与转生申请:决定走 workflows/<id>/approve_node/。")
    node_id = serializers.CharField(required=False, help_text="待决的节点;决定时作为 node_id 传回。")


class OfficerPushTokenSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=255)
    platform = serializers.ChoiceField(choices=PushPlatform.choices)

    def validate_token(self, value):
        if not EXPO_TOKEN_RE.match(value):
            raise serializers.ValidationError("不是 Expo push token(ExponentPushToken[...])。")
        return value


class OfficerPushUnregisterSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=255)


class SignerCandidateSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    username = serializers.CharField()
    role = serializers.CharField()
