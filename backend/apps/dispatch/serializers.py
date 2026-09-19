"""
Serializers for dispatch app.
"""
from rest_framework import serializers

from apps.dispatch.models import CrossTenantJudgment, CrossTenantJudgmentParticipant, DispatchRecord
from apps.judgment.models import Judgment


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

    `soul`, `source_tenant` and `target_tenant` are read-only for a separate
    reason, and the paragraph above is exactly why it was missed: that
    argument is about `status`, and it is correct about `status`. Locking
    down how a record's state moves does nothing about *which* record it is.
    The three parties are fixed at proposal and were plain writable fields,
    so a MODERATOR could seed a self-dispatch (source == target == own
    tenant, which is what keeps `obj.tenant` pointing at itself for
    TenantPermission), then PATCH `soul` to a foreign tenant's soul and
    `source_tenant` to that tenant, and approve/execute it. Both of those
    actions do check the tenant — they check `target_tenant`, which the
    attacker set. Measured 2026-08-29: a four-request chain moved a soul
    from tenant 1 to tenant 2 end to end, every response 2xx.

    `DispatchService.propose()` validates `soul.tenant_id == source_tenant.id`
    and is the only place that link is ever checked. PATCH does not go
    through it. That is the whole defect: the invariant lives in the create
    path and the update path was never told about it.
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
            "returned_at",
            "create_time",
            "update_time",
        ]
        read_only_fields = [
            "id",
            "status",
            "dispatched_by",
            # NOTE: `soul`, `source_tenant` and `target_tenant` are deliberately
            # NOT listed here, even though they must not change after creation.
            # They are the arguments `DispatchRecordViewSet.create()` reads out
            # of `validated_data` to hand to `DispatchService.propose()` --
            # marking them read-only strips them before create() ever sees
            # them, and every proposal 400s with "soul is required". (Measured:
            # doing exactly that turned test_create_dispatch_record and
            # test_dispatch_propose red.) They are fixed at proposal by
            # `validate()` below instead, which raises on update only -- the
            # same shape `status` uses two fields up.
            "proposed_at",
            "decided_at",
            "executed_at",
            "returned_at",
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
            _party_fields = ("soul", "source_tenant", "target_tenant")
            blocked = [
                field
                for field in ("status", "dispatched_by") + _party_fields
                if field in self.initial_data
            ]
            if blocked:
                raise serializers.ValidationError({
                    field: (
                        "The parties to a dispatch are fixed when it is proposed. "
                        "Re-pointing one of them after the fact is how a record "
                        "whose target-tenant checks all pass can still move a "
                        "soul that never belonged to the source tenant."
                        if field in _party_fields
                        else "Not settable through this endpoint. `status` only moves "
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
            "returned_at",
        ]


# `DispatchProposeSerializer` was deleted 2026-08-31.
#
# It declared `soul = serializers.IntegerField()` while `Soul`'s primary key is
# a UUID, and it was used by **nothing** — `DispatchRecordViewSet.get_serializer_class`
# returns only the list/detail pair, and a repo-wide grep found no other
# reference. Harmless as code; not harmless as documentation, because it read
# like the propose endpoint's contract and the next person to touch that
# endpoint would have made the endpoint match it.
#
# The real propose path is `DispatchService.propose`, called from
# `DispatchRecordViewSet.create`.

class DispatchApproveSerializer(serializers.Serializer):
    """Serializer for approving a dispatch."""
    pass


class DispatchRejectSerializer(serializers.Serializer):
    """Serializer for rejecting a dispatch."""
    reason = serializers.CharField(max_length=1000, required=False, default="")


class DispatchReturnSerializer(serializers.Serializer):
    """手动结束暂居。理由必填:这是一次越过「处置执行完毕」的决定,审计里要说得清为什么。"""
    reason = serializers.CharField(max_length=1000)


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
            # 这一方在受刑计划里的那一站(docs/ARCHITECTURE-sentence-plan.md §2.2)。
            # 只经 `sentence/` 动作写(服务端抄 realm 的 is_eternal / memory_reset),不经 PATCH。
            "node_order",
            "sentence_realm_code",
            "sentence_years",
            "sentence_is_eternal",
            "sentence_memory_reset",
            "sentence_notes",
            "sentence_submitted_at",
        ]
        read_only_fields = [
            "id", "joined_at",
            "node_order", "sentence_realm_code", "sentence_years", "sentence_is_eternal",
            "sentence_memory_reset", "sentence_notes", "sentence_submitted_at",
        ]


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
    # 这场联审为哪份原属审判定受刑计划(docs/ARCHITECTURE-sentence-plan.md §2.1,Q12)。
    # 只在 `create` 时给一次,之后不可改:参与方按它填节点,换审判等于换灵魂。
    # 不给 = 存量那种不挂灵魂的会议,行为不变。
    judgment = serializers.PrimaryKeyRelatedField(
        queryset=Judgment.all_objects.filter(is_deleted=False),
        required=False, allow_null=True,
    )

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
            "judgment",
            "participants",
            "create_time",
            "update_time",
        ]
        read_only_fields = [
            "id",
            "status",
            "conclusion_type",
            "concluded_at",
            # Who opened the judgment is decided by who is making the request,
            # not by what they put in the body. It was writable, and
            # `perform_create` only pinned `tenant` -- so a JUDGE in tenant B
            # could POST {"initiating_tenant": <A>} and get a 201, planting a
            # row that shows up in tenant A's list (get_queryset filters on
            # `initiating_tenant`, not `tenant`) with create_user NULL, that A
            # cannot open and B cannot see. Neither party could delete it.
            # Measured 2026-08-29. PATCH could re-point an honest one the same
            # way, losing it into another tenant.
            "initiating_tenant",
            "create_time",
            "update_time",
        ]

    def validate(self, attrs):
        """Reject an attempt to move `status`/`conclusion_type` through CRUD.

        Mirrors DispatchRecordSerializer.validate() — see there for why an
        explicit 400 beats DRF's default silent-ignore of read-only fields.
        Only applies to updates; `perform_create` on the view calls
        `serializer.save(tenant=...)` directly rather than setting `status`,
        so `self.instance` is None for POST and there is nothing to guard.
        """
        if self.instance is not None:
            blocked = [
                field
                for field in ("status", "conclusion_type", "initiating_tenant", "judgment")
                if field in self.initial_data
            ]
            if blocked:
                raise serializers.ValidationError({
                    field: (
                        "The initiating tenant is taken from the request, not the "
                        "body. Setting it here is how a row lands in another "
                        "tenant's list that neither side can open or remove."
                        if field == "initiating_tenant"
                        else "The judgment is fixed when the cross-tenant judgment is "
                        "opened; participants have filled their nodes against it."
                        if field == "judgment"
                        else "Not settable through this endpoint. Use the participate/"
                        "conclude actions, which also set `concluded_at` and "
                        "notify participants — a plain field write would skip both."
                    )
                    for field in blocked
                })
        return attrs

    def validate_judgment(self, value):
        """挂的必须是发起方**自己的、还没结案的原审判**,且灵魂的原属就是发起方。

        发起方取自请求(同 `perform_create`),不取自 body。别的租户的审判一律答
        「本租户没有这份审判」,不区分「不存在」与「不是你的」。
        """
        if value is None:
            return value
        from apps.judgment.models import JudgmentKind

        request = self.context.get("request")
        tenant = getattr(request, "tenant", None) or getattr(getattr(request, "user", None), "tenant", None)
        soul = value.soul
        home_id = soul.home_tenant_id or soul.tenant_id
        if tenant is None or value.tenant_id != tenant.pk or home_id != tenant.pk:
            raise serializers.ValidationError("No such judgment in your tenant.")
        if value.verdict is not None or value.is_final:
            raise serializers.ValidationError("This judgment is already concluded.")
        if value.kind != JudgmentKind.ORIGINAL:
            raise serializers.ValidationError("Only an original judgment opens a sentence plan.")
        # 含软删的行:OneToOne 的唯一约束不看 is_deleted。
        if CrossTenantJudgment._base_manager.filter(judgment=value).exists():
            raise serializers.ValidationError("This judgment already has a cross-tenant judgment.")
        return value


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
    # 这一方在受刑计划里排第几站(原属恒为 1,所以从 2 起)。只对挂了审判的联审有意义;
    # 规则在 `CrossTenantJudgmentService.add_participant`。
    node_order = serializers.IntegerField(required=False, allow_null=True, min_value=2)


class CrossTenantJudgmentSentenceSerializer(serializers.Serializer):
    """参与方填自己文明那一站的处置内容(docs/ARCHITECTURE-sentence-plan.md §2.1)。

    `is_eternal` / `memory_reset` 不收:服务端抄自 realm,与 `create_from_judgment` 同一抄法。
    """
    participant = serializers.UUIDField()
    realm_code = serializers.CharField(max_length=50)
    sentence_years = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    notes = serializers.CharField(required=False, allow_blank=True, default="", max_length=5000)


class CrossTenantJudgmentOrderSerializer(serializers.Serializer):
    """发起方重排各站:全部带节点席位的 id,按新顺序;服务端依次给 2、3……(`reorder_nodes`)。"""
    participants = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)


class CrossTenantJudgmentConcludeSerializer(serializers.Serializer):
    """Serializer for concluding a cross-tenant judgment."""
    conclusion_type = serializers.ChoiceField(choices=["PASS", "FAIL"])
