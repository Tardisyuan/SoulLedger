"""
Soul record model — merit/demerit/judgment evidence attached to a soul.
"""
import uuid
from django.db import models
from apps.souls.models import Soul, Civilization


class RecordType(models.TextChoices):
    MERIT = "MERIT", "Merit"
    DEMERIT = "DEMERIT", "Demerit"
    JUDGMENT = "JUDGMENT", "Judgment Evidence"
    DISPOSITION = "DISPOSITION", "Disposition Record"


class SoulRecord(models.Model):
    """
    Individual event/record attached to a soul.
    evidence_json stores flexible structured evidence.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    soul = models.ForeignKey(
        Soul,
        on_delete=models.CASCADE,
        related_name="records",
    )
    record_type = models.CharField(max_length=20, choices=RecordType.choices)
    civilization = models.CharField(
        max_length=20,
        choices=Civilization.choices,
        default=Civilization.CHINESE,
    )
    description = models.TextField()
    weight = models.IntegerField(
        default=1,
        help_text="Significance weight (1-100). Affects karma calculation.",
    )
    evidence_json = models.JSONField(default=dict, blank=True)
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-recorded_at"]
        verbose_name = "Soul Record"
        verbose_name_plural = "Soul Records"

    def __str__(self):
        return f"{self.record_type}: {self.description[:50]}"

    def save(self, *args, **kwargs):
        is_new = self._state.adding
        super().save(*args, **kwargs)
        if is_new:
            self._update_soul_karma()

    def _update_soul_karma(self):
        from apps.karma.services import KarmaService
        KarmaService.recalculate_soul_karma(self.soul)
