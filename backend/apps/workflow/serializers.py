"""
Serializers for workflow app.
"""
from datetime import timedelta

from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers
from rest_framework.exceptions import APIException

from apps.core.tenant import is_tenant_exempt
from apps.core.tenant_fields import tenant_scoped
from apps.workflow.models import (
    ApprovalNode,
    ApprovalWorkflow,
    ApprovalWorkflowStatus,
    NodeStatus,
    WorkflowTemplate,
    WorkflowTemplateVersion,
)
from apps.workflow.node_shape import normalize_template_node


class TemplateSignerSerializer(serializers.Serializer):
    """One 会签 signer, spelled like a one-person node: a label (a person's
    name, probed like a node label), or a ROLE with a role."""
    label = serializers.CharField(max_length=255, allow_blank=True, default="")
    # CharField + validator rather than a third ChoiceField over the same
    # values: drf-spectacular would otherwise invent a hashed enum name
    # (tests/test_schema_has_no_warnings.py).
    approver_type = serializers.CharField(max_length=10, default="ROLE")
    approver_role = serializers.CharField(max_length=20, allow_blank=True, default="")

    def validate_approver_type(self, value):
        if value not in ("ACTOR", "ROLE", "SYSTEM"):
            raise serializers.ValidationError("approver_type must be ACTOR, ROLE or SYSTEM")
        return value


class ConditionClauseSerializer(serializers.Serializer):
    """`{fact, op, value}` — see `apps/workflow/conditions.py`. Shape only here;
    whether the fact/op/value combine is checked at publish, so a half-edited
    condition can still be saved as a draft."""
    fact = serializers.CharField(max_length=20)
    op = serializers.CharField(max_length=10)
    value = serializers.JSONField()


class TemplateBranchSerializer(serializers.Serializer):
    id = serializers.CharField(required=False, allow_blank=True, default="")
    when = ConditionClauseSerializer(many=True)
    target = serializers.CharField(allow_blank=True)


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

    # ── Routing and layout ─────────────────────────────────────────────
    #
    # This is a `serializers.Serializer` with a declared field list, so DRF
    # DROPS any key it does not name. Adding the model fields and the editor UI
    # without adding them here would have produced the defect in its purest
    # form: the editor draws a branch, the request carries it, and the
    # serializer silently discards it on the way in. `nodes_json` is a
    # JSONField, so nothing else would have complained.
    #
    # `on_pass`/`on_fail` hold the TEMPLATE-LOCAL node id (the `id` field
    # above), not an ApprovalNode pk — a template is not an instance, and the
    # instance rows do not exist until a workflow is created from it.
    # `WorkflowService` maps these to real FKs at instantiation.
    on_pass = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, default=None
    )
    on_fail = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, default=None
    )
    # Canvas coordinates. Purely presentational — the engine never reads them —
    # but without them a dragged arrangement is lost on every reload, which is
    # what made the editor re-stack every graph into one tall column.
    position = serializers.DictField(
        child=serializers.FloatField(), required=False, allow_null=True, default=None
    )

    # 驳回到: the template-local id of an EARLIER node to send the flow back
    # to on FAIL. Same id space as on_pass / on_fail.
    reject_to = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, default=None
    )
    # 超时. Validated as a set by `validation.py` at publish (hours without an
    # action, ESCALATE without a role); here only each value's own type.
    timeout_hours = serializers.IntegerField(
        required=False, allow_null=True, min_value=1, max_value=24 * 365, default=None
    )
    timeout_action = serializers.ChoiceField(
        choices=["ESCALATE", "AUTO_REJECT", "NOTIFY"],
        required=False, allow_blank=True, allow_null=True, default=None,
    )
    timeout_role = serializers.CharField(
        max_length=20, required=False, allow_blank=True, allow_null=True, default=None
    )

    # 会签 / 通知 / 结束 and condition branches (workflow/0021).
    kind = serializers.ChoiceField(
        choices=["APPROVAL", "COUNTERSIGN", "NOTIFY", "END"], required=False, default="APPROVAL"
    )
    signers = TemplateSignerSerializer(many=True, required=False, default=list)
    threshold = serializers.IntegerField(required=False, allow_null=True, min_value=1, default=None)
    branches = TemplateBranchSerializer(many=True, required=False, default=list)

    def to_representation(self, instance):
        """Render a stored node, in whichever shape it was stored.

        Anything that is not a mapping is handed to DRF unchanged so it fails
        the way it always did — this exists to translate a known older spelling,
        not to swallow junk in ``nodes_json``.
        """
        if isinstance(instance, dict):
            instance = normalize_template_node(instance)
        return super().to_representation(instance)


class TemplatePairRefusedError(APIException):
    """400 with `template_pair_refusal`'s body as it is (a `ValidationError` would wrap each value in a list, and
    clients branch on a scalar `code`)."""

    status_code = 400
    default_code = "case_type_not_for_civilization"

    def __init__(self, body):
        super().__init__(body)


#: The refusal code of a template whose case type its civilization does not have.
CASE_TYPE_NOT_FOR_CIVILIZATION = "case_type_not_for_civilization"


def template_pair_refusal(civilization, case_type) -> dict | None:
    """The 400 body for a template pair no workflow can be built for, or None. Shared by save and publish."""
    from apps.workflow.services import WorkflowService

    message = WorkflowService.validate_civilization_case_type(civilization, case_type)
    if message is None:
        return None
    return {"code": CASE_TYPE_NOT_FOR_CIVILIZATION, "case_type": [message],
            "civilization": civilization, "case_type_value": case_type}


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
    # VERSIONED (0018). `nodes` is the WORKING COPY: on read, the draft if the
    # template has one, else the published graph; on write, it goes to the
    # draft (`versioning.save_draft`) and never to `nodes_json`, which only
    # `versioning.publish` writes. So a save from the editor cannot change what
    # the next workflow runs on — publishing does. `published_version` /
    # `draft_version` are the numbers the editor's badge shows
    # (「草稿 v4 · 已发布 v3」); either can be null.
    nodes = WorkflowTemplateNodeSerializer(many=True, required=False, source='nodes_json')
    published_version = serializers.SerializerMethodField()
    draft_version = serializers.SerializerMethodField()

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
            "published_version",
            "draft_version",
            "created_at",
            "updated_at",
            "tenant",
        ]
        # `tenant` is set by TenantCreateMixin.perform_create from the request
        # (a save() kwarg, so read-only here does not disturb creation). It was
        # writable, and a MODERATOR could PATCH a template into another tenant
        # in one request -- measured 2026-08-29.
        read_only_fields = ["id", "created_at", "updated_at", "tenant"]

    def get_published_version(self, obj) -> int | None:
        return obj.published_version.number if obj.published_version_id else None

    def get_draft_version(self, obj) -> int | None:
        from apps.workflow.versioning import draft_of

        draft = draft_of(obj) if obj.pk else None
        return draft.number if draft else None

    def to_representation(self, instance):
        from apps.workflow.versioning import working_nodes

        data = super().to_representation(instance)
        data["nodes"] = WorkflowTemplateNodeSerializer(
            working_nodes(instance), many=True
        ).data
        return data

    def validate(self, attrs):
        """A template's (civilization, case type) must be a pair a workflow can be built for
        (`VALID_CASE_TYPES_BY_CIVILIZATION`, 2026-10-29). Saved unchecked, a mismatched template was stored and
        then never used: every workflow of that pair is refused at `start_workflow`."""
        def value(field):
            if field in attrs:
                return attrs[field]
            if self.instance is not None:
                return getattr(self.instance, field)
            return WorkflowTemplate._meta.get_field(field).default  # what a create without it stores

        refusal = template_pair_refusal(value("civilization"), value("case_type"))
        if refusal is not None:
            raise TemplatePairRefusedError(refusal)
        return attrs

    def _save_nodes(self, template, nodes):
        from apps.workflow.versioning import save_draft

        request = self.context.get("request")
        save_draft(template, nodes, user=getattr(request, "user", None))

    def create(self, validated_data):
        nodes = validated_data.pop("nodes_json", None)
        template = super().create(validated_data)
        if nodes is not None:
            self._save_nodes(template, nodes)
        return template

    def update(self, instance, validated_data):
        nodes = validated_data.pop("nodes_json", None)
        template = super().update(instance, validated_data)
        if nodes is not None:
            self._save_nodes(template, nodes)
        return template


class WorkflowTemplateVersionSerializer(serializers.ModelSerializer):
    """One row of a template's version history. Read-only: versions are written
    by `versioning.py` alone, through save and publish."""

    nodes = serializers.SerializerMethodField()
    saved_by_name = serializers.SerializerMethodField()
    published_by_name = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowTemplateVersion
        fields = [
            "id",
            "number",
            "status",
            "nodes",
            "created_at",
            "updated_at",
            "published_at",
            "saved_by_name",
            "published_by_name",
        ]
        read_only_fields = fields

    @extend_schema_field(WorkflowTemplateNodeSerializer(many=True))
    def get_nodes(self, obj):
        return WorkflowTemplateNodeSerializer(obj.nodes_json or [], many=True).data

    @staticmethod
    def _name(user) -> str | None:
        if user is None:
            return None
        return getattr(user, "display_name", "") or user.username

    def get_saved_by_name(self, obj) -> str | None:
        return self._name(obj.saved_by)

    def get_published_by_name(self, obj) -> str | None:
        return self._name(obj.published_by)


class WorkflowTemplateListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing templates.

    Deliberately omits `nodes` (the full node graph, source=`nodes_json` on
    the detail serializer below) — a list of every template's full node graph
    is the payload this serializer exists to avoid. `node_count` gives the
    one fact a list screen needs (how big is this template) without it.
    """

    node_count = serializers.SerializerMethodField()
    published_version = serializers.SerializerMethodField()

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
            "published_version",
            # 「发起审批」(W-11)的模板下拉只列灵魂所在殿的模板;全局管理员的列表跨殿,没有这一列分不出来。
            "tenant",
        ]
        read_only_fields = ["tenant"]

    def get_node_count(self, obj) -> int:
        return len(obj.nodes_json or [])

    def get_published_version(self, obj) -> int | None:
        return obj.published_version.number if obj.published_version_id else None


class CosignerRowSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    name = serializers.CharField()
    signed = serializers.BooleanField()


class WaitingOnCosignerSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class WorkflowSegmentSerializer(serializers.Serializer):
    """One realm's segment of a workflow (第四十三批), as `segments.segment_row` builds it. `state` is derived:
    AWAITING_PICK / PICKED (not started) / RUNNING / DONE / SKIPPED. `go` / `total` = stations to run / all.
    `picked_by_name` is null for another realm's segment (外域人员信息不外露). `can_*` are for the requester."""

    order = serializers.IntegerField()
    is_local = serializers.BooleanField()
    tenant_code = serializers.CharField()
    realm_name = serializers.CharField()
    civilization = serializers.CharField()
    name = serializers.CharField()
    state = serializers.CharField()
    go = serializers.IntegerField()
    total = serializers.IntegerField()
    default_node_count = serializers.IntegerField()
    version = serializers.IntegerField()
    picked_at = serializers.DateTimeField(allow_null=True)
    picked_by_name = serializers.CharField(allow_null=True)
    at_gate = serializers.BooleanField(help_text="流程正停在这一段门口等它选站。")
    gate_days = serializers.IntegerField(allow_null=True, help_text="在门口第几天(到达那天是第 1 天)。")
    no_picker = serializers.BooleanField(help_text="该域没有能选站的判官(待办已转给殿管理员)。")
    current_order_in_segment = serializers.IntegerField(allow_null=True)
    can_pick = serializers.BooleanField()
    can_use_default = serializers.BooleanField()
    can_remind = serializers.BooleanField()


class WorkflowHistoryEntrySerializer(serializers.Serializer):
    """「选站」「加减站」记录(审计行)。`actor` 只对同一个域的人给。"""

    kind = serializers.CharField(help_text="picked / adjusted / default")
    segment = serializers.IntegerField(allow_null=True)
    realm = serializers.CharField(help_text="该段所属域的租户代码")
    actor = serializers.CharField(allow_null=True)
    at = serializers.DateTimeField()
    restored = serializers.ListField(child=serializers.CharField())
    skipped = serializers.ListField(child=serializers.CharField())
    reason = serializers.CharField(allow_blank=True)


class CrossFlowAtSerializer(serializers.Serializer):
    segment = serializers.IntegerField()
    realm_name = serializers.CharField()
    node_name = serializers.CharField()
    hall = serializers.CharField(allow_blank=True)


class CrossFlowGateSerializer(serializers.Serializer):
    segment = serializers.IntegerField()
    realm_name = serializers.CharField()
    days = serializers.IntegerField(allow_null=True)


class CrossJudgmentWorkflowSummarySerializer(serializers.Serializer):
    """跨域审判页顶部那一条(W-4),`segments.cross_summary` 构造。`fixed` = 已选站的段里要走的站数,
    `done` = 已通过 / 经过 / 越级的站数。"""

    id = serializers.CharField()
    number = serializers.CharField()
    status = serializers.CharField()
    at = CrossFlowAtSerializer(allow_null=True)
    at_gate = CrossFlowGateSerializer(allow_null=True)
    fixed = serializers.IntegerField()
    done = serializers.IntegerField()
    pending_realms = serializers.ListField(child=serializers.CharField())
    segments = WorkflowSegmentSerializer(many=True)


class JumpSourceSerializer(serializers.Serializer):
    """A station whose rejection jumps to this one (`on_fail`). `key` is what the client sends back for that station:
    its `node_order` before the flow exists (flow preview), its node id after."""

    key = serializers.CharField()
    node_name = serializers.CharField()
    via = serializers.ChoiceField(
        choices=["on_fail", "branch"],
        help_text="on_fail = 驳回时转来;branch = 条件分支的去处(如按出身地域分流)。客户端据此写锁住的理由(第四十五批)。")


class WorkflowConflictError(APIException):
    """409 `{"error", "code"}`: the flow is in a state that forbids this write (rbac-be1, 2026-10-29)."""

    status_code = 409
    default_code = "workflow_started"

    def __init__(self, code: str, message: str):
        super().__init__({"error": message, "code": code})


def refuse_started(workflow, what: str) -> None:
    """A started flow's stations are fixed (H2): adding, changing or removing one would re-draw the approval
    chain under the people already deciding it — drop a station without `escalate`'s reason, or hand the next
    one to a cooperative approver. Only a not-yet-started flow (`has_started`) may be edited station by station."""
    if workflow is not None and workflow.has_started:
        raise WorkflowConflictError("workflow_started", f"The flow has started; its {what} can no longer be changed.")


def _foreign_signature(sig):
    return {**sig, "user_id": None, "user_name": None, **({"notes": ""} if "notes" in sig else {})}


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

    # `approver` is the deciding user's pk. The web detail page had nothing
    # else to show and rendered MissingValue in its place (see the comment at
    # the `approver` line of `app/workflow/[id]/page.tsx`). Username is the
    # recoverable identifier, display_name the readable one; both null while
    # the node is undecided or the account is gone.
    approver_username = serializers.CharField(source="approver.username", read_only=True, allow_null=True)
    approver_display_name = serializers.CharField(source="approver.display_name", read_only=True, allow_null=True)
    # 加签 (apps/workflow/cosign.py): who was added, and -- for the requester only -- the first signer
    # still owed when that holds back the requester's approval.
    cosigners = serializers.SerializerMethodField()
    waiting_on_cosigner = serializers.SerializerMethodField()
    # 第四十三批: which realm's segment (its order, 1 = this realm) and the station's number inside it.
    segment_order = serializers.IntegerField(source="segment.order", read_only=True, allow_null=True, default=None)
    order_in_segment = serializers.SerializerMethodField()
    jump_target_of = serializers.SerializerMethodField()

    def get_order_in_segment(self, node) -> int | None:
        if node.segment_id is None:
            return None
        cache = self.context.setdefault("_order_in_segment", {})
        if node.segment_id not in cache:
            ids = ApprovalNode.objects.filter(segment_id=node.segment_id).order_by("node_order", "pk").values_list(
                "pk", flat=True)
            cache[node.segment_id] = {pk: i for i, pk in enumerate(ids, start=1)}
        return cache[node.segment_id].get(node.pk)

    @extend_schema_field(JumpSourceSerializer(many=True))
    def get_jump_target_of(self, node):
        """The stations of this segment whose `on_fail` lands here (2026-10-19): pick / adjust lock this one while any
        of them still runs. All of them, whatever their state — the client works out which still run from its own
        ticks, so the lock lifts the moment the last one is unticked."""
        if node.segment_id is None:
            return []
        cache = self.context.setdefault("_jump_sources", {})
        if node.segment_id not in cache:
            from apps.workflow.segments import jump_sources

            cache[node.segment_id] = jump_sources(list(ApprovalNode.objects.filter(segment_id=node.segment_id)))
        from apps.workflow.segments import jump_via

        return [{"key": str(s.pk), "node_name": s.node_name, "via": jump_via(node.pk, s.on_fail_id)}
                for s in cache[node.segment_id].get(node.pk, [])]

    def to_representation(self, node):
        """Another realm's stations show the realm, not its people (第四十三批, Design W-5c):
        the approver, signers and co-signers of a node in a segment the reader's realm does not run are blanked."""
        data = super().to_representation(node)
        if node.segment_id is None:
            return data
        from apps.workflow.segments import viewer_tenant_id

        viewer = viewer_tenant_id(self.context.get("request"), node.workflow)
        if viewer is None or viewer == node.segment.tenant_id:
            return data
        # 决定 24(2026-10-29):别站的意见原文也不给 —— 节点 notes、会签各人的 notes、退回前的旧意见。
        data.update(approver=None, approver_username=None, approver_display_name=None, cosigners=[],
                    waiting_on_cosigner=None, notes="")
        data["signatures_json"] = [_foreign_signature(sig) for sig in data.get("signatures_json") or []]
        data["decision_history"] = [
            {**entry, "approver_id": None, "approver_name": None, "notes": "",
             "signatures": [_foreign_signature(sig) for sig in entry.get("signatures") or []]}
            if "approver_name" in entry else entry for entry in data.get("decision_history") or []]
        return data

    @extend_schema_field(CosignerRowSerializer(many=True))
    def get_cosigners(self, node):
        return self._cosign_facts(node)["cosigners"]

    @extend_schema_field(WaitingOnCosignerSerializer(allow_null=True))
    def get_waiting_on_cosigner(self, node):
        return self._cosign_facts(node)["waiting_on_cosigner"]

    def _cosign_facts(self, node):
        from apps.workflow import cosign

        user = getattr(self.context.get("request"), "user", None)
        if not node.cosigners_json or user is None:
            return {"cosigners": [], "waiting_on_cosigner": None}
        return cosign.facts(node, user)

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
            "approver_username",
            "approver_display_name",
            "cosigners",
            "waiting_on_cosigner",
            "decided_at",
            "created_at",
            "reject_to",
            "decision_history",
            "timeout_hours",
            "timeout_action",
            "timeout_role",
            "activated_at",
            "timed_out_at",
            "kind",
            "signers_json",
            "threshold",
            "signatures_json",
            "branches_json",
            # 第四十五批 W-5:分流走了默认那条(不详)时,流程详情要写它去了哪一站。
            "on_pass",
            "segment_order",
            "order_in_segment",
            "skip_kind",
            "skip_reason",
            "is_required",
            "jump_target_of",
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
            # The 0020 columns are template-copied settings or engine state,
            # written by `_create_nodes`, `_return_to` and the timeout
            # processor. Writable, `decision_history` would be a forged past
            # and `timed_out_at` a way to suppress a timeout — the same shape
            # of hole `validate()` below closes for the decision fields.
            "reject_to",
            "decision_history",
            "timeout_hours",
            "timeout_action",
            "timeout_role",
            "activated_at",
            "timed_out_at",
            "kind",
            "signers_json",
            "threshold",
            "signatures_json",
            "branches_json",
            "on_pass",
            # 选站 / 加减站 write these, through `apps/workflow/segments.py` only.
            "skip_kind",
            "skip_reason",
            "is_required",
        ]

    # rbac-be1 L3: a station's court and designated approver belong to the requester's hall too.
    validate_realm = tenant_scoped("realm")
    validate_approver_actor = tenant_scoped("approver_actor")

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
        if is_tenant_exempt(user):
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
        # H2: neither the station's flow nor the flow it is moved to may have started.
        refuse_started(getattr(self.instance, "workflow", None), "stations")
        refuse_started(attrs.get("workflow"), "stations")
        return attrs


class WorkflowJudgmentAppealSerializer(serializers.Serializer):
    """The soul's appeal an APPEAL workflow was started for (apps/judgment/appeals.py, user 2026-10-27)."""

    id = serializers.UUIDField()
    case_number = serializers.CharField(source="judgment.case_number")
    round = serializers.IntegerField()
    status = serializers.CharField()


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
    # 实例信息卡上的案号(人读的那个编号);没挂审判的流程是 null。
    judgment_case_number = serializers.CharField(
        source="judgment.case_number", read_only=True, allow_null=True, default=None
    )

    # `validate()` below locks these three, but only when `self.instance is not
    # None` — i.e. on update. On POST there is no instance, so the branch never
    # runs and the fields resolve against a manager that does not scope by
    # tenant. `ApprovalNodeSerializer.validate_workflow` (same file) already
    # closed the child's half of this; these are the parent's.
    # Which published template version this workflow runs on (0018); null for
    # one built from the code tables or an unversioned row.
    template_version_number = serializers.IntegerField(
        source="template_version.number", read_only=True, allow_null=True, default=None
    )

    validate_soul = tenant_scoped("soul")
    validate_judgment = tenant_scoped("judgment")
    validate_original_workflow = tenant_scoped("original_workflow")
    validate_coordinating_realm = tenant_scoped("coordinating_realm")  # rbac-be1 L3

    # 第四十三批: one row per realm's segment (empty for a workflow built before segments); the segment the flow
    # stands at the gate of, waiting for that realm to pick; the 选站 / 加减站 records; whether the requester may
    # change stations now; and the cross-realm judgment this workflow merged, if any.
    segments = serializers.SerializerMethodField()
    awaiting_segment = serializers.SerializerMethodField()
    history = serializers.SerializerMethodField()
    can_adjust = serializers.SerializerMethodField()
    can_approve = serializers.SerializerMethodField()
    cross_judgment_id = serializers.SerializerMethodField()
    judgment_appeal = serializers.SerializerMethodField()

    def to_representation(self, obj):
        """决定 24:别殿(合并流程的参与域)读流程时不给召集殿写的 `notes`(别站意见原文在节点序列化器里收)。"""
        data = super().to_representation(obj)
        from apps.workflow.segments import viewer_tenant_id

        viewer = viewer_tenant_id(self.context.get("request"), obj)
        if viewer is not None and viewer != obj.tenant_id:
            data["notes"] = ""
        return data

    @extend_schema_field(WorkflowSegmentSerializer(many=True))
    def get_segments(self, obj):
        from apps.workflow import segments

        return segments.segment_rows(obj, self.context.get("request"))

    @extend_schema_field(serializers.IntegerField(allow_null=True))
    def get_awaiting_segment(self, obj):
        from apps.workflow import segments

        gate = next((s for s in obj.segments.all() if segments.at_gate(s, obj)), None)
        return gate.order if gate else None

    @extend_schema_field(WorkflowHistoryEntrySerializer(many=True))
    def get_history(self, obj):
        from apps.workflow import segments

        return segments.history(obj, self.context.get("request"))

    @extend_schema_field(serializers.BooleanField())
    def get_can_adjust(self, obj):
        from apps.workflow import segments

        request = self.context.get("request")
        return request is not None and segments.can_adjust_any(obj, request)

    @extend_schema_field(serializers.BooleanField())
    def get_can_approve(self, obj):
        """Whether the requester may decide the current node now — `approve_node`'s own gates (workflow.approve +
        `ApprovalNode.can_approve` via `decision_codes.block_for`, and the node is the current stop). The web's
        「提交判决」 and 「待我处理」 read this instead of the codename alone (rbac-web M-6)."""
        from apps.workflow import decision_codes

        request = self.context.get("request")
        node = obj.current_node
        user = getattr(request, "user", None)
        if node is None or user is None or not obj.is_current(node):
            return False
        return decision_codes.block_for(node, user) is None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_cross_judgment_id(self, obj):
        from apps.workflow import segments

        cross = segments.cross_of(obj) if obj.segments.filter(order__gt=1).exists() else None
        return str(cross.pk) if cross else None

    @extend_schema_field(WorkflowJudgmentAppealSerializer(allow_null=True))
    def get_judgment_appeal(self, obj):
        from apps.judgment.models import JudgmentAppeal

        appeal = JudgmentAppeal.all_objects.select_related("judgment").filter(workflow_id=obj.pk).first()
        return WorkflowJudgmentAppealSerializer(appeal).data if appeal else None

    class Meta:
        model = ApprovalWorkflow
        fields = [
            "id",
            "number",
            "judgment",
            "judgment_verdict",
            "judgment_case_number",
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
            "template_version_number",
            "return_count",
            "end_reason",
            "tenant",
            "segments",
            "awaiting_segment",
            "history",
            "can_adjust",
            "can_approve",
            "cross_judgment_id",
            "judgment_appeal",
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
            "return_count",
            "end_reason",
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
            # L10: what kind of case a running flow is decided which stations it has; it cannot change midway.
            if self.instance.has_started:
                changed = [f for f in ("case_type", "is_appeal", "cross_civilization")
                           if f in attrs and attrs[f] != getattr(self.instance, f)]
                if changed:
                    raise WorkflowConflictError(
                        "workflow_started", f"The flow has started; {', '.join(changed)} can no longer be changed.")
        return attrs


class ApprovalWorkflowListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing workflows."""

    # `soul` on this serializer is the primary key, a UUID, and the workflow
    # list rendered it straight into the row as though it were a name --
    # `十殿审判流程 常规审判 · 11111111-1111-4111-8111-111111111111`. The
    # dispatch list serializer beside it has always sent `soul_name` for
    # exactly this reason; this one did not, so the page had nothing else to
    # show. One string per row is not the payload a list serializer exists to
    # avoid.
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    # 当前节点是否已过超时时限(「已超时」徽标);算法同 `WorkflowFilter.filter_overdue`,列表已 select_related 当前节点。
    is_overdue = serializers.SerializerMethodField()

    def get_is_overdue(self, obj) -> bool:
        node = obj.current_node
        return bool(
            obj.status == ApprovalWorkflowStatus.IN_PROGRESS
            and node is not None
            and node.status == NodeStatus.PENDING
            and node.timeout_hours
            and node.activated_at is not None
            and node.activated_at + timedelta(hours=node.timeout_hours) < timezone.now()
        )

    class Meta:
        model = ApprovalWorkflow
        fields = [
            "id",
            "number",
            "workflow_name",
            "soul",
            "soul_name",
            "case_type",
            "priority",
            "status",
            "is_appeal",
            "cross_civilization",
            "is_overdue",
            "created_at",
            "completed_at",
        ]


class ApprovalWorkflowExportSerializer(ApprovalWorkflowListSerializer):
    """The CSV row (one per instance, Design batch 28 W5): the list's fields plus the current step, who started it
    and how long it took. Not a response schema -- only `export` uses it, through `export_csv`.

    `duration_minutes` is empty while the instance is still running: a figure that moves with the minute the file
    was exported is not a property of the instance.
    """

    current_node_name = serializers.SerializerMethodField()
    initiator = serializers.SerializerMethodField()
    duration_minutes = serializers.SerializerMethodField()

    class Meta(ApprovalWorkflowListSerializer.Meta):
        fields = ApprovalWorkflowListSerializer.Meta.fields + ["current_node_name", "initiator", "duration_minutes"]

    def get_current_node_name(self, obj) -> str:
        return obj.current_node.node_name if obj.current_node_id else ""

    def get_initiator(self, obj) -> str:
        user = obj.create_user
        return (user.display_name or user.username) if user else ""

    def get_duration_minutes(self, obj) -> int | None:
        if obj.completed_at is None:
            return None
        return max(0, int((obj.completed_at - obj.created_at).total_seconds() // 60))


#: 一个节点决定可以取的裁决。命名成常量是为了 ENUM_NAME_OVERRIDES 能指到它:
#: approve_node 的请求体进了 OpenAPI 之后,这组选项与 judgment 的 Verdict 同名为 `verdict`。
NODE_DECISION_VERDICTS = ["PASSED", "FAILED", "CONFIRMED", "REJECTED", "SKIPPED"]


class WorkflowNodeActionSerializer(serializers.Serializer):
    """Serializer for node approval action."""

    verdict = serializers.ChoiceField(choices=NODE_DECISION_VERDICTS)
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    # 官员端 App 传 true:驳回(非 PASSED/CONFIRMED)必须带 `notes`,否则 400 `reason_required`。
    require_reason = serializers.BooleanField(required=False, default=False)
    # 只对转生申请工作流有意义(CaseType.REBIRTH_APPLICATION):驳回时必填,是**灵魂能看到**
    # 的那段话。`notes` 仍是内部备注,灵魂接口不返回它。其他工作流忽略这个字段。
    rejection_reason_for_soul = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=2000
    )


class WorkflowStartSerializer(serializers.Serializer):
    """Body of `POST /workflows/start/` (W-11: 官员为任一灵魂手动发起审批).

    Shape only. Which soul / template the caller may reach, and whether the
    pair is valid for the soul's civilization, is the view's and the service's
    job — those need the request's tenant.
    """

    soul = serializers.UUIDField()
    # One of the two, not both: `case_type` resolves a template the way
    # create_from_judgment does; `template` names a stored one directly.
    case_type = serializers.CharField(required=False, max_length=50)
    template = serializers.UUIDField(required=False)
    # Absent = the template's own priority (see WorkflowService._resolve_priority).
    priority = serializers.IntegerField(required=False, min_value=0, max_value=2)
    reason = serializers.CharField(max_length=1000)  # trimmed by CharField; blank is refused
    judgment = serializers.UUIDField(required=False)
    # 第四十三批 W-1: the template's station orders (`node_order`) the judge unticked. The final review is
    # refused (400 `final_required`); an order the template does not have, 400 `unknown_node`.
    skip_node_orders = serializers.ListField(child=serializers.IntegerField(min_value=1), required=False,
                                             default=list, max_length=100)

    def validate(self, attrs):
        if bool(attrs.get("case_type")) == bool(attrs.get("template")):
            raise serializers.ValidationError(
                {"case_type": "Give exactly one of case_type or template."}, code="case_type_or_template"
            )
        return attrs


class WorkflowPickSerializer(serializers.Serializer):
    """`POST /workflows/{id}/segments/{order}/pick/`: the stations of that segment to skip (the rest run).
    `version` is the segment's as the picker loaded it."""

    skip_node_ids = serializers.ListField(child=serializers.UUIDField(), default=list, max_length=100)
    version = serializers.IntegerField(min_value=1)
    reason = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")


class WorkflowAdjustSerializer(serializers.Serializer):
    """`POST /workflows/{id}/adjust/` (加减站): stations of ONE segment to restore / to skip. Reason required."""

    restore_node_ids = serializers.ListField(child=serializers.UUIDField(), default=list, max_length=100)
    skip_node_ids = serializers.ListField(child=serializers.UUIDField(), default=list, max_length=100)
    reason = serializers.CharField(max_length=1000)
    version = serializers.IntegerField(min_value=1)


class WorkflowReasonSerializer(serializers.Serializer):
    """`POST /workflows/{id}/segments/{order}/use-default/` and `POST /workflows/{id}/advance/`."""

    reason = serializers.CharField(max_length=1000)


class WorkflowRemindSerializer(serializers.Serializer):
    order = serializers.IntegerField()
    reminded_at = serializers.DateTimeField()


class FlowPreviewStationSerializer(serializers.Serializer):
    node_order = serializers.IntegerField(help_text="站序;勾掉的站以它送进 `skip_node_orders`。")
    node_name = serializers.CharField()
    court_code = serializers.CharField(allow_blank=True)
    approver = serializers.CharField(allow_null=True, help_text="具名的冥官 / 唯一的那个人;按角色派且不止一人时 null。")
    approver_role = serializers.CharField(allow_null=True, help_text="按角色派时的角色成员(客户端翻译)。")
    is_required = serializers.BooleanField(help_text="终审:不能跳过。")
    jump_target_of = JumpSourceSerializer(
        many=True, help_text="驳回时会转到这一站的站;其中还要走的站在,这一站就不能跳过(`jump_target_required`)。")


class FlowPreviewForeignSerializer(serializers.Serializer):
    order = serializers.IntegerField()
    tenant_code = serializers.CharField()
    realm_name = serializers.CharField()
    default_node_count = serializers.IntegerField()
    nothing_to_pick = serializers.BooleanField(
        help_text="那个域的默认流程没有一站能跳过:那一段建好就是 PICKED,不等选站(第四十五批)。")


class FlowPreviewSerializer(serializers.Serializer):
    """`GET /workflows/flow-preview/` (W-1): the stations of this realm's default flow before the workflow is
    generated, and the other realms that will follow (`segments.flow_preview`)."""

    name = serializers.CharField()
    stations = FlowPreviewStationSerializer(many=True)
    foreign = FlowPreviewForeignSerializer(many=True)
    nothing_to_pick = serializers.BooleanField(
        help_text="没有一站能跳过(终审、自动节点、锁着的驳回 / 分支目标):客户端跳过选站这一步(第四十五批)。")


class WorkflowCaseTypeSerializer(serializers.Serializer):
    """One row of `GET /workflows/case-types/`: a case type the civilization admits.

    `builtin` = a built-in flow exists for the pair (`WORKFLOW_TEMPLATES`). False means that, without a
    stored template of the hall's own, the workflow gets the generic one-node 审批节点 flow
    (`WorkflowService._generic_template`).
    """

    value = serializers.CharField()
    builtin = serializers.BooleanField()


class WorkflowStatsSerializer(serializers.Serializer):
    """The dict `WorkflowService.get_workflow_stats` builds.

    Schema-only, never instantiated. `pending_nodes` is counted and
    `completed_nodes` is derived as `total - pending`, so the two always sum to
    `total_nodes` even for a status neither bucket names — see the note at
    `apps/workflow/services.py:726`. `progress_percent` is 0-100, not 0-1, and
    is a float because it is a ratio times 100, not a rounded percentage.
    """

    total_nodes = serializers.IntegerField()
    completed_nodes = serializers.IntegerField()
    pending_nodes = serializers.IntegerField()
    progress_percent = serializers.FloatField()


# ── Approver preview (doc-only shapes; `apps/workflow/preview.py` builds the dict) ──


class ApproverPreviewUserSerializer(serializers.Serializer):
    display_name = serializers.CharField()
    role = serializers.CharField()


class ApproverPreviewActorSerializer(serializers.Serializer):
    name = serializers.CharField()
    name_zh = serializers.CharField(allow_blank=True)
    role = serializers.CharField()


class ApproverAssignmentSerializer(serializers.Serializer):
    # CharField, not a ChoiceField: a third copy of the ACTOR/ROLE/SYSTEM set
    # makes drf-spectacular invent a hashed enum name (test_schema_has_no_warnings).
    approver_type = serializers.CharField()
    actor = ApproverPreviewActorSerializer(allow_null=True)
    role = serializers.CharField(allow_null=True)
    users = ApproverPreviewUserSerializer(many=True)
    user_count = serializers.IntegerField()


class SignerPreviewSerializer(ApproverAssignmentSerializer):
    label = serializers.CharField(allow_blank=True)


class ApproverPreviewSerializer(ApproverAssignmentSerializer):
    node = serializers.CharField()
    civilization = serializers.CharField()
    tenant = serializers.CharField()
    kind = serializers.CharField()
    # 会签 only: each signer as it resolves. Empty for every other kind.
    signers = SignerPreviewSerializer(many=True)
