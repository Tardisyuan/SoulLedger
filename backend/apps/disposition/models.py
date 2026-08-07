"""
Disposition model — where a soul goes after judgment.
"""
import uuid

from django.db import models

from apps.core.archive import ArchivableMixin
from apps.core.models import AuditUserFields
from apps.judgment.models import Judgment
from apps.souls.models import Soul
from apps.tenants.managers import TenantManager


class MemoryResetMechanism(models.TextChoices):
    MENGPO = "MENGPO", "孟婆汤 (Mengpo Soup)"
    LETHE = "LETIES", "忘川 (Lethe)"
    SPELL = "SPELL", "Spell Recitation"
    NONE = "NONE", "No Reset"


class Disposition(ArchivableMixin, AuditUserFields, models.Model):
    """
    The destination and sentence given to a soul after judgment.

    Deletion (Stage 4 §4.7): a Disposition only ever exists once its
    Judgment has concluded with a verdict (see JudgmentConclusionService),
    so in practice every Disposition is archivable-only, never deletable —
    see can_delete/delete_or_raise below.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    soul = models.ForeignKey(
        Soul,
        on_delete=models.CASCADE,
        related_name="dispositions",
    )
    judgment = models.OneToOneField(
        Judgment,
        on_delete=models.SET_NULL,
        null=True,
        related_name="disposition",
    )
    destination_realm = models.ForeignKey(
        "realms.Realm",
        on_delete=models.SET_NULL,
        null=True,
        related_name="dispositions",
    )
    memory_reset = models.CharField(
        max_length=20,
        choices=MemoryResetMechanism.choices,
        default=MemoryResetMechanism.NONE,
    )
    is_eternal = models.BooleanField(default=False)
    sentence_years = models.IntegerField(
        null=True,
        blank=True,
        help_text="Sentence duration in years (null = eternal)",
    )
    is_executed = models.BooleanField(default=False)
    executed_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='dispositions',
        null=True,
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Disposition"
        verbose_name_plural = "Dispositions"
        indexes = [
            models.Index(fields=["tenant", "created_at"]),
            models.Index(fields=["soul"]),
            models.Index(fields=["is_executed"]),
        ]

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def __str__(self):
        realm = self.destination_realm.realm_code if self.destination_realm else "UNKNOWN"
        return f"{self.soul.name} → {realm}"

    @property
    def can_delete(self) -> bool:
        """False whenever this disposition is tied to a concluded verdict
        (the ordinary case — see class docstring). A disposition whose
        judgment link was cleared (judgment FK is on_delete=SET_NULL) has
        no verdict left to check and falls back to deletable."""
        return self.judgment is None or self.judgment.verdict is None

    def delete_or_raise(self, user=None, reason=""):
        """Soft-delete this disposition, or raise DeletionNotAllowedError
        (archivable=True) when it's tied to a concluded verdict."""
        from apps.core.archive import DeletionNotAllowedError

        if not self.can_delete:
            raise DeletionNotAllowedError(
                "This disposition is tied to a concluded judgment and cannot "
                "be deleted. Archive it instead.",
                archivable=True,
            )
        self.soft_delete(user=user, reason=reason)
