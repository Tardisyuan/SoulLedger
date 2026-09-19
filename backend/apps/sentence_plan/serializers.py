"""计划本身只读;写经服务层(结案、处置执行、请求、撤销)。下面四个输入序列化器只校验形状,
内容(N2、只能删 PENDING、Q5……)由 `apps/sentence_plan/requests.py` 校验 —— 同一条规则还有
AMENDMENT 审判结案那条路径要守,写在序列化器里就只守住一边。"""
from rest_framework import serializers

from apps.sentence_plan.models import SentenceNode, SentencePlan, SentencePlanRequest, SentenceRequestKind


class SentencePlanRequestCreateSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=SentenceRequestKind.choices)
    #: {"add": [{"realm_code", "sentence_years", "reason"}], "remove": ["<node id>"]};REOPEN 不带。
    changes = serializers.DictField(required=False, allow_empty=True)
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class SentencePlanRequestDecideSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["ACCEPT", "REJECT"])
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class SentencePlanCancelSerializer(serializers.Serializer):
    reason = serializers.CharField(allow_blank=False)


class SentenceNodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = SentenceNode
        fields = [
            "id", "order", "tenant_code", "is_home", "status",
            "realm_code", "sentence_years", "is_eternal", "memory_reset",
            "disposition_id", "dispatch_record_id", "added_by_judgment_id",
            "added_by_request_id", "removed_by_request_id",
            "reason", "activated_at", "completed_at",
        ]
        read_only_fields = fields


class SentencePlanRequestSerializer(serializers.ModelSerializer):
    # 不给 `decided_by`:审批人不公开,只显示角色(设计稿 Q10;与转生申请同一规则)。
    class Meta:
        model = SentencePlanRequest
        fields = [
            "id", "from_tenant_code", "kind", "status", "changes",
            "requested_by_judgment_id", "reason", "decision_reason", "decided_at", "create_time",
        ]
        read_only_fields = fields


class SentencePlanSerializer(serializers.ModelSerializer):
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    tenant_code = serializers.CharField(source="tenant.code", read_only=True, allow_null=True)
    nodes = SentenceNodeSerializer(many=True, read_only=True)
    requests = SentencePlanRequestSerializer(many=True, read_only=True)

    class Meta:
        model = SentencePlan
        fields = [
            "id", "soul", "soul_name", "tenant", "tenant_code", "cycle", "status",
            "origin_judgment_id", "cross_judgment_id", "completed_at", "cancel_reason",
            "nodes", "requests", "create_time", "update_time",
        ]
        read_only_fields = fields
