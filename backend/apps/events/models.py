"""
Audit event log — immutable record of all soul state changes.
"""
import uuid

from django.db import models

from apps.core.models import AuditUserFields
from apps.tenants.managers import TenantManager


class EventType(models.TextChoices):
    # Soul audit events
    SOUL_CREATED = "SOUL_CREATED"
    STATE_CHANGED = "STATE_CHANGED"
    RECORD_ADDED = "RECORD_ADDED"
    JUDGMENT_INITIATED = "JUDGMENT_INITIATED"
    JUDGMENT_CONCLUDED = "JUDGMENT_CONCLUDED"
    DISPOSITION_CREATED = "DISPOSITION_CREATED"
    REINCARNATION_TRIGGERED = "REINCARNATION_TRIGGERED"
    KARMA_RECALCULATED = "KARMA_RECALCULATED"

    # Workflow events (M12 Phase 2)
    WORKFLOW_CREATED = "WORKFLOW_CREATED"
    WORKFLOW_ASSIGNED = "WORKFLOW_ASSIGNED"
    WORKFLOW_APPROVED = "WORKFLOW_APPROVED"
    WORKFLOW_REJECTED = "WORKFLOW_REJECTED"

    # Dispatch events
    DISPATCH_CREATED = "DISPATCH_CREATED"
    DISPATCH_APPROVED = "DISPATCH_APPROVED"
    DISPATCH_REJECTED = "DISPATCH_REJECTED"
    DISPATCH_EXECUTED = "DISPATCH_EXECUTED"
    DISPATCH_STATUS_CHANGED = "DISPATCH_STATUS_CHANGED"

    # Death sync events
    DEATH_SYNC_RECEIVED = "DEATH_SYNC_RECEIVED"
    DEATH_SYNC_PROCESSED = "DEATH_SYNC_PROCESSED"

    # Social events (M13)
    POST_CREATED = "POST_CREATED"
    POST_UPDATED = "POST_UPDATED"
    POST_DELETED = "POST_DELETED"
    COMMENT_CREATED = "COMMENT_CREATED"
    COMMENT_DELETED = "COMMENT_DELETED"
    REACTION_ADDED = "REACTION_ADDED"
    REACTION_REMOVED = "REACTION_REMOVED"
    USER_FOLLOWED = "USER_FOLLOWED"
    USER_UNFOLLOWED = "USER_UNFOLLOWED"


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
