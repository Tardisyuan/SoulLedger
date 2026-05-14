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

    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="dispatch_records",
        null=True,
    )

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

    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="cross_tenant_judgments",
        null=True,
    )

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

    def __str__(self):
        return f"{self.participant_tenant.code} - {self.role} for {self.judgment.title}"