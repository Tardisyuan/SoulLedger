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
        # `tenant` is set by TenantCreateMixin.perform_create from the request
        # (a save() kwarg, so read-only here does not disturb creation). It was
        # writable, and a MODERATOR could PATCH a template into another tenant
        # in one request -- measured 2026-08-29.
        read_only_fields = ["id", "created_at", "updated_at", "tenant"]


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

    The paragraph above used to end by saying these four were guarded on the
    update path only, because "node fixtures across apps/workflow/tests.py
    rely on POSTing a node with status='APPROVED' already set". That was true
    and it was not a reason. Closing PATCH while leaving POST open left the
    same forgery one request away by another door: measured 2026-08-29, a
    MODERATOR who gets 403 from approve_node can POST to /api/v1/nodes/ with
    status=APPROVED, verdict=PASSED, approver=<any user id> and
    decided_at=<any timestamp> and receive a 201. Nothing downstream
    distinguishes the resulting row from one complete_node() wrote. A test
    fixture's convenience is not a reason to leave a decision field writable —
    the fixtures now seed decided nodes through the ORM, which is where
    fixtures should be setting them anyway.

    So all four are read-only now, and validate() raises on create as well as
    update. Raising rather than silently stripping matters here for the same
    reason it does everywhere else in this file: a client that sends
    {"status": "APPROVED"} has to learn nothing was approved.

    `workflow` is validated against the requester's tenant rather than being
    left to the field's default queryset. That default is
    `ApprovalWorkflow.objects` — a TenantManager — but at serializer-validation
    time the tenant contextvar is not set, so it returned rows from every
    tenant: measured, `ApprovalNodeSerializer().fields["workflow"].queryset`
    handed back 2 rows across 2 tenants. `scope_to_tenant` is applied in
    `get_queryset()`, which covers PATCH and GET (a cross-tenant PATCH
    correctly 404s) and does not cover POST — so a MODERATOR in tenant A could
    POST a node into tenant B's live approval chain and get a 201.
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
        read_only_fields = [
            "id",
            "created_at",
            # A decision is recorded by complete_node(), never by a client.
            # See the class docstring for the forged-approval POST this closes.
            "status",
            "verdict",
            "approver",
            "decided_at",
        ]

    def validate_workflow(self, value):
        """A node may only be attached to a workflow the requester can reach.

        See the class docstring: the field's own queryset is a TenantManager
        evaluated with no tenant contextvar, so it does not scope anything at
        validation time, and `get_queryset()` scoping never runs on POST.
        ADMIN is exempt here for the same reason it is exempt everywhere else
        in this codebase (apps/core/tenant.py documents it as the one globally
        scoped role); every non-ADMIN caller is checked against the tenant on
        the request, falling back to the user's own tenant column because
        `force_authenticate` leaves `request.tenant` unset.
        """
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if getattr(user, "role", None) == "ADMIN":
            return value
        tenant = getattr(request, "tenant", None) or getattr(user, "tenant", None)
        if tenant is None or value.tenant_id != tenant.pk:
            raise serializers.ValidationError(
                "No such workflow in this tenant. A node cannot be attached to "
                "another tenant's approval chain."
            )
        return value

    def validate(self, attrs):
        """Reject an attempt to set `status`/`verdict`/`approver`/`decided_at`.

        Applies to create as well as update. Guarding update alone left the
        forgery one request away by another door — see the class docstring.
        Checked against `self.initial_data` rather than `attrs` so an attempted
        write is caught even if the field would also fail its own validation
        for an unrelated reason (e.g. an `approver` id that doesn't exist) —
        the client still needs to learn this endpoint refuses the write, not
        receive whichever error surfaces first.
        """
        blocked = [
            field
            for field in ("status", "verdict", "approver", "decided_at")
            if field in self.initial_data
        ]
        if blocked:
            raise serializers.ValidationError({
                field: (
                    "A decision is not settable through this endpoint, at "
                    "creation or afterwards. Use "
                    "ApprovalWorkflowViewSet.approve_node (workflow.approve), "
                    "which also advances the workflow and sets completed_at — a "
                    "plain field write would skip both and leave a row nothing "
                    "downstream can tell from a real approval."
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
            # Which tenant owns a workflow is not a client-supplied field.
            # TenantCreateMixin.perform_create passes it as a save() kwarg, so
            # this does not affect creation. It was writable, and a MODERATOR
            # -- a role deliberately denied `workflow.approve` and
            # `workflow.advance` -- could PATCH {"tenant": <other>} and hand the
            # row over in one request. The workflow keeps its original `soul`
            # FK while this serializer exposes `soul_name` and the whole `nodes`
            # list, so the receiving tenant reads a foreign soul's name and its
            # entire approval history and the owning tenant loses the row.
            # Measured 2026-08-29. The docstring above reasons carefully about
            # `status` and `current_node` and never mentions `tenant`.
            "tenant",
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
            # `soul` and `judgment` are what a workflow is *about*. They must
            # stay settable at creation (the POST body carries `soul`) and be
            # fixed afterwards -- re-pointing a live approval chain at a
            # different soul carries every decision already recorded on it
            # across to someone else's case.
            blocked = [
                field
                for field in ("status", "current_node", "soul", "judgment")
                if field in self.initial_data
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
