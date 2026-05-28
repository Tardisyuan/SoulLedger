"""
Serializers for dispatch app.
"""
from rest_framework import serializers
from apps.dispatch.models import DispatchRecord, CrossTenantJudgment, CrossTenantJudgmentParticipant


class DispatchRecordSerializer(serializers.ModelSerializer):
    """Serializer for DispatchRecord."""
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    source_tenant_code = serializers.CharField(source="source_tenant.code", read_only=True)
    target_tenant_code = serializers.CharField(source="target_tenant.code", read_only=True)
    dispatched_by_name = serializers.CharField(source="dispatched_by.username", read_only=True, allow_null=True)

    class Meta:
        model = DispatchRecord
        fields = [
            "id",
            "source_tenant",
            "source_tenant_code",
            "target_tenant",
            "target_tenant_code",
            "soul",
            "soul_name",
            "dispatched_by",
            "dispatched_by_name",
            "status",
            "reason",
            "proposed_at",
            "decided_at",
            "executed_at",
            "create_time",
            "update_time",
        ]
        read_only_fields = ["id", "proposed_at", "decided_at", "executed_at", "create_time", "update_time"]


class DispatchRecordListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing dispatch records."""
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    source_tenant_code = serializers.CharField(source="source_tenant.code", read_only=True)
    target_tenant_code = serializers.CharField(source="target_tenant.code", read_only=True)

    class Meta:
        model = DispatchRecord
        fields = [
            "id",
            "source_tenant",
            "source_tenant_code",
            "target_tenant",
            "target_tenant_code",
            "soul",
            "soul_name",
            "status",
            "proposed_at",
            "executed_at",
        ]


class DispatchProposeSerializer(serializers.Serializer):
    """Serializer for proposing a new dispatch.
    Accepts either tenant_id (int) or tenant_code (str) for source/target.
    """
    source_tenant = serializers.IntegerField(required=False)
    target_tenant = serializers.IntegerField(required=False)
    source_tenant_code = serializers.CharField(required=False, max_length=50)
    target_tenant_code = serializers.CharField(required=False, max_length=50)
    soul = serializers.IntegerField()
    reason = serializers.CharField(max_length=2000)

    def validate(self, attrs):
        from apps.tenants.models import Tenant
        # Resolve tenant_code to tenant_id if codes provided
        if not attrs.get('source_tenant') and attrs.get('source_tenant_code'):
            try:
                attrs['source_tenant'] = Tenant.objects.get(code=attrs['source_tenant_code']).id
            except Tenant.DoesNotExist:
                raise serializers.ValidationError({"source_tenant_code": "Invalid tenant code"})
        if not attrs.get('target_tenant') and attrs.get('target_tenant_code'):
            try:
                attrs['target_tenant'] = Tenant.objects.get(code=attrs['target_tenant_code']).id
            except Tenant.DoesNotExist:
                raise serializers.ValidationError({"target_tenant_code": "Invalid tenant code"})
        if not attrs.get('source_tenant') or not attrs.get('target_tenant'):
            raise serializers.ValidationError("source_tenant and target_tenant are required (as id or code)")
        return attrs


class DispatchApproveSerializer(serializers.Serializer):
    """Serializer for approving a dispatch."""
    pass


class DispatchRejectSerializer(serializers.Serializer):
    """Serializer for rejecting a dispatch."""
    reason = serializers.CharField(max_length=1000, required=False, default="")


class DispatchExecuteSerializer(serializers.Serializer):
    """Serializer for executing a dispatch."""
    pass


class CrossTenantJudgmentParticipantSerializer(serializers.ModelSerializer):
    """Serializer for CrossTenantJudgmentParticipant."""
    participant_tenant_code = serializers.CharField(source="participant_tenant.code", read_only=True)
    participant_actor_name = serializers.CharField(source="participant_actor.name", read_only=True, allow_null=True)

    class Meta:
        model = CrossTenantJudgmentParticipant
        fields = [
            "id",
            "judgment",
            "participant_tenant",
            "participant_tenant_code",
            "participant_actor",
            "participant_actor_name",
            "role",
            "joined_at",
        ]
        read_only_fields = ["id", "joined_at"]


class CrossTenantJudgmentSerializer(serializers.ModelSerializer):
    """Serializer for CrossTenantJudgment."""
    initiating_tenant_code = serializers.CharField(source="initiating_tenant.code", read_only=True)
    participants = CrossTenantJudgmentParticipantSerializer(many=True, read_only=True)

    class Meta:
        model = CrossTenantJudgment
        fields = [
            "id",
            "title",
            "description",
            "initiating_tenant",
            "initiating_tenant_code",
            "status",
            "concluded_at",
            "conclusion_type",
            "participants",
            "create_time",
            "update_time",
        ]
        read_only_fields = ["id", "concluded_at", "create_time", "update_time"]


class CrossTenantJudgmentListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing cross-tenant judgments."""
    initiating_tenant_code = serializers.CharField(source="initiating_tenant.code", read_only=True)

    class Meta:
        model = CrossTenantJudgment
        fields = [
            "id",
            "title",
            "initiating_tenant",
            "initiating_tenant_code",
            "status",
            "concluded_at",
            "conclusion_type",
        ]


class CrossTenantJudgmentCreateSerializer(serializers.Serializer):
    """Serializer for creating a cross-tenant judgment."""
    title = serializers.CharField(max_length=200)
    description = serializers.CharField(max_length=5000)


class CrossTenantJudgmentParticipateSerializer(serializers.Serializer):
    """Serializer for participating in a cross-tenant judgment."""
    participant_tenant = serializers.IntegerField()
    participant_actor = serializers.IntegerField(required=False, allow_null=True)
    role = serializers.ChoiceField(
        choices=["ADVISOR", "CO_JUDGE", "CHAIRMAN"],
        default="ADVISOR"
    )


class CrossTenantJudgmentConcludeSerializer(serializers.Serializer):
    """Serializer for concluding a cross-tenant judgment."""
    conclusion_type = serializers.ChoiceField(choices=["PASS", "FAIL"])