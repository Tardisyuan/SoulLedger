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
    # Deliberately distinct from STATE_CHANGED: SETTLED has no forward
    # transitions (Soul.can_transition_to), so reverting it is never a
    # transition the state machine sanctioned — it's an ADMIN-only
    # correction of a data-entry error, and the timeline must not render it
    # as if the soul had walked the normal DISPOSED->SETTLED path backwards.
    SETTLEMENT_CORRECTED = "SETTLEMENT_CORRECTED"
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

    # Notification events
    #
    # The backend **emits** this — `apps/events/event_bus.py` and
    # `apps/events/services.py` both publish `event_type="NOTIFICATION_CREATED"`
    # — and it was not a member of this enum. The frontend's
    # `lib/events/event_registry.ts` **is** complete and handles it; the
    # incomplete list was this one, which is the direction nobody checks.
    NOTIFICATION_CREATED = "NOTIFICATION_CREATED"


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

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def __str__(self):
        return f"{self.event_type}: {self.soul.name} at {self.create_time}"


class EventWebhookStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    SUCCESS = "SUCCESS", "Delivered"
    FAILED = "FAILED", "Failed"
    ABANDONED = "ABANDONED", "Abandoned after max retries"


class EventWebhookDelivery(AuditUserFields, models.Model):
    """一条 EventBus webhook 投递的记录 —— 而不只是一次即发即忘的 HTTP 调用。

    WHY THIS EXISTS. `WebhookHandler` 过去在**请求线程上**对每个活跃 webhook 直接
    `urlopen(..., timeout=10)`,串行,而那个端点是租户自己配的。M26 修掉的是它
    发生在**发布者的事务内**(占着连接与行锁);剩下的两半是:请求要等它,
    而**失败之后没有任何东西记得这件事**。

    这张表就是「记得」。行在发布者的事务里写下(所以事务回滚时投递也不存在),
    投递本身在提交后交给 worker。**入队失败不算数据丢失** —— 行还在 PENDING,
    `events.retry_pending_webhooks` 会把它捡起来。这是它比「发不出去就算了」
    强的全部地方。

    与 `death_sync.WebhookDeliveryLog` 分开而不是复用:那张表的 `registration`
    是**非空外键**,而 EventBus 送的是一个 `EventEnvelope`,没有登记行。
    强行合并要把那个外键改成可空,让两个主体挤在一张表里——两边都读不清楚。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    webhook = models.ForeignKey(
        "death_sync.WebhookConfig",
        on_delete=models.CASCADE,
        related_name="event_deliveries",
        help_text="目标端点。租户自己配的,所以它的可靠性不在本系统控制内。",
    )
    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="event_webhook_deliveries",
        null=True,
        blank=True,
    )
    domain = models.CharField(max_length=50)
    event_type = models.CharField(max_length=50)
    payload_json = models.JSONField(
        help_text="投递的 envelope 快照。重试要发的是当时那一份,不是重新拼一份。"
    )

    status = models.CharField(
        max_length=20,
        choices=EventWebhookStatus.choices,
        default=EventWebhookStatus.PENDING,
        db_index=True,
    )
    attempt = models.IntegerField(default=0)
    response_status = models.IntegerField(null=True, blank=True)
    error = models.TextField(blank=True, default="")
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Event Webhook Delivery"
        verbose_name_plural = "Event Webhook Deliveries"
        ordering = ["-create_time"]
        indexes = [
            models.Index(fields=["status", "create_time"]),
            models.Index(fields=["tenant", "event_type"]),
        ]

    def __str__(self):
        return f"{self.event_type} → {self.webhook_id} [{self.status}]"
