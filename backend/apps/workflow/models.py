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
            node = self.nodes.filter(id=node_id).first()
            if not node:
                return False

            node.status = NodeStatus.APPROVED if verdict in ["PASSED", "CONFIRMED"] else NodeStatus.REJECTED
            node.verdict = verdict
            node.notes = notes
            node.decided_at = timezone.now()
            if user:
                node.approver = user
            node.save()

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
        """Manually advance to the next pending node."""
        next_node = self.get_next_node()
        if next_node:
            self.current_node = next_node
            self.save()
            return True
        return False


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

        ``approve_node`` uses this to decide whether the identity check applies
        at all: where an approver is named, ``can_approve`` is authoritative;
        where none is, the node stays governed by the ``workflow.approve``
        codename permission as it always was. Splitting it this way is what lets
        the guard be enforced without freezing the in-flight workflows, whose
        nodes ``WorkflowService`` creates as ``SYSTEM``.
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
