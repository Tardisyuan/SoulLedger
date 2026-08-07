"""
Judgment model — records of soul judgment proceedings.
"""
import uuid

from django.db import models

from apps.core.archive import ArchivableMixin
from apps.core.models import AuditUserFields
from apps.souls.models import Civilization, Soul
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


class Judgment(ArchivableMixin, AuditUserFields, models.Model):
    """
    A single judgment proceeding for a soul.

    Deletion (Stage 4 §4.7): a pending judgment (verdict is null) is an
    ordinary soft delete. Once a verdict has been recorded, the judgment
    is part of the soul's judicial history and is archivable instead — see
    can_delete/delete_or_archive below and ArchivableMixin.archive().
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

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def __str__(self):
        v = self.verdict or "PENDING"
        return f"Judgment of {self.soul.name}: {v}"

    def conclude(self, verdict: str, notes: str = "", create_workflow: bool = False) -> bool:
        from apps.judgment.services import JudgmentConclusionService
        return JudgmentConclusionService.conclude_judgment(self, verdict, notes, create_workflow)

    @property
    def can_delete(self) -> bool:
        """False once a verdict has been recorded — see class docstring."""
        return self.verdict is None

    def delete_or_raise(self, user=None, reason=""):
        """Soft-delete this judgment, or raise DeletionNotAllowedError
        (archivable=True) once it carries a verdict."""
        from apps.core.archive import DeletionNotAllowedError

        if not self.can_delete:
            raise DeletionNotAllowedError(
                "This judgment has a recorded verdict and cannot be deleted. "
                "Archive it instead.",
                archivable=True,
            )
        self.soft_delete(user=user, reason=reason)
