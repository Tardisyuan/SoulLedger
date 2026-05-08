"""
Disposition model — where a soul goes after judgment.
"""
import uuid
from django.db import models
from apps.souls.models import Soul
from apps.judgment.models import Judgment


class MemoryResetMechanism(models.TextChoices):
    MENGPO = "MENGPO", "孟婆汤 (Mengpo Soup)"
    LETHE = "LETIES", "忘川 (Lethe)"
    SPELL = "SPELL", "Spell Recitation"
    NONE = "NONE", "No Reset"


class Disposition(models.Model):
    """
    The destination and sentence given to a soul after judgment.
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

    def __str__(self):
        realm = self.destination_realm.realm_code if self.destination_realm else "UNKNOWN"
        return f"{self.soul.name} → {realm}"
