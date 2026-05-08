"""
Actor models — deities, judges, guardians, executors across civilizations.
"""
import uuid
from django.db import models
from apps.souls.models import Civilization


class ActorRole(models.TextChoices):
    JUDGE = "JUDGE", "Judge"
    EXECUTOR = "EXECUTOR", "Executor / Punisher"
    GUARDIAN = "GUARDIAN", "Guardian"
    CONDUIT = "CONDUIT", "Soul Conduit / Guide"
    OVERSEER = "OVERSEER", "Overseer / Admin"


class Actor(models.Model):
    """
    A supernatural entity (deity, judge, warden, etc.)
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    civilization = models.CharField(max_length=20, choices=Civilization.choices)
    role = models.CharField(max_length=20, choices=ActorRole.choices)
    realm = models.ForeignKey(
        "realms.Realm",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="actors",
    )
    title = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    powers_json = models.JSONField(default=dict, blank=True)
    icon_url = models.URLField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["civilization", "role", "name"]
        verbose_name = "Actor"
        verbose_name_plural = "Actors"

    def __str__(self):
        return f"{self.name} ({self.role})"
