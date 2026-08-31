"""
Workflow models — approval workflow engine for soul judgment.
Supports multi-stage approvals across Chinese, European, and Egyptian civilizations.
"""
import uuid

from django.db import models

from apps.core.models import AuditUserFields
from apps.tenants.managers import TenantManager


class ApprovalWorkflowStatus(models.TextChoices):
    PENDING = "PENDING", "待审批"
    IN_PROGRESS = "IN_PROGRESS", "审批中"
    APPROVED = "APPROVED", "已批准"
    REJECTED = "REJECTED", "已拒绝"
    APPEAL = "APPEAL", "申诉中"
    EXCEPTION = "EXCEPTION", "异常处理"
    COMPLETED = "COMPLETED", "流程完成"


#: 走到这里流程就结束了,不再接受任何节点决策。
#:
#: `APPROVED` / `APPEAL` / `EXCEPTION` **不在这里,因为它们在整个代码库里从未被
#: 赋值过** —— 声明了、迁移了、`WorkflowFilter.status` 还把它们当筛选值提供
#: (于是那三个选项永远匹配不到任何行),而没有一条路径写入它们。
#: 把它们塞进这个元组会让这段注释开始撒谎:它们不是"终态",它们是**不可达状态**。
#: 要么让它们可达,要么删掉;在那之前,`test_workflow_reachable_states.py` 把
#: "哪些可达"这件事本身钉住,所以增删任何一个都得有人明确决定。
TERMINAL_WORKFLOW_STATUSES = frozenset({
    "COMPLETED",
    "REJECTED",
})


class CaseType(models.TextChoices):
    # Chinese
    ROUTINE = "ROUTINE", "常规审判"
    APPEAL = "APPEAL", "申诉审判"
    CROSS_REALM = "CROSS_REALM", "跨域审判"
    SPECIAL = "SPECIAL", "特案审判"
    # European
    CANONIZATION = "CANONIZATION", "封圣审查"
    PURGATORY_REVIEW = "PURGATORY_REVIEW", "炼狱复核"
    HERESY_TRIAL = "HERESY_TRIAL", "异端审判"
    # Egyptian
    HEART_WEIGHING = "HEART_WEIGHING", "心脏称重"
    DIVINE_TRIAL = "DIVINE_TRIAL", "神判"


class NodeStatus(models.TextChoices):
    PENDING = "PENDING", "待审批"
    APPROVED = "APPROVED", "已批准"
    REJECTED = "REJECTED", "已拒绝"
    SKIPPED = "SKIPPED", "已跳过"
    ESCALATED = "ESCALATED", "已升级"


class NodeType(models.TextChoices):
    TRIAL = "TRIAL", "审判"
    EVALUATION = "EVALUATION", "评估"
    APPEAL = "APPEAL", "申诉"
    FINAL = "FINAL", "终审"
    EXECUTION = "EXECUTION", "执行"


class ApprovalWorkflow(AuditUserFields, models.Model):
    """
    Complete approval workflow instance for a judgment.
    Contains multiple ApprovalNodes representing each stage of approval.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Core relations
    judgment = models.OneToOneField(
        "judgment.Judgment",
        on_delete=models.CASCADE,
        related_name="approval_workflow",
        null=True,
        blank=True,
    )
    soul = models.ForeignKey(
        "souls.Soul",
        on_delete=models.CASCADE,
        related_name="approval_workflows",
    )

    # Workflow definition
    workflow_name = models.CharField(
        max_length=255,
        help_text="e.g., 十殿审判流程, 欧西里斯称重"
    )
    case_type = models.CharField(
        max_length=30,
        choices=CaseType.choices,
        default=CaseType.ROUTINE,
    )
    priority = models.IntegerField(
        default=0,
        help_text="0=normal, 1=urgent, 2=critical"
    )

    # Status
    status = models.CharField(
        max_length=20,
        choices=ApprovalWorkflowStatus.choices,
        default=ApprovalWorkflowStatus.PENDING,
    )

    # Current node tracking
    current_node = models.ForeignKey(
        "ApprovalNode",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="current_for_workflows",
    )

    # Appeal handling
    is_appeal = models.BooleanField(default=False)
    original_workflow = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="appeal_workflows",
    )

    # Cross-civilization coordination
    cross_civilization = models.BooleanField(default=False)
    coordinating_realm = models.ForeignKey(
        "realms.Realm",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )

    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="approval_workflows",
        null=True,
    )

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Approval Workflow"
        verbose_name_plural = "Approval Workflows"
        indexes = [
            models.Index(fields=["tenant", "status"]),
            models.Index(fields=["soul"]),
            models.Index(fields=["status"]),
            models.Index(fields=["case_type"]),
        ]

    def __str__(self):
        return f"{self.workflow_name} - {self.soul.name} ({self.status})"

    def get_next_node(self) -> "ApprovalNode | None":
        """Get the next pending node in the workflow."""
        nodes = self.nodes.filter(status=NodeStatus.PENDING).order_by("node_order").first()
        return nodes

    def get_current_node(self) -> "ApprovalNode | None":
        """Get the currently active node."""
        if self.current_node:
            return self.current_node
        return self.get_next_node()

    def complete_node(self, node_id: uuid.UUID, verdict: str, notes: str = "", user=None) -> bool:
        """Mark a node as completed and advance to next."""
        from django.db import transaction
        from django.utils import timezone

        with transaction.atomic():
            # Locked and re-checked inside the transaction. The view's
            # `node.status != PENDING` guard runs outside any lock, so two
            # judges deciding the same node both passed it and both wrote.
            # Measured on real PostgreSQL 2026-08-29, with a barrier placed
            # between the guard and this call so both threads were provably
            # inside the window:
            #
            #     A: read node status=PENDING gate_passed=True
            #     B: read node status=PENDING gate_passed=True
            #     complete_node returns: {'B': True, 'A': True}
            #     stored: status=APPROVED verdict=PASSED approver=A
            #
            # B's REJECTION was discarded and B was told it had succeeded.
            # Nothing recorded that a rejection had been overwritten.
            #
            # `apps/souls/models.py` already does exactly this -- takes the
            # row lock, re-reads, re-decides -- and was measured correct under
            # the same experiment. This is that pattern, applied here.
            node = (
                ApprovalNode.objects.select_for_update()
                .filter(id=node_id, workflow=self)
                .first()
            )
            if not node:
                return False
            if self.status in TERMINAL_WORKFLOW_STATUSES:
                # The flow is over. Without this, the PENDING nodes left behind
                # by a refusal are still decidable, and deciding the last one
                # would flip a REJECTED workflow to COMPLETED -- erasing the
                # refusal by walking past it.
                return False
            if node.status != NodeStatus.PENDING:
                # Somebody decided it between the view's check and this lock.
                # Returning False rather than overwriting is the whole point:
                # the second caller has to learn its decision was not recorded.
                return False

            # A node that declares which verdicts it accepts has that
            # declaration honoured. `required_verdicts` was written at node
            # creation (`services.py`), exposed in the serializer, and read by
            # **nothing** — the only consumer of a verdict is
            # `WorkflowNodeActionSerializer.verdict`, a *fixed* ChoiceField.
            # Measured 2026-08-29: a node with
            # `required_verdicts=["CONFIRMED"]` accepted `"PASSED"` and
            # answered 200, so a template's per-node constraint had no effect
            # at all while its help_text said 「可接受的裁决列表」.
            #
            # An empty list still means "no constraint" — that is the default
            # and most nodes carry it. This only enforces a list somebody
            # actually wrote.
            if node.required_verdicts and verdict not in node.required_verdicts:
                raise ValueError(
                    f"Node {node.node_name} accepts {node.required_verdicts}; "
                    f"got {verdict}"
                )

            passed = verdict in ["PASSED", "CONFIRMED"]
            node.status = NodeStatus.APPROVED if passed else NodeStatus.REJECTED
            node.verdict = verdict
            node.notes = notes
            node.decided_at = timezone.now()
            if user:
                node.approver = user
            node.save()

            if not passed:
                # A refusal ends the workflow. It used to mark the node
                # REJECTED and then advance **unconditionally**, which is why
                # `ApprovalWorkflowStatus.REJECTED` was declared and assigned
                # nowhere in the codebase. Measured before this change:
                #
                #     complete_node(FAILED) -> True
                #     n1.status = REJECTED
                #     workflow.status = IN_PROGRESS, current_node = N2
                #     ...after refusing all three nodes:
                #     workflow.status = COMPLETED, completed_at set
                #
                # A soul refused in every one of the ten courts finished in the
                # same state as one that passed every one of them. The two were
                # not distinguishable from the workflow row, and `REJECTED`
                # -- the state that exists to say which happened -- was
                # unreachable.
                #
                # The nodes after this one keep `PENDING`: they were never
                # reached, and rewriting them to some "skipped" value would
                # claim a decision nobody made. `current_node = None` plus a
                # terminal status is what stops the flow; the guard below
                # refuses any further decision on it.
                self.current_node = None
                self.status = ApprovalWorkflowStatus.REJECTED
                self.completed_at = timezone.now()
            else:
                # Advance to next node
                next_node = self.get_next_node()
                if next_node:
                    self.current_node = next_node
                    self.status = ApprovalWorkflowStatus.IN_PROGRESS
                else:
                    self.current_node = None
                    self.status = ApprovalWorkflowStatus.COMPLETED
                    self.completed_at = timezone.now()
        self.save()

        return True

    def advance_to_next(self) -> bool:
        """Move `current_node` on to the next pending node, if there is one.

        This used to be a no-op that reported success. `get_next_node()`
        returns the first PENDING node, and `current_node` *is* the first
        PENDING node -- `_create_nodes` sets it to node 1 and `complete_node`
        resets it to `get_next_node()` after deciding one. So this computed
        `next_node == self.current_node`, assigned it to itself, saved, and
        returned True.

        Measured 2026-08-29: `POST /workflows/{id}/advance/` returned 200 with
        `current_node` unmoved, and `POST /escalate/` wrote an audit row whose
        `skipped_node` and `advanced_to` were the same id -- the record
        carrying its own refutation. Nothing in the product could get past a
        stuck node, while `can_approve` pointed every refusal at `escalate` as
        "the sanctioned way past".

        Excluding the current node is the whole fix. The node we are standing
        on is not somewhere to advance *to*.
        """
        candidates = self.nodes.filter(status=NodeStatus.PENDING)
        if self.current_node_id:
            candidates = candidates.exclude(id=self.current_node_id)
        next_node = candidates.order_by("node_order").first()
        if next_node is None:
            return False
        self.current_node = next_node
        self.status = ApprovalWorkflowStatus.IN_PROGRESS
        self.save(update_fields=["current_node", "status"])
        return True

    def escalate_current_node(self, user=None, reason: str = "") -> bool:
        """Mark the node we are stuck on as escalated, then move past it.

        `escalate` used to call `advance_to_next()` and nothing else, so the
        node it claimed to skip stayed PENDING -- which meant
        `get_next_node()` would hand it straight back, and
        `NodeStatus.ESCALATED` was a declared value that no code ever assigned
        (neither did `SKIPPED`). Recording the skip is what makes the audit
        row true and what stops the flow returning to the same node.

        Mirrors `complete_node`'s tail deliberately: a skip is a way of
        finishing with a node, so escalating the last one completes the
        workflow rather than failing with "no next node" and leaving the flow
        stuck on the node the caller was trying to get past.
        """
        from django.db import transaction
        from django.utils import timezone

        with transaction.atomic():
            # "The node we are stuck on" is `get_current_node()`, not
            # `current_node`: that column is only populated by
            # `_create_nodes`/`complete_node`, and a workflow whose nodes were
            # POSTed to /api/v1/nodes/ has it as None while still having a
            # perfectly real first pending node. Requiring the column made
            # escalate answer "no pending node to escalate past" on exactly
            # the hand-built flows it exists for.
            stuck = self.get_current_node()
            node = (
                ApprovalNode.objects.select_for_update().filter(pk=stuck.pk).first()
                if stuck is not None
                else None
            )
            if node is None or node.status != NodeStatus.PENDING:
                return False

            node.status = NodeStatus.ESCALATED
            node.decided_at = timezone.now()
            if user is not None:
                node.approver = user
            if reason:
                node.notes = reason[:500]
            node.save(
                update_fields=["status", "decided_at", "approver", "notes"]
            )

            next_node = (
                self.nodes.filter(status=NodeStatus.PENDING)
                .exclude(pk=node.pk)
                .order_by("node_order")
                .first()
            )
            if next_node:
                self.current_node = next_node
                self.status = ApprovalWorkflowStatus.IN_PROGRESS
            else:
                self.current_node = None
                self.status = ApprovalWorkflowStatus.COMPLETED
                self.completed_at = timezone.now()
            self.save()
        return True


class WorkflowTemplate(AuditUserFields, models.Model):
    """
    Reusable workflow template definition.
    Stores template structure with nodes as JSON for flexibility.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    name = models.CharField(max_length=255, help_text="Template name, e.g., 十殿审判流程")
    description = models.TextField(blank=True, default="")

    # Template categorization
    from apps.souls.models import Civilization
    civilization = models.CharField(
        max_length=30,
        choices=Civilization.choices,
        default=Civilization.CHINESE,
    )
    case_type = models.CharField(
        max_length=30,
        choices=CaseType.choices,
        default=CaseType.ROUTINE,
    )

    # The urgency this *procedure* is written for, not the urgency of any one
    # case. Same three values as ApprovalWorkflow.priority above, deliberately:
    # this column is a default for that one, so a second scale would mean
    # translating between them at every read.
    #
    # WHICH ONE WINS IS DECIDED IN ONE PLACE — `WorkflowService._resolve_priority`
    # — and the order is: an explicitly passed instance-level priority, then this
    # template value, then the floor (0 for a judgment, 1 for an appeal). The
    # column exists because 「this procedure is for urgent cases」 was previously
    # sayable only by picking a CaseType member for it, which is the mistake
    # `a77a41e` undid: case_type answers "which kind of case", priority answers
    # "how urgent", and EMERGENCY was the second answer written into the first
    # column. See frontend/src/config/workflow-templates.ts::CHINESE_EMERGENCY.
    priority = models.IntegerField(
        default=0,
        help_text="Default priority for workflows built from this template: "
                  "0=normal, 1=urgent, 2=critical",
    )

    is_active = models.BooleanField(default=True)

    # Template nodes stored as JSON
    # Each node: { id, node_name, node_type, court_code, approver_role, approver_type, node_order }
    nodes_json = models.JSONField(
        default=list,
        help_text="JSON array of template nodes"
    )

    # Source tracking
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="workflow_templates",
        null=True,
    )

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    class Meta:
        ordering = ["civilization", "case_type", "name"]
        verbose_name = "Workflow Template"
        verbose_name_plural = "Workflow Templates"

    def __str__(self):
        return f"{self.name} ({self.civilization} - {self.case_type})"


class ApprovalNode(AuditUserFields, models.Model):
    """
    Individual approval node within a workflow.
    Represents one stage/step in the approval process.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        ApprovalWorkflow,
        on_delete=models.CASCADE,
        related_name="nodes",
    )

    # Node definition
    node_name = models.CharField(max_length=255)
    node_order = models.IntegerField()
    node_type = models.CharField(
        max_length=20,
        choices=NodeType.choices,
        default=NodeType.TRIAL,
    )

    # Approver configuration
    approver_type = models.CharField(
        max_length=20,
        choices=[
            ("ACTOR", "角色"),
            ("ROLE", "职能角色"),
            ("SYSTEM", "系统自动"),
        ],
        default="ACTOR",
    )
    approver_actor = models.ForeignKey(
        "actors.Actor",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    approver_role = models.CharField(
        max_length=20,
        blank=True,
        help_text="JUDGE, OVERSEER, etc."
    )

    # Court/Realm configuration
    court_code = models.CharField(
        max_length=50,
        blank=True,
        help_text="第一殿, Hall of Two Truths, etc."
    )
    realm = models.ForeignKey(
        "realms.Realm",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )

    # Result configuration
    required_verdicts = models.JSONField(
        default=list,
        help_text="可接受的裁决列表，如 ['PASSED', 'FAILED', 'RETRY']"
    )

    # Node status
    status = models.CharField(
        max_length=20,
        choices=NodeStatus.choices,
        default=NodeStatus.PENDING,
    )
    verdict = models.CharField(max_length=20, blank=True)
    evidence_json = models.JSONField(default=dict)
    notes = models.TextField(blank=True)

    approver = models.ForeignKey(
        "authentication.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approved_nodes",
    )
    decided_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["workflow", "node_order"]
        verbose_name = "Approval Node"
        verbose_name_plural = "Approval Nodes"
        indexes = [
            models.Index(fields=["workflow", "node_order"]),
            models.Index(fields=["status"]),
        ]

    def __str__(self):
        return f"{self.workflow.soul.name} - {self.node_name} ({self.status})"

    @property
    def designates_approver(self) -> bool:
        """True when this node names *who* must decide it.

        A node can carry an ``approver_type`` without naming anyone: ``ACTOR``
        is the field default, so a node POSTed to ``/api/v1/nodes/`` without an
        ``approver_actor`` claims actor-approval and designates nobody. ``ROLE``
        with an empty ``approver_role`` is the same shape. ``SYSTEM`` designates
        nobody by definition.

        This no longer decides *whether* the identity check runs —
        ``can_approve`` is now ``approve_node``'s only gate, and it refuses an
        undesignated node like it refuses everything else it cannot verify.
        What this property still decides is which of two refusals the caller is
        told about: "you are not the approver" and "this node names no approver,
        so nobody is" are different problems with different fixes, and
        collapsing them into one message leaves an operator re-deriving which
        one they hit.
        """
        if self.approver_type == "ACTOR":
            return self.approver_actor_id is not None
        if self.approver_type == "ROLE":
            return bool(self.approver_role)
        return False

    def can_approve(self, user) -> bool:
        """Whether ``user`` is the approver this node designates.

        This used to answer ``True`` for *any* user as soon as the node named an
        ``approver_actor``::

            if self.approver_type == "ACTOR" and self.approver_actor:
                return True  # TODO: check user.actor == approver_actor

        — so a node whose approver was 阎罗王 could be decided by anyone who
        reached it, and ``complete_node`` then recorded the decision under that
        caller's name. The TODO had outlived several audits as a note rather
        than a finding. It was also never *called*: ``approve_node`` went
        straight to ``complete_node``, so fixing the comparison alone would have
        left a correct guard that nothing consults. Both halves are closed;
        ``apps/workflow/tests.py`` asserts the refusal through the API, not just
        against this method.

        Fail-closed on every axis. A user with no linked ``Actor`` is refused
        rather than falling back to role or to "cannot tell, allow" — 18 of the
        100 users in the live data have ``actor=NULL``, so an
        allow-when-unknown branch would have been the common case, not the edge
        case. ADMIN gets no bypass either: tenant-exemption
        (``apps/core/tenant.py``) is about which rows a user may *see*, and
        approving in another actor's name is an authorization decision, not a
        visibility one. An admin who must move a stuck flow has
        ``ApprovalWorkflowViewSet.escalate``, which demands a written reason and
        writes an ``AuditLog`` — the override stays available, but visible.

        **A node that designates nobody answers False, and that is now a
        refusal rather than a formality.** Until
        ``0011_backfill_ten_court_approvers`` this method's verdict on such a
        node was never acted on: ``approve_node`` consulted it only for nodes
        that named someone, and every node in the live database was ``SYSTEM``.
        Making it the sole gate means an undesignated node cannot be approved by
        anyone at all. That is deliberate and it is the only answer that is not
        a guess: the question this method is asked is "is this user the approver
        this node names", and for a node that names no one the honest answer is
        not "yes, anyone" — it is "there is nobody to be". The alternatives were
        both worse. Falling back to the ``workflow.approve`` codename is what
        the code did before and is precisely the hole being closed: every JUDGE
        and ADMIN holds it. Falling back to role would let the field default
        (``approver_type="ACTOR"``, ``approver_actor=NULL``) silently mean
        "anyone with the right role", which nobody wrote down anywhere.

        Such a node is not stuck, it is *routed*: ``escalate`` moves it past,
        with a written reason and an ``AuditLog`` row naming who overrode what.
        A flow whose steps do not say who decides them should cost a paper
        trail to run, not run silently. ``WorkflowService`` no longer creates
        undesignated nodes where the template names an approver, so this is the
        rare case rather than the normal one — 0 of the 30 nodes in the live
        data are left undesignated after the backfill.
        """
        if self.status != NodeStatus.PENDING:
            return False

        # AnonymousUser has no `actor_id`/`role`; asking with getattr keeps this
        # method total rather than raising AttributeError at the call site.
        if not getattr(user, "is_authenticated", False):
            return False

        if self.approver_type == "ACTOR":
            if self.approver_actor_id is None:
                return False  # designates nobody — nobody satisfies it
            user_actor_id = getattr(user, "actor_id", None)
            if user_actor_id is None:
                return False  # no identity to compare
            return user_actor_id == self.approver_actor_id

        if self.approver_type == "ROLE":
            if not self.approver_role:
                return False
            return getattr(user, "role", None) == self.approver_role

        # SYSTEM, and any approver_type added later without a branch here.
        return False
