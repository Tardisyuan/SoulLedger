"""
RealtimeEventPublisher — backward-compatible facade over the unified EventBus.

New code should use ``from apps.events.event_bus import event_bus`` directly.
The static methods below delegate to the EventBus, which fans out to
WebSocketHandler (channel layer), NotificationHandler, and WebhookHandler.

Channel Naming Convention:
  rt:tenant:{code}    — tenant-wide broadcast (all users in tenant)
  rt:user:{user_id}   — per-user targeted delivery
"""
import logging

logger = logging.getLogger(__name__)


class RealtimeEventPublisher:
    """
    Backward-compatible facade.  All methods delegate to the EventBus.

    Deprecated: prefer ``event_bus.publish()`` or domain-specific helpers.
    """

    @staticmethod
    def publish(
        domain: str,
        event_type: str,
        payload: dict,
        tenant_code: str | None = None,
        user_ids: list[int] | None = None,
        permission: str | None = None,
    ) -> None:
        from apps.events.event_bus import event_bus
        event_bus.publish(
            event_type=event_type,
            payload=payload,
            domain=domain,
            tenant_code=tenant_code,
            user_ids=user_ids,
            permission=permission,
        )

    @staticmethod
    def publish_notification(
        user_id: int,
        notification_data: dict,
        tenant_code: str | None = None,
        permission: str | None = "notification.read",
    ) -> None:
        from apps.events.event_bus import event_bus
        event_bus.publish_notification(
            user_id=user_id,
            notification_data=notification_data,
            tenant_code=tenant_code,
            permission=permission,
        )

    @staticmethod
    def publish_workflow(
        event_type: str,
        payload: dict,
        tenant_code: str | None = None,
        user_ids: list[int] | None = None,
        permission: str | None = "workflow.read",
    ) -> None:
        from apps.events.event_bus import event_bus
        event_bus.publish_workflow(
            event_type=event_type,
            payload=payload,
            tenant_code=tenant_code,
            user_ids=user_ids,
            permission=permission,
        )

    @staticmethod
    def publish_dispatch(
        event_type: str,
        payload: dict,
        tenant_code: str | None = None,
        user_ids: list[int] | None = None,
        permission: str | None = "dispatch.read",
    ) -> None:
        from apps.events.event_bus import event_bus
        event_bus.publish_dispatch(
            event_type=event_type,
            payload=payload,
            tenant_code=tenant_code,
            user_ids=user_ids,
            permission=permission,
        )

    @staticmethod
    def publish_deathsync(
        event_type: str,
        payload: dict,
        tenant_code: str | None = None,
        permission: str | None = "audit.read",
    ) -> None:
        from apps.events.event_bus import event_bus
        event_bus.publish_deathsync(
            event_type=event_type,
            payload=payload,
            tenant_code=tenant_code,
            permission=permission,
        )


class ChannelNaming:
    """
    Standardized channel naming conventions.

    Groups:
      rt_tenant_{code}   — all users in a tenant
      rt_user_{user_id}  — single user

    Note: Channel layer group names must be ASCII alphanumerics, hyphens,
    underscores, or periods (no colons allowed).
    """

    @staticmethod
    def tenant_group(tenant_code: str) -> str:
        """Channel group name for tenant-wide broadcast."""
        return f"rt_tenant_{tenant_code}"

    @staticmethod
    def user_group(user_id: int) -> str:
        """Channel group name for per-user delivery."""
        return f"rt_user_{user_id}"
