"""
Dispatch models — cross-tenant soul dispatching and joint judgment.
"""
import uuid

from django.db import models
from django.db.models import Q, UniqueConstraint

from apps.core.models import AuditUserFields
from apps.tenants.managers import TenantManager


class DispatchStatus(models.TextChoices):
    # 草稿(2026-09-25):发起人存下、还没提交审批的调拨。只有发起人(与 ADMIN)看得见,
    # 不进审批收件箱、不占 `unique_active_dispatch`、不通知任何人;缺什么都行,提交时才校验。
    # 是一个状态而不是一个布尔列:见 `VALID_TRANSITIONS` 上方的说明。
    DRAFT = "DRAFT", "草稿"
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
        null=True,
        blank=True,
    )
    # `target_tenant` / `soul` 可空只为草稿:草稿可以不完整。提交(`DispatchService.submit`)
    # 与直接发起(`propose`)都要求两者齐全,所以 PROPOSED 及之后的行上它们恒非空。
    soul = models.ForeignKey(
        "souls.Soul",
        on_delete=models.CASCADE,
        related_name="dispatch_records",
        null=True,
        blank=True,
    )
    # 目标界域:灵魂到目标文明后落在哪一处。必须是**目标租户**的、目标文明的、未软删的
    # 界域(`DispatchService.check_target_realm`);执行时写进灵魂行程(`SoulPathService.enter`)。
    # 空 = 没指定,执行时只记「离开」,与此前一样。SET_NULL 与 `SoulPathEntry.realm` 同一取法。
    target_realm = models.ForeignKey(
        "realms.Realm",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
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
    reason = models.TextField(blank=True, default="")
    # 草稿上是建草稿的时刻;提交时改写为提交的时刻(审批收件箱按它先进先出)。
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
        soul = self.soul.name if self.soul_id else "?"
        target = self.target_tenant.code if self.target_tenant_id else "?"
        return f"Dispatch {soul} {self.source_tenant.code}->{target} ({self.status})"

    # ── State Machine ──────────────────────────────────────────────
    #
    # DRAFT 是状态机的第一个状态,不是另一根布尔列。每一处读调拨的代码都已经按 `status`
    # 筛(审批收件箱 `status=PROPOSED`、`unique_active_dispatch` 的 PROPOSED/APPROVED、
    # 受刑计划的 EXECUTED、回归的 EXECUTED……),所以草稿**不改任何一处**就被它们排除;
    # 一根 `is_draft` 列则要每一处都补 `is_draft=False`,漏一处就是草稿进了收件箱,
    # 而且会造出「草稿且 APPROVED」这种无意义的组合。
    # 放弃草稿是软删(进回收站),不是 CANCELLED:CANCELLED 是审批流里的一个结论。

    VALID_TRANSITIONS = {
        DispatchStatus.DRAFT: [DispatchStatus.PROPOSED],
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
