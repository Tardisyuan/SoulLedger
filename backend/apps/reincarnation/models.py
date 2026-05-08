"""
Reincarnation model — tracks rebirth cycles.
"""
import uuid
from django.db import models
from apps.souls.models import Soul
from apps.tenants.managers import TenantManager


class RebirthForm(models.TextChoices):
    HUMAN = "HUMAN", "Human"
    ANIMAL = "ANIMAL", "Animal"
    DIVINE = "DIVINE", "Divine Being"
    OTHER = "OTHER", "Other"


class Reincarnation(models.Model):
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

    objects = TenantManager()

    def __str__(self):
        return f"{self.soul.name} reborn as {self.rebirth_form} (cycle {self.cycle_count})"
