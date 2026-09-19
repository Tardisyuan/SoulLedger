"""
UserNotification model for in-app notifications.
"""
from django.conf import settings
from django.db import models

from apps.core.models import AuditUserFields


class NotificationType(models.TextChoices):
    WORKFLOW_ASSIGNED = "WORKFLOW_ASSIGNED", "Workflow Assigned"
    JUDGMENT_COMPLETED = "JUDGMENT_COMPLETED", "Judgment Completed"
    SYSTEM = "SYSTEM", "System Notification"
    APPEAL_REQUIRED = "APPEAL_REQUIRED", "Appeal Required"
    REINCARNATION_COMPLETE = "REINCARNATION_COMPLETE", "Reincarnation Complete"
    KARMIC_UPDATE = "KARMIC_UPDATE", "Karmic Update"
    ROLE_ASSIGNED = "ROLE_ASSIGNED", "Role Assigned"
    # The five below arrive from apps.dispatch. They were previously written to
    # `apps.tenants.Notification`, a second notification model with four
    # writers and no reader anywhere in the codebase — no serializer, no view,
    # no consumer — so every dispatch notification this system has ever
    # produced went into a table nothing selects from. DISPATCH_PROPOSED is the
    # "a proposal is waiting on you" message, which is the entire point of the
    # approve/reject flow.
    DISPATCH_PROPOSED = "DISPATCH_PROPOSED", "Dispatch Proposed"
    DISPATCH_APPROVED = "DISPATCH_APPROVED", "Dispatch Approved"
    DISPATCH_REJECTED = "DISPATCH_REJECTED", "Dispatch Rejected"
    CROSS_JUDGMENT_INVITED = "CROSS_JUDGMENT_INVITED", "Cross-Tenant Judgment Invitation"
    JUDGMENT_CONCLUDED = "JUDGMENT_CONCLUDED", "Judgment Concluded"
    # 暂居的自动回归被未结案审判拦下(`DispatchService.record_blocked_return`)。
    DISPATCH_RETURN_BLOCKED = "DISPATCH_RETURN_BLOCKED", "Dispatch Return Blocked"
    # 受刑计划(docs/ARCHITECTURE-sentence-plan.md §5.1)。文案键见 apps/notifications/messages.py。
    SENTENCE_NODE_ACTIVE = "SENTENCE_NODE_ACTIVE", "Sentence Node Active"
    SENTENCE_NODE_DONE = "SENTENCE_NODE_DONE", "Sentence Node Done"
    SENTENCE_NODE_WAITING = "SENTENCE_NODE_WAITING", "Sentence Node Waiting"
    SENTENCE_NODE_REFUSED = "SENTENCE_NODE_REFUSED", "Sentence Node Refused"
    SENTENCE_PLAN_COMPLETED = "SENTENCE_PLAN_COMPLETED", "Sentence Plan Completed"
    CROSS_SENTENCE_SUBMITTED = "CROSS_SENTENCE_SUBMITTED", "Cross Sentence Submitted"
    SENTENCE_PLAN_AMENDED = "SENTENCE_PLAN_AMENDED", "Sentence Plan Amended"
    SENTENCE_REQUEST_PENDING = "SENTENCE_REQUEST_PENDING", "Sentence Request Pending"
    SENTENCE_REQUEST_DECIDED = "SENTENCE_REQUEST_DECIDED", "Sentence Request Decided"
    SENTENCE_PLAN_CANCELLED = "SENTENCE_PLAN_CANCELLED", "Sentence Plan Cancelled"


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
    # 分语言的类型(`apps/notifications/messages.py::KIND_BY_TYPE`)读时渲染要的参数。
    # 不进 API:序列化器用它渲染 title / message,客户端看到的仍是那两个字段。
    params = models.JSONField(default=dict, blank=True)
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
    params: dict = None,
) -> None:
    """
    Publish a notification event to EventBus.

    The EventBus routes to NotificationHandler, which creates the
    UserNotification record, and to WebSocketHandler, which does the push.
    (This said "pushes to WebSocket via RealtimeEventPublisher" and was
    already untrue before that facade was deleted: NotificationHandler has
    never pushed anything — see its own note at handlers/notification_handler.py.)

    Business modules should use event_bus.publish_notification() or
    event_bus.publish("notification", {...}) directly for full decoupling.
    This helper is a convenience wrapper.

    Args:
        user: User instance to notify
        title: Notification title (max 200 chars)
        message: Notification message body
        notification_type: Type of notification (choices from NotificationType)
        related_resource: Optional resource type (e.g., 'workflow', 'judgment')
        related_id: Optional resource UUID
    """
    from apps.events.event_bus import event_bus

    # Resolve tenant code from user for realtime push
    tenant_code = None
    if hasattr(user, "tenant") and user.tenant:
        tenant_code = user.tenant.code

    event_bus.publish_notification(
        user_id=user.id,
        notification_data={
            "user_id": user.id,
            "title": title,
            "message": message,
            "notification_type": notification_type,
            "related_resource": related_resource,
            "related_id": related_id,
            "params": params or {},
        },
        tenant_code=tenant_code,
        permission="notification.read",
    )
