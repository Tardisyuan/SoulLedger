"""
Judgment model — records of soul judgment proceedings.
"""
import uuid
from django.db import models
from apps.core.models import AuditUserFields
from apps.souls.models import Soul, Civilization, SoulState
from apps.tenants.managers import TenantManager


class Verdict(models.TextChoices):
    PASSED = "PASSED", "Passed / Saved"
    FAILED = "FAILED", "Failed / Condemned"
    PURGATORY = "PURGATORY", "Purgatory / Intermediate"
    RETRY = "RETRY", "Retry / Appeal"


class JudgmentMethod(models.TextChoices):
    STANDARD = "STANDARD", "Standard Trial (Chinese/European)"
    HEART_WEIGHING = "HEART_WEIGHING", "Heart Weighing (Egyptian)"
    DIABOLICAL_TRIAL = "DIABOLICAL_TRIAL", "Diabolical Trial (European Hell)"


class Judgment(AuditUserFields, models.Model):
    """
    A single judgment proceeding for a soul.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    soul = models.ForeignKey(
        Soul,
        on_delete=models.CASCADE,
        related_name="judgments",
    )
    civilization = models.CharField(max_length=20, choices=Civilization.choices)
    judge = models.ForeignKey(
        "actors.Actor",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="judgments_conducted",
    )
    court = models.CharField(max_length=255, blank=True, help_text="Court name, e.g. 第一殿")
    evidence_json = models.JSONField(default=dict)
    confession = models.TextField(blank=True)
    judgment_method = models.CharField(
        max_length=30,
        choices=JudgmentMethod.choices,
        default=JudgmentMethod.STANDARD,
        help_text="Method of judgment (affects disposition routing)",
    )
    verdict = models.CharField(
        max_length=20,
        choices=Verdict.choices,
        null=True,
        blank=True,
    )
    notes = models.TextField(blank=True)
    is_final = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    concluded_at = models.DateTimeField(null=True, blank=True)

    tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='judgments',
        null=True,
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Judgment"
        verbose_name_plural = "Judgments"
        indexes = [
            models.Index(fields=["soul", "verdict"]),
            models.Index(fields=["tenant", "created_at"]),
            models.Index(fields=["verdict"]),
            models.Index(fields=["is_final"]),
        ]

    objects = TenantManager()

    def __str__(self):
        v = self.verdict or "PENDING"
        return f"Judgment of {self.soul.name}: {v}"

    def conclude(self, verdict: str, notes: str = "", create_workflow: bool = False) -> bool:
        from apps.judgment.services import JudgmentConclusionService
        return JudgmentConclusionService.conclude_judgment(self, verdict, notes, create_workflow)
