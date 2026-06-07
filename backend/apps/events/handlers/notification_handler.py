"""
NotificationHandler — handles NOTIFICATION events from EventBus.

Creates UserNotification records. WebSocket delivery is handled by the
WebSocketHandler which is also registered for the notification domain
via the EventBus registry.

EventEnvelope payload (two supported formats):
    Flat:   {"user_id": ..., "title": ..., "message": ...}
    Nested: {"notification": {"user_id": ..., "title": ..., "message": ...}}
"""
import logging

from apps.events.event_bus import DomainEventHandler, EventEnvelope

logger = logging.getLogger(__name__)


class NotificationHandler(DomainEventHandler):
    """
    Handles NOTIFICATION events from EventBus.

    Creates UserNotification records. WebSocket delivery is handled by the
    WebSocketHandler which is also registered for the notification domain.
    Filters: only handles events in the "notification" domain.
    """

    def should_handle(self, envelope: EventEnvelope) -> bool:
        """Only handle events in the notification domain."""
        return envelope.domain == "notification"

    def handle(self, envelope: EventEnvelope) -> None:
        """
        Handle a NOTIFICATION event.

        Creates a UserNotification record. WebSocket delivery is handled by
        the WebSocketHandler which is also registered for the notification domain.
        """
        from apps.authentication.models import User
        from apps.notifications.models import NotificationType, UserNotification

        # Support both flat payload and nested {"notification": {...}} format
        payload = envelope.payload
        notif_data = payload.get("notification", payload)
        user_id = notif_data.get("user_id")
        title = notif_data.get("title", "")
        message = notif_data.get("message", "")
        notification_type = notif_data.get("notification_type", NotificationType.SYSTEM)
        related_resource = notif_data.get("related_resource")
        related_id = notif_data.get("related_id")

        if not user_id:
            logger.warning("NotificationHandler: missing user_id in payload")
            return

        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            logger.warning("NotificationHandler: user %s not found", user_id)
            return

        # Create the notification record
        notification = UserNotification.objects.create(
            user=user,
            title=title[:200],  # Ensure max length
            message=message,
            notification_type=notification_type,
            related_resource=related_resource,
            related_id=related_id,
        )

        # WebSocket delivery is NOT done here — the EventBus registry also has
        # WebSocketHandler registered for the "notification" domain, so the WS
        # push happens automatically via the registry dispatch.  Calling
        # RealtimeEventPublisher here would cause a duplicate WS message.

        logger.debug(
            "NotificationHandler: created notification %s for user %s",
            notification.id,
            user_id,
        )
