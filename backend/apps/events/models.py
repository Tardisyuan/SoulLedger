"""
Audit event log — immutable record of all soul state changes.
"""
import uuid
from django.db import models
from apps.core.models import AuditUserFields
from apps.tenants.managers import TenantManager


class EventType(models.TextChoices):
    SOUL_CREATED = "SOUL_CREATED"
    STATE_CHANGED = "STATE_CHANGED"
    RECORD_ADDED = "RECORD_ADDED"
    JUDGMENT_INITIATED = "JUDGMENT_INITIATED"
    JUDGMENT_CONCLUDED = "JUDGMENT_CONCLUDED"
    DISPOSITION_CREATED = "DISPOSITION_CREATED"
    REINCARNATION_TRIGGERED = "REINCARNATION_TRIGGERED"
    KARMA_RECALCULATED = "KARMA_RECALCULATED"


class SoulEvent(AuditUserFields, models.Model):
    """
    Immutable audit log entry. Never delete.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.PROTECT,
        related_name="soul_events",
        null=True,
    )
    soul = models.ForeignKey(
        "souls.Soul",
        on_delete=models.CASCADE,
        related_name="events",
    )
    event_type = models.CharField(max_length=30, choices=EventType.choices)
    payload = models.JSONField(default=dict)
    actor = models.CharField(max_length=255, blank=True, help_text="User or system")

    class Meta:
        ordering = ["-create_time"]
        verbose_name = "Soul Event"
        verbose_name_plural = "Soul Events"
        indexes = [
            models.Index(fields=["soul", "create_time"]),
            models.Index(fields=["event_type"]),
            models.Index(fields=["tenant", "create_time"]),
        ]

    objects = TenantManager()

    def __str__(self):
        return f"{self.event_type}: {self.soul.name} at {self.create_time}"
