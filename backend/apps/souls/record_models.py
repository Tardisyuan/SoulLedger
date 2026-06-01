"""
Soul record model — merit/demerit/judgment evidence attached to a soul.
"""
import uuid
from django.db import models
from apps.souls.models import Soul, Civilization
from apps.core.models import AuditUserFields
from apps.tenants.managers import TenantManager


class RecordType(models.TextChoices):
    MERIT = "MERIT", "Merit"
    DEMERIT = "DEMERIT", "Demerit"
    JUDGMENT = "JUDGMENT", "Judgment Evidence"
    DISPOSITION = "DISPOSITION", "Disposition Record"


class RecordCategory(models.TextChoices):
    # Merit categories
    CHARITY = "CHARITY", "Charity / Generosity"
    COMPASSION = "COMPASSION", "Compassion / Kindness"
    HONESTY = "HONESTY", "Honesty / Integrity"
    COURAGE = "COURAGE", "Courage / Bravery"
    WISDOM = "WISDOM", "Wisdom / Knowledge"
    PIETY = "PIETY", "Piety / Devotion"
    # Demerit categories
    CRUELTY = "CRUELTY", "Cruelty / Violence"
    DECEPTION = "DECEPTION", "Deception / Lying"
    COWARDICE = "COWARDICE", "Cowardice"
    GREED = "GREED", "Greed / Avarice"
    BLASPHEMY = "BLASPHEMY", "Blasphemy / Impiety"
    MURDER = "MURDER", "Murder / Killing"
    OTHER = "OTHER", "Other"


class SoulRecord(AuditUserFields, models.Model):
    """
    Individual event/record attached to a soul.
    evidence_json stores flexible structured evidence.
    Inherits AuditUserFields for audit trail and soft delete.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    soul = models.ForeignKey(
        Soul,
        on_delete=models.CASCADE,
        related_name="records",
    )
    record_type = models.CharField(max_length=20, choices=RecordType.choices)
    category = models.CharField(
        max_length=20,
        choices=RecordCategory.choices,
        default=RecordCategory.OTHER,
        help_text="Standardized category for this record",
    )
    civilization = models.CharField(
        max_length=20,
        choices=Civilization.choices,
        default=Civilization.CHINESE,
        help_text="Derived from soul's tenant (kept for query convenience)",
    )
    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="soul_records",
        null=True,
        blank=True,
    )
    objects = TenantManager()
    description = models.TextField()
    weight = models.IntegerField(
        default=1,
        help_text="Significance weight (1-100). Affects karma calculation.",
    )
    event_date = models.DateField(
        null=True,
        blank=True,
        help_text="Date the event occurred (for time-decay calculation)",
    )
    is_milestone = models.BooleanField(
        default=False,
        help_text="If true, weight is doubled (major life event)",
    )
    evidence_json = models.JSONField(default=dict, blank=True)
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-recorded_at"]
        verbose_name = "Soul Record"
        verbose_name_plural = "Soul Records"
        indexes = [
            models.Index(fields=["soul", "record_type"], name="idx_soulrecord_soul_type"),
            models.Index(fields=["soul", "recorded_at"], name="idx_soulrecord_soul_date"),
            models.Index(fields=["tenant", "recorded_at"], name="idx_soulrecord_tenant_date"),
        ]

    def __str__(self):
        return f"{self.record_type}: {self.description[:50]}"

    def save(self, *args, **kwargs):
        is_new = self._state.adding
        # Auto-populate tenant from soul if not set
        if self.tenant is None and self.soul_id is not None:
            self.tenant = self.soul.tenant
        super().save(*args, **kwargs)
        if is_new:
            self._update_soul_karma()

    def _update_soul_karma(self):
        """Recalculate karma. Uses cache debounce only for bulk operations."""
        from apps.karma.services import KarmaService
        KarmaService.recalculate_soul_karma(self.soul)
