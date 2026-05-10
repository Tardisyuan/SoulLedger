"""
Actor models — deities, judges, guardians, executors across civilizations.
"""
import uuid
from django.db import models
from apps.souls.models import Civilization
from apps.tenants.managers import TenantManager


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
    name = models.CharField(max_length=255, help_text="Primary / local name")
    civilization = models.CharField(max_length=20, choices=Civilization.choices)
    role = models.CharField(max_length=20, choices=ActorRole.choices)
    realm = models.ForeignKey(
        "realms.Realm",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="actors",
    )
    # Localised name fields
    name_zh = models.CharField(max_length=255, blank=True)
    name_en = models.CharField(max_length=255, blank=True)
    name_egy = models.CharField(
        max_length=255,
        blank=True,
        help_text="Egyptian name — transliteration or hieroglyphs (𓂀)",
    )
    title = models.CharField(max_length=255, blank=True)
    title_zh = models.CharField(max_length=255, blank=True)
    title_en = models.CharField(max_length=255, blank=True)
    title_egy = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    powers_json = models.JSONField(default=dict, blank=True)
    icon_url = models.URLField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='actors',
        null=True,
    )

    class Meta:
        ordering = ["civilization", "role", "name"]
        verbose_name = "Actor"
        verbose_name_plural = "Actors"
        indexes = [
            models.Index(fields=["civilization", "role"]),
            models.Index(fields=["tenant", "civilization"]),
        ]

    objects = TenantManager()

    def __str__(self):
        return f"{self.name} ({self.role})"

    def get_localized_name(self, locale: str = "en") -> str:
        if locale.startswith("zh"):
            return self.name_zh or self.name_en or self.name
        if locale == "egy":
            return self.name_egy or self.name_en or self.name
        return self.name_en or self.name

    def get_localized_title(self, locale: str = "en") -> str:
        if locale.startswith("zh"):
            return self.title_zh or self.title_en or self.title
        if locale == "egy":
            return self.title_egy or self.title_en or self.title
        return self.title_en or self.title
