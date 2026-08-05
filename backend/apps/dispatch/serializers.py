"""
Serializers for dispatch app.
"""
from rest_framework import serializers

from apps.dispatch.models import CrossTenantJudgment, CrossTenantJudgmentParticipant, DispatchRecord


class DispatchRecordSerializer(serializers.ModelSerializer):
    """Serializer for DispatchRecord.

    `status` and `dispatched_by` are read-only on purpose. They used to be
    plain writable fields, which meant a PATCH under `dispatch.manage` (held
    by GUARDIAN, among others) could set status=EXECUTED directly — skipping
    the target-tenant check in DispatchRecordViewSet.execute() ("Only target
    tenant can approve dispatch"), the REJECTED -> EXECUTED guard in
    DispatchRecord.transition_to(), and the actual soul-tenant transfer in
    DispatchService.execute() — so the row would read EXECUTED for a soul
    that never moved. The same PATCH could reassign `dispatched_by` to forge
    who proposed the transfer. See
    backend/tests/test_perm_write_snapshot_outside_matrix.py, "THE DENIAL
    THAT CAN BE WALKED AROUND (dispatch)", for how this was characterized.
    Status now only moves through approve()/reject()/execute() on the view,
    which carry those checks; validate() below turns an attempted PATCH of
    either field into an explicit 400 instead of a silently-ignored no-op.
    """
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
        read_only_fields = [
            "id",
            "status",
            "dispatched_by",
            "proposed_at",
            "decided_at",
            "executed_at",
            "create_time",
            "update_time",
        ]

    def validate(self, attrs):
        """Reject an attempt to move `status`/`dispatched_by` through CRUD.

        Both are in `read_only_fields` above, so DRF already strips them from
        `attrs` before this runs — silently, the way it silently ignores any
        other read-only field in the request body. That silence is fine for
        `id` or `proposed_at`; it is not fine here, because a client sending
        {"status": "EXECUTED"} needs to learn the request did NOT execute
        anything rather than receive a 200 that looks like success.
        `self.initial_data` still holds the raw payload, so check there.

        Only applies to updates: `create()` on the view never calls
        `.save()` on this serializer (it routes through
        `DispatchService.propose()` instead), so `self.instance` is always
        None for POST and there is nothing here to guard.
        """
        if self.instance is not None:
            blocked = [field for field in ("status", "dispatched_by") if field in self.initial_data]
            if blocked:
                raise serializers.ValidationError({
                    field: (
                        "Not settable through this endpoint. `status` only moves "
                        "through the approve/reject/execute actions, which carry "
                        "the target-tenant and state-machine checks a plain field "
                        "write would skip; `dispatched_by` is set once by "
                        "DispatchService.propose() and is not reassignable."
                    )
                    for field in blocked
                })
        return attrs


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
                raise serializers.ValidationError({"source_tenant_code": "Invalid tenant code"}) from None
        if not attrs.get('target_tenant') and attrs.get('target_tenant_code'):
            try:
                attrs['target_tenant'] = Tenant.objects.get(code=attrs['target_tenant_code']).id
            except Tenant.DoesNotExist:
                raise serializers.ValidationError({"target_tenant_code": "Invalid tenant code"}) from None
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
    """Serializer for CrossTenantJudgment.

    `status` and `conclusion_type` are read-only for the same reason as
    DispatchRecordSerializer's `status`/`dispatched_by` above. Today every
    action on CrossTenantJudgmentViewSet — CRUD and the `participate`/
    `conclude` actions alike — maps to the single codename
    `cross_judgment.create` (see the viewset), so there is no *narrower*
    codename for a PATCH to walk around and this was never a permission
    bypass the way dispatch's was. But `conclude()`
    (CrossTenantJudgmentService.conclude) does more than write these two
    fields: it also sets `concluded_at` and notifies every participant. A
    PATCH that set status=CONCLUDED directly left `concluded_at` null and
    nobody notified — the same "record lies" failure dispatch had, just not
    (yet) also a permission bypass. Closed here too, so it can't become one
    the moment `conclude` gets its own narrower codename.
    """
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
        read_only_fields = ["id", "status", "conclusion_type", "concluded_at", "create_time", "update_time"]

    def validate(self, attrs):
        """Reject an attempt to move `status`/`conclusion_type` through CRUD.

        Mirrors DispatchRecordSerializer.validate() — see there for why an
        explicit 400 beats DRF's default silent-ignore of read-only fields.
        Only applies to updates; `perform_create` on the view calls
        `serializer.save(tenant=...)` directly rather than setting `status`,
        so `self.instance` is None for POST and there is nothing to guard.
        """
        if self.instance is not None:
            blocked = [field for field in ("status", "conclusion_type") if field in self.initial_data]
            if blocked:
                raise serializers.ValidationError({
                    field: (
                        "Not settable through this endpoint. Use the participate/"
                        "conclude actions, which also set `concluded_at` and "
                        "notify participants — a plain field write would skip both."
                    )
                    for field in blocked
                })
        return attrs


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
