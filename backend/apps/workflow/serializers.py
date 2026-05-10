"""
Serializers for workflow app.
"""
from rest_framework import serializers
from apps.workflow.models import ApprovalWorkflow, ApprovalNode, WorkflowTemplate


class WorkflowTemplateNodeSerializer(serializers.Serializer):
    """Serializer for a single template node."""
    id = serializers.CharField(required=False, allow_blank=True)
    node_name = serializers.CharField(max_length=255)
    node_type = serializers.ChoiceField(
        choices=["TRIAL", "EVALUATION", "APPEAL", "FINAL", "EXECUTION"],
        default="TRIAL"
    )
    court_code = serializers.CharField(max_length=50, required=False, allow_blank=True, default="")
    approver_role = serializers.CharField(max_length=20, required=False, allow_blank=True, default="")
    approver_type = serializers.ChoiceField(
        choices=["ACTOR", "ROLE", "SYSTEM"],
        default="ROLE"
    )
    node_order = serializers.IntegerField(default=1)


class WorkflowTemplateSerializer(serializers.ModelSerializer):
    """Serializer for WorkflowTemplate."""
    nodes = WorkflowTemplateNodeSerializer(many=True, required=False, source='nodes_json')

    class Meta:
        model = WorkflowTemplate
        fields = [
            "id",
            "name",
            "description",
            "civilization",
            "case_type",
            "is_active",
            "nodes",
            "nodes_json",
            "created_at",
            "updated_at",
            "tenant",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def to_internal_value(self, data):
        # Extract nodes before validation
        nodes_data = data.get("nodes", None)
        ret = super().to_internal_value(data)
        if nodes_data is not None:
            ret["nodes"] = nodes_data
        return ret

    def create(self, validated_data):
        nodes = validated_data.pop("nodes", None)
        template = WorkflowTemplate.objects.create(**validated_data)
        if nodes is not None:
            template.nodes_json = nodes
            template.save()
        return template

    def update(self, instance, validated_data):
        nodes = validated_data.pop("nodes", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if nodes is not None:
            instance.nodes_json = nodes
        instance.save()
        return instance


class WorkflowTemplateListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing templates."""

    class Meta:
        model = WorkflowTemplate
        fields = [
            "id",
            "name",
            "description",
            "civilization",
            "case_type",
            "is_active",
            "created_at",
        ]


class ApprovalNodeSerializer(serializers.ModelSerializer):
    """Serializer for ApprovalNode."""

    class Meta:
        model = ApprovalNode
        fields = [
            "id",
            "workflow",
            "node_name",
            "node_order",
            "node_type",
            "approver_type",
            "approver_actor",
            "approver_role",
            "court_code",
            "realm",
            "required_verdicts",
            "status",
            "verdict",
            "evidence_json",
            "notes",
            "approver",
            "decided_at",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class ApprovalWorkflowSerializer(serializers.ModelSerializer):
    """Serializer for ApprovalWorkflow."""

    nodes = ApprovalNodeSerializer(many=True, read_only=True)
    current_node_detail = ApprovalNodeSerializer(source="current_node", read_only=True)
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    judgment_verdict = serializers.CharField(source="judgment.verdict", read_only=True, allow_null=True)

    class Meta:
        model = ApprovalWorkflow
        fields = [
            "id",
            "judgment",
            "judgment_verdict",
            "soul",
            "soul_name",
            "workflow_name",
            "case_type",
            "priority",
            "status",
            "current_node",
            "current_node_detail",
            "is_appeal",
            "original_workflow",
            "cross_civilization",
            "coordinating_realm",
            "notes",
            "nodes",
            "created_at",
            "updated_at",
            "completed_at",
            "tenant",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "completed_at"]


class ApprovalWorkflowListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing workflows."""

    class Meta:
        model = ApprovalWorkflow
        fields = [
            "id",
            "workflow_name",
            "soul",
            "case_type",
            "priority",
            "status",
            "is_appeal",
            "cross_civilization",
            "created_at",
            "completed_at",
        ]


class WorkflowNodeActionSerializer(serializers.Serializer):
    """Serializer for node approval action."""

    verdict = serializers.ChoiceField(
        choices=["PASSED", "FAILED", "CONFIRMED", "REJECTED", "SKIPPED"]
    )
    notes = serializers.CharField(required=False, allow_blank=True, default="")


class WorkflowAdvanceSerializer(serializers.Serializer):
    """Serializer for manually advancing workflow."""

    pass
