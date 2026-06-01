"""
UserNotification model for in-app notifications.
"""
from django.db import models
from django.conf import settings
from apps.core.models import AuditUserFields


class NotificationType(models.TextChoices):
    WORKFLOW_ASSIGNED = "WORKFLOW_ASSIGNED", "Workflow Assigned"
    JUDGMENT_COMPLETED = "JUDGMENT_COMPLETED", "Judgment Completed"
    SYSTEM = "SYSTEM", "System Notification"
    APPEAL_REQUIRED = "APPEAL_REQUIRED", "Appeal Required"
    REINCARNATION_COMPLETE = "REINCARNATION_COMPLETE", "Reincarnation Complete"
    KARMIC_UPDATE = "KARMIC_UPDATE", "Karmic Update"
    ROLE_ASSIGNED = "ROLE_ASSIGNED", "Role Assigned"


class UserNotification(AuditUserFields, models.Model):
    """
    In-app notification for users (separate from tenant dispatch notifications).
    Inherits AuditUserFields for audit trail and soft delete.
    """
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="app_notifications",
    )
    title = models.CharField(max_length=200)
    message = models.TextField()
    notification_type = models.CharField(
        max_length=30,
        choices=NotificationType.choices,
        default=NotificationType.SYSTEM,
    )
    is_read = models.BooleanField(default=False, db_index=True)
    related_resource = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        help_text="e.g., 'workflow', 'judgment', 'soul'",
    )
    related_id = models.CharField(
        max_length=36,
        blank=True,
        null=True,
        help_text="UUID of related resource",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "User Notification"
        verbose_name_plural = "User Notifications"
        indexes = [
            models.Index(fields=["user", "is_read"]),
            models.Index(fields=["user", "created_at"]),
        ]

    def __str__(self):
        return f"{self.user.username}: {self.title}"


def notify_user(
    user,
    title: str,
    message: str,
    notification_type: str = NotificationType.SYSTEM,
    related_resource: str = None,
    related_id: str = None,
) -> UserNotification:
    """
    Create a notification for a specific user.

    Args:
        user: User instance to notify
        title: Notification title (max 200 chars)
        message: Notification message body
        notification_type: Type of notification (choices from NotificationType)
        related_resource: Optional resource type (e.g., 'workflow', 'judgment')
        related_id: Optional resource UUID

    Returns:
        Created UserNotification instance
    """
    return UserNotification.objects.create(
        user=user,
        title=title[:200],  # Ensure max length
        message=message,
        notification_type=notification_type,
        related_resource=related_resource,
        related_id=related_id,
    )