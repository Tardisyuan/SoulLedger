"""
Dispatch models — cross-tenant soul dispatching and joint judgment.
"""
import uuid

from django.db import models
from django.db.models import Q, UniqueConstraint

from apps.core.models import AuditUserFields
from apps.tenants.managers import TenantManager


class DispatchStatus(models.TextChoices):
    PROPOSED = "PROPOSED", "待审批"
    APPROVED = "APPROVED", "已批准"
    REJECTED = "REJECTED", "已拒绝"
    EXECUTED = "EXECUTED", "已执行"
    # 暂居结束、灵魂已回到原属租户(2026-09-17:调拨是暂居,不是迁籍)。
    # EXECUTED 在这之前表示「暂居中」。
    RETURNED = "RETURNED", "已回归"
    CANCELLED = "CANCELLED", "已取消"


class JudgmentStatus(models.TextChoices):
    PROPOSED = "PROPOSED", "提议中"
    ACTIVE = "ACTIVE", "进行中"
    CONCLUDED = "CONCLUDED", "已结束"
    CANCELLED = "CANCELLED", "已取消"


class ParticipantRole(models.TextChoices):
    ADVISOR = "ADVISOR", "顾问"
    CO_JUDGE = "CO_JUDGE", "联合审判官"
    CHAIRMAN = "CHAIRMAN", "主持"


class DispatchRecord(AuditUserFields, models.Model):
    """
    Cross-tenant soul dispatch record.
    Tracks the proposal, approval, and execution of soul transfers between tenants.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    source_tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="dispatch_records_sent",
    )
    target_tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="dispatch_records_received",
    )
    soul = models.ForeignKey(
        "souls.Soul",
        on_delete=models.CASCADE,
        related_name="dispatch_records",
    )
    dispatched_by = models.ForeignKey(
        "authentication.User",
        on_delete=models.SET_NULL,
        null=True,
        related_name="dispatch_records",
    )
    status = models.CharField(
        max_length=20,
        choices=DispatchStatus.choices,
        default=DispatchStatus.PROPOSED,
    )
    reason = models.TextField()
    proposed_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    executed_at = models.DateTimeField(null=True, blank=True)
    returned_at = models.DateTimeField(null=True, blank=True)

    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="dispatch_records",
        null=True,
    )

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    class Meta:
        ordering = ["-proposed_at"]
        verbose_name = "Dispatch Record"
        verbose_name_plural = "Dispatch Records"
        constraints = [
            UniqueConstraint(
                condition=Q(is_deleted=False) & Q(status__in=[DispatchStatus.PROPOSED, DispatchStatus.APPROVED]),
                fields=["soul"],
                name="unique_active_dispatch"
            ),
        ]
        indexes = [
            models.Index(fields=["source_tenant", "status"]),
            models.Index(fields=["target_tenant", "status"]),
            models.Index(fields=["soul"]),
            models.Index(fields=["status"]),
        ]

    def __str__(self):
        return f"Dispatch {self.soul.name} {self.source_tenant.code}->{self.target_tenant.code} ({self.status})"

    # ── State Machine ──────────────────────────────────────────────

    VALID_TRANSITIONS = {
        DispatchStatus.PROPOSED: [DispatchStatus.APPROVED, DispatchStatus.REJECTED, DispatchStatus.CANCELLED],
        DispatchStatus.APPROVED: [DispatchStatus.EXECUTED, DispatchStatus.CANCELLED],
        DispatchStatus.REJECTED: [],
        DispatchStatus.EXECUTED: [DispatchStatus.RETURNED],
        DispatchStatus.RETURNED: [],
        DispatchStatus.CANCELLED: [],
    }

    def can_transition_to(self, new_status: str) -> bool:
        return new_status in self.VALID_TRANSITIONS.get(self.status, [])

    def transition_to(self, new_status: str, **kwargs) -> bool:
        from django.db import transaction as db_transaction
        with db_transaction.atomic():
            locked = DispatchRecord._base_manager.select_for_update(of=("self",)).get(pk=self.pk)
            if not locked.can_transition_to(new_status):
                return False
            locked.status = new_status
            for field, value in kwargs.items():
                if hasattr(locked, field):
                    setattr(locked, field, value)
            locked.save()
        self.status = locked.status
        for field in kwargs:
            if hasattr(self, field):
                setattr(self, field, getattr(locked, field))
        return True


class CrossTenantJudgment(AuditUserFields, models.Model):
    """
    Joint judgment initiated by one tenant, with participants from other tenants.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=200)
    description = models.TextField()
    initiating_tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="initiated_judgments",
    )
    status = models.CharField(
        max_length=20,
        choices=JudgmentStatus.choices,
        default=JudgmentStatus.PROPOSED,
    )
    concluded_at = models.DateTimeField(null=True, blank=True)
    conclusion_type = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        help_text="PASS or FAIL"
    )
    # 这场联审为哪份原属审判定受刑计划(docs/ARCHITECTURE-sentence-plan.md §2.1,Q1)。
    # 同租户(发起方就是原属),所以可以是外键。空 = 存量的那种不挂灵魂的会议,行为不变。
    judgment = models.OneToOneField(
        "judgment.Judgment",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cross_judgment",
    )

    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="cross_tenant_judgments",
        null=True,
    )

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    class Meta:
        ordering = ["-create_time"]
        verbose_name = "Cross-Tenant Judgment"
        verbose_name_plural = "Cross-Tenant Judgments"
        indexes = [
            models.Index(fields=["initiating_tenant", "status"]),
            models.Index(fields=["status"]),
        ]

    def __str__(self):
        return f"{self.title} ({self.status})"

    # ── State Machine ──────────────────────────────────────────────

    VALID_TRANSITIONS = {
        JudgmentStatus.PROPOSED: [JudgmentStatus.ACTIVE, JudgmentStatus.CANCELLED],
        JudgmentStatus.ACTIVE: [JudgmentStatus.CONCLUDED, JudgmentStatus.CANCELLED],
        JudgmentStatus.CONCLUDED: [],
        JudgmentStatus.CANCELLED: [],
    }

    def can_transition_to(self, new_status: str) -> bool:
        return new_status in self.VALID_TRANSITIONS.get(self.status, [])

    def transition_to(self, new_status: str, **kwargs) -> bool:
        from django.db import transaction as db_transaction
        with db_transaction.atomic():
            locked = CrossTenantJudgment._base_manager.select_for_update().get(pk=self.pk)
            if not locked.can_transition_to(new_status):
                return False
            locked.status = new_status
            for field, value in kwargs.items():
                if hasattr(locked, field):
                    setattr(locked, field, value)
            locked.save()
        self.status = locked.status
        for field in kwargs:
            if hasattr(self, field):
                setattr(self, field, getattr(locked, field))
        return True


class CrossTenantJudgmentParticipant(AuditUserFields, models.Model):
    """
    Participant in a cross-tenant judgment.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    judgment = models.ForeignKey(
        CrossTenantJudgment,
        on_delete=models.CASCADE,
        related_name="participants",
    )
    participant_tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="judgment_participations",
    )
    participant_actor = models.ForeignKey(
        "actors.Actor",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="judgment_participations",
    )
    role = models.CharField(
        max_length=20,
        choices=ParticipantRole.choices,
        default=ParticipantRole.ADVISOR,
    )
    joined_at = models.DateTimeField(auto_now_add=True)

    # ── 这一方在受刑计划里的那一站(docs/ARCHITECTURE-sentence-plan.md §2.2,Q1)──
    #
    # 非 ADVISOR 的参与方各定**自己文明**那一节点的处置内容;发起方 seat 时给 `node_order`
    # (原属恒为 1,所以从 2 起)。`sentence_realm_code` 是字符串不是外键(分库约束);
    # `sentence_is_eternal` / `sentence_memory_reset` 由服务端抄自 realm,与
    # `DispositionService.create_from_judgment` 抄法相同。`sentence_submitted_at` 为空 =
    # 还没填,挂了审判的联审 `conclude` 会拒绝。
    node_order = models.PositiveIntegerField(null=True, blank=True)
    sentence_realm_code = models.CharField(max_length=50, blank=True, default="")
    sentence_years = models.IntegerField(null=True, blank=True)
    sentence_is_eternal = models.BooleanField(default=False)
    sentence_memory_reset = models.CharField(max_length=20, blank=True, default="")
    sentence_notes = models.TextField(blank=True, default="")
    sentence_submitted_at = models.DateTimeField(null=True, blank=True)
    sentence_submitted_by = models.ForeignKey(
        "authentication.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sentences_submitted",
    )

    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="judgment_participants",
        null=True,
    )

    class Meta:
        ordering = ["joined_at"]
        verbose_name = "Judgment Participant"
        verbose_name_plural = "Judgment Participants"
        indexes = [
            models.Index(fields=["judgment", "participant_tenant"]),
        ]
        constraints = [
            # 两个参与方不能排同一位。
            UniqueConstraint(
                fields=["judgment", "node_order"],
                condition=Q(is_deleted=False) & Q(node_order__isnull=False),
                name="unique_cross_judgment_node_order",
            ),
            models.CheckConstraint(
                condition=Q(sentence_years__isnull=True) | Q(sentence_years__gte=0),
                name="cross_participant_sentence_years_not_negative",
            ),
        ]

    def __str__(self):
        return f"{self.participant_tenant.code} - {self.role} for {self.judgment.title}"
