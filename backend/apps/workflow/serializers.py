"""
Serializers for workflow app.
"""
from rest_framework import serializers

from apps.workflow.models import ApprovalNode, ApprovalWorkflow, WorkflowTemplate
from apps.workflow.node_shape import normalize_template_node


class WorkflowTemplateNodeSerializer(serializers.Serializer):
    """Serializer for a single template node.

    These field names are the canonical spelling of a stored node — see
    ``apps/workflow/node_shape.py`` for why this shape and not the
    ``name/court/type/order`` one ``WORKFLOW_TEMPLATES`` uses.

    On *input* only this shape is accepted, so nothing new is written in the
    other one. On *output* the node is normalized first, because rows in the
    other shape can already exist: ``seed_workflow_templates`` wrote
    ``WORKFLOW_TEMPLATES`` verbatim into ``nodes_json`` until this change, and
    rendering such a row raised ``KeyError: 'node_name'`` from
    ``rest_framework/fields.py`` — a 500 on ``GET
    /api/v1/workflow/templates/{id}/``, the mirror image of the
    ``KeyError: 'name'`` the same split caused in ``create_from_judgment``.
    Both are held as regressions in ``tests/test_workflow_node_shape.py``.
    """
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

    def to_representation(self, instance):
        """Render a stored node, in whichever shape it was stored.

        Anything that is not a mapping is handed to DRF unchanged so it fails
        the way it always did — this exists to translate a known older spelling,
        not to swallow junk in ``nodes_json``.
        """
        if isinstance(instance, dict):
            instance = normalize_template_node(instance)
        return super().to_representation(instance)


class WorkflowTemplateSerializer(serializers.ModelSerializer):
    """Serializer for WorkflowTemplate.

    ``priority`` is in ``fields`` deliberately and the omission would be
    silent: DRF drops unknown keys from ``request.data`` without complaint, so
    a template POSTed with ``"priority": 1`` from the editor would have been
    stored as 0 and answered 201, and every workflow built from it would have
    come out normal-priority with nothing anywhere saying why. That failure
    mode — an accepted request whose payload was quietly discarded — is the
    reason this field exists at the API layer at all, and
    ``tests/test_workflow_template_priority.py`` POSTs a 1 and reads the row
    back rather than trusting the 201.
    """
    nodes = WorkflowTemplateNodeSerializer(many=True, required=False, source='nodes_json')

    class Meta:
        model = WorkflowTemplate
        fields = [
            "id",
            "name",
            "description",
            "civilization",
            "case_type",
            "priority",
            "is_active",
            "nodes",
            "created_at",
            "updated_at",
            "tenant",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class WorkflowTemplateListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing templates.

    Deliberately omits `nodes` (the full node graph, source=`nodes_json` on
    the detail serializer below) — a list of every template's full node graph
    is the payload this serializer exists to avoid. `node_count` gives the
    one fact a list screen needs (how big is this template) without it.
    """

    node_count = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowTemplate
        fields = [
            "id",
            "name",
            "description",
            "civilization",
            "case_type",
            # Unlike `nodes`, one integer per row is not the payload this
            # serializer exists to avoid — and the list screen is where a user
            # picks which template to apply, so 「this one is for urgent
            # cases」 has to be visible before the detail fetch.
            "priority",
            "is_active",
            "created_at",
            "node_count",
        ]

    def get_node_count(self, obj):
        return len(obj.nodes_json or [])


class ApprovalNodeSerializer(serializers.ModelSerializer):
    """Serializer for ApprovalNode.

    `status`, `verdict`, `approver` and `decided_at` are the fields
    ApprovalWorkflow.complete_node() (called from
    ApprovalWorkflowViewSet.approve_node, gated by `workflow.approve`) writes
    to record a decision — and, in the same call, also advances the parent
    workflow's `current_node`/`status`, and sets `completed_at` when that was
    the last node. ApprovalNodeViewSet.partial_update maps to `workflow.update`,
    which MODERATOR holds despite being deliberately denied `workflow.approve`
    (see ApprovalWorkflowViewSet's extra_permissions and the ROLE_PERMISSIONS
    entry for MODERATOR) — so a plain PATCH here used to let MODERATOR forge a
    verdict on a real pending node while skipping every one of complete_node's
    side effects: the workflow never advanced, `completed_at` never got set,
    and nothing recorded that the "approval" never happened. validate() below
    closes that with an explicit 400, the same shape as
    DispatchRecordSerializer.validate() in apps/dispatch/serializers.py.

    Deliberately NOT in `read_only_fields`, unlike that dispatch precedent:
    ApprovalNodeViewSet.create() (via TenantCreateMixin.perform_create) calls
    `serializer.save()` directly with these fields as ordinary input, and node
    fixtures across apps/workflow/tests.py rely on POSTing a node with
    `status="APPROVED"` already set (to seed an already-decided node for
    advance/stats/approve_node scenarios) — DispatchRecordSerializer could make
    its equivalent fields fully read-only because DispatchRecordViewSet.create()
    never touches them at all (it routes through DispatchService.propose()
    instead). Making these four read-only here would have silently stripped
    them from every such POST instead of raising anything, defaulting every
    fixture node to PENDING and breaking that test file's assumptions. Guarding
    only the update path (`self.instance is not None`) keeps node creation
    exactly as permissive as before while closing the PATCH route onto an
    existing node.
    """

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

    def validate(self, attrs):
        """Reject an attempt to move `status`/`verdict`/`approver`/`decided_at` via PATCH.

        Only applies to updates (`self.instance is not None`); creation is
        untouched — see the class docstring for why these fields stay writable
        on POST. Checked against `self.initial_data` rather than `attrs` so an
        attempted write is caught even if the field would also fail its own
        validation for an unrelated reason (e.g. an `approver` id that doesn't
        exist) — the client still needs to learn this endpoint refuses the
        write, not receive whichever error surfaces first.
        """
        if self.instance is not None:
            blocked = [
                field
                for field in ("status", "verdict", "approver", "decided_at")
                if field in self.initial_data
            ]
            if blocked:
                raise serializers.ValidationError({
                    field: (
                        "Not settable through this endpoint once the node exists. "
                        "Use ApprovalWorkflowViewSet.approve_node (workflow.approve), "
                        "which also advances the workflow and sets completed_at — a "
                        "plain field write would skip both."
                    )
                    for field in blocked
                })
        return attrs


class ApprovalWorkflowSerializer(serializers.ModelSerializer):
    """Serializer for ApprovalWorkflow.

    `status` and `current_node` are read-only for the same reason as
    DispatchRecordSerializer's `status`/`dispatched_by`
    (apps/dispatch/serializers.py) — see that docstring for the shape this
    mirrors. ApprovalWorkflowViewSet.partial_update maps to `workflow.update`,
    which MODERATOR holds; `advance` requires `workflow.advance` (ADMIN,
    JUDGE), which MODERATOR is deliberately denied so that a realm lead who
    designs a flow cannot also push it forward unchecked. The *sanctioned*
    way past a stalled flow is `escalate` (`workflow.escalate`, which
    MODERATOR does hold) — it demands a written reason and always writes an
    AuditLog naming who overrode which node. A plain PATCH setting
    `current_node` directly reached the identical state change as `advance`
    while skipping both `advance_to_next()`'s own checks and, worse,
    `escalate`'s mandatory audit trail — the flow moved with no record of who
    authorized skipping a node or why. validate() below closes it.

    Unlike ApprovalNodeSerializer's equivalent fields, these ARE safe to mark
    fully read-only: nothing creates an ApprovalWorkflow via this serializer
    with `status` or `current_node` pre-set (both default sensibly — PENDING
    and null — on the model), so read-only here costs POST nothing.
    """

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
        read_only_fields = [
            "id",
            "status",
            "current_node",
            "created_at",
            "updated_at",
            "completed_at",
        ]

    def validate(self, attrs):
        """Reject an attempt to move `status`/`current_node` through CRUD.

        Mirrors DispatchRecordSerializer.validate(). Only applies to updates:
        `perform_create` (TenantCreateMixin) calls `serializer.save(**kwargs)`
        without either field, so `self.instance` is None for POST and there is
        nothing here to guard.
        """
        if self.instance is not None:
            blocked = [
                field for field in ("status", "current_node") if field in self.initial_data
            ]
            if blocked:
                raise serializers.ValidationError({
                    field: (
                        "Not settable through this endpoint. Use the advance/escalate "
                        "actions, which also carry the checks (advance) or the "
                        "mandatory-reason audit trail (escalate) a plain field write "
                        "would skip."
                    )
                    for field in blocked
                })
        return attrs


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
