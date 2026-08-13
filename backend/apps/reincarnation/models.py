"""
Reincarnation model — tracks rebirth cycles.
"""
import uuid

from django.db import models

from apps.core.models import AuditUserFields
from apps.souls.models import Soul
from apps.tenants.managers import TenantManager


class RebirthForm(models.TextChoices):
    """The six paths of rebirth (六道), in the order docs/07_六道轮回详解.md
    lists them: the three good paths (三善道) first, then the three evil
    paths (三恶道), best to worst.

    Three of these already existed under names that predate the setting
    document, and their stored values are load-bearing — every row written
    so far holds one of them — so the keys stay put and only the labels are
    aligned with the doctrine they were always meant to name:

        DIVINE -> 天道   (deva realm; the top of the three good paths)
        HUMAN  -> 人道   (human realm)
        ANIMAL -> 畜生道 (beast realm; the first of the three evil paths)

    OTHER is not a seventh path. It is kept only because rows may already
    carry it and dropping a choice would make those rows unreadable through
    the admin and the API filter; it means "recorded before the six paths
    existed, or outside this cosmology". Nothing should write it any more.
    """

    # 三善道 — the three good paths
    DIVINE = "DIVINE", "Deva (Heaven Path)"
    HUMAN = "HUMAN", "Human (Human Path)"
    ASURA = "ASURA", "Asura (Demigod Path)"
    # 三恶道 — the three evil paths
    ANIMAL = "ANIMAL", "Animal (Beast Path)"
    HUNGRY_GHOST = "HUNGRY_GHOST", "Hungry Ghost"
    HELL_BEING = "HELL_BEING", "Hell Being"
    # Legacy escape hatch, deliberately outside the six.
    OTHER = "OTHER", "Other (Unclassified)"


#: 三善道 / 三恶道, per docs/07_六道轮回详解.md §一. Defined at module level
#: rather than on RebirthForm because Django's Choices metaclass would turn
#: any extra class attribute into a choice member.
THREE_GOOD_PATHS = (RebirthForm.DIVINE, RebirthForm.HUMAN, RebirthForm.ASURA)
THREE_EVIL_PATHS = (RebirthForm.ANIMAL, RebirthForm.HUNGRY_GHOST, RebirthForm.HELL_BEING)
SIX_PATHS = THREE_GOOD_PATHS + THREE_EVIL_PATHS


class Reincarnation(AuditUserFields, models.Model):
    """
    A single reincarnation event for a soul.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    soul = models.ForeignKey(
        Soul,
        on_delete=models.CASCADE,
        related_name="reincarnations",
    )
    disposition = models.ForeignKey(
        "disposition.Disposition",
        on_delete=models.SET_NULL,
        null=True,
        related_name="reincarnations",
    )
    target_realm = models.CharField(max_length=100)
    rebirth_form = models.CharField(
        max_length=20,
        choices=RebirthForm.choices,
        default=RebirthForm.HUMAN,
    )
    cycle_count = models.IntegerField(default=1)
    previous_realm = models.CharField(max_length=100, blank=True)
    new_identity = models.CharField(max_length=255, blank=True, help_text="Name in new life")
    notes = models.TextField(blank=True)
    reincarnated_at = models.DateTimeField(auto_now_add=True)

    tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='reincarnations',
        null=True,
    )

    class Meta:
        ordering = ["-reincarnated_at"]
        verbose_name = "Reincarnation"
        verbose_name_plural = "Reincarnations"

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def __str__(self):
        return f"{self.soul.name} reborn as {self.rebirth_form} (cycle {self.cycle_count})"
