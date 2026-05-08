"""
Realm reference data — cross-civilization afterlife realms.
"""
import uuid
from django.db import models
from apps.souls.models import Civilization


class RealmType(models.TextChoices):
    HELL = "HELL", "Hell / Punishment"
    PURGATORY = "PURGATORY", "Purgatory / Intermediate"
    BLISS = "BLISS", "Heaven / Bliss"
    NEUTRAL = "NEUTRAL", "Neutral / Between"


class Realm(models.Model):
    """
    A destination realm within an afterlife system.
    Examples: 奈何狱 (Chinese), Heaven (EU), Aaru (EG)
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    realm_code = models.CharField(max_length=50, unique=True)
    civilization = models.CharField(max_length=20, choices=Civilization.choices)
    name_local = models.CharField(max_length=255, help_text="Native name, e.g. 奈何狱")
    name_en = models.CharField(max_length=255, help_text="English name")
    realm_type = models.CharField(max_length=20, choices=RealmType.choices)
    tier = models.IntegerField(
        default=1,
        help_text="Severity or bliss tier (1=most severe, higher=less severe for HELL; reversed for BLISS)",
    )
    parent_realm = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="sub_realms",
    )
    description = models.TextField(blank=True)
    memory_reset_mechanism = models.CharField(max_length=100, blank=True)
    is_eternal = models.BooleanField(default=False)
    cycle_limit = models.IntegerField(
        null=True,
        blank=True,
        help_text="Max reincarnation cycles before forced progression",
    )

    class Meta:
        ordering = ["civilization", "realm_type", "tier"]
        verbose_name = "Realm"
        verbose_name_plural = "Realms"

    def __str__(self):
        return f"{self.realm_code} ({self.name_en})"
