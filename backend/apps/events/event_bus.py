"""
Unified EventBus for SoulLedger — single publish/subscribe entry point for all domains.

Architecture:
    Publisher -> EventBus.publish() -> EventEnvelope -> handler_registry.dispatch()
                                                     -> [AuditHandler, WebSocketHandler, ...]

Replaces:
    EventService (audit logging) + RealtimeEventPublisher (WebSocket push)

Usage:
    from apps.events.event_bus import event_bus

    # Fire-and-forget publish
    event_bus.publish(
        event_type="WORKFLOW_APPROVED",
        payload={"workflow_id": str(wf.id)},
        domain="workflow",
        tenant_code="CN_DIYU",
        user_ids=[wf.assignee_id],
        permission="workflow.read",
    )

    # Domain-specific convenience
    event_bus.publish_soul_event(soul, "SOUL_CREATED", {...})
"""
import logging
from abc import ABC, abstractmethod
from collections import defaultdict
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Event envelope
# ---------------------------------------------------------------------------

class EventEnvelope:
    """
    Immutable event container passed to handlers.

    Attributes:
        event_type: Canonical event name (e.g. WORKFLOW_APPROVED).
        payload: Arbitrary data dict.
        domain: Logical domain (notification, workflow, dispatch, deathsync, soul).
        tenant_code: Tenant scope for isolation.
        user_ids: Targeted recipients (None = tenant broadcast).
        permission: Optional RBAC gate codename.
        actor: Who triggered the event (user identifier or "system").
    """

    __slots__ = (
        "event_type", "payload", "domain", "tenant_code",
        "user_ids", "permission", "actor",
    )

    def __init__(
        self,
        event_type: str,
        payload: dict,
        domain: str,
        tenant_code: Optional[str] = None,
        user_ids: Optional[list[int]] = None,
        permission: Optional[str] = None,
        actor: str = "system",
    ) -> None:
        self.event_type = event_type
        self.payload = payload
        self.domain = domain
        self.tenant_code = tenant_code
        self.user_ids = user_ids
        self.permission = permission
        self.actor = actor

    def to_dict(self) -> dict:
        """Serialize for logging / transport."""
        return {
            "event_type": self.event_type,
            "domain": self.domain,
            "tenant_code": self.tenant_code,
            "user_ids": self.user_ids,
            "permission": self.permission,
            "actor": self.actor,
            "payload": self.payload,
        }


# ---------------------------------------------------------------------------
# Handler interface
# ---------------------------------------------------------------------------

class DomainEventHandler(ABC):
    """
    Base class for all event handlers.

    Each handler receives the full EventEnvelope and decides
    whether to act based on its own domain/filter logic.
    """

    @abstractmethod
    def handle(self, envelope: EventEnvelope) -> None:
        """Process the event. Implementations MUST NOT raise."""

    def should_handle(self, envelope: EventEnvelope) -> bool:
        """
        Override to filter events.
        Default: always handle.
        """
        return True


# ---------------------------------------------------------------------------
# EventBus — central coordinator
# ---------------------------------------------------------------------------

class EventBus:
    """
    Unified publish/subscribe event bus.

    Delegates handler dispatch to DomainEventHandlerRegistry.
    Provides convenience publishers for each domain.

    All publish() calls are synchronous and fire-and-forget.
    Exceptions in handlers are logged and swallowed.
    """

    def __init__(self) -> None:
        # Lazy-import to avoid circular dependency at module load time
        self._registry = None

    @property
    def _get_registry(self):
        """Lazy-load the handler registry."""
        if self._registry is None:
            from apps.events.handlers.registry import handler_registry
            self._registry = handler_registry
        return self._registry

    # ------------------------------------------------------------------
    # Registration (delegates to registry)
    # ------------------------------------------------------------------

    def register_handler(self, domain: str, handler: DomainEventHandler) -> None:
        """
        Register a DomainEventHandler for a specific domain.

        The handler will receive all events where envelope.domain == domain.
        Delegates to handler_registry.register_domain().
        """
        self._get_registry.register_domain(domain, handler)

    def register_event_handler(self, event_type: str, handler: DomainEventHandler) -> None:
        """
        Register a handler for a specific event type.

        Delegates to handler_registry.register().
        """
        self._get_registry.register(event_type, handler)

    def register_global_handler(self, handler: DomainEventHandler) -> None:
        """
        Register a DomainEventHandler that receives ALL events.
        Used for cross-cutting concerns (e.g., metrics, logging).
        """
        self._get_registry.register_global(handler)

    # ------------------------------------------------------------------
    # Publishing
    # ------------------------------------------------------------------

    def publish(
        self,
        event_type: str,
        payload: dict,
        domain: str,
        tenant_code: Optional[str] = None,
        user_ids: Optional[list[int]] = None,
        permission: Optional[str] = None,
        actor: str = "system",
    ) -> None:
        """
        Publish an event to all registered handlers.

        Constructs an EventEnvelope and delegates dispatch to the registry.
        """
        envelope = EventEnvelope(
            event_type=event_type,
            payload=payload,
            domain=domain,
            tenant_code=tenant_code,
            user_ids=user_ids,
            permission=permission,
            actor=actor,
        )
        self._get_registry.dispatch(envelope)

    # ------------------------------------------------------------------
    # Convenience publishers (backward-compat style)
    # ------------------------------------------------------------------

    def publish_soul_event(
        self, soul: Any, event_type: str, payload: dict, actor: str = "system"
    ) -> None:
        """Publish a soul-domain audit event."""
        self.publish(
            event_type=event_type,
            payload={"soul_id": str(soul.id), **payload},
            domain="soul",
            tenant_code=getattr(soul.tenant, "code", None) if soul.tenant else None,
            actor=actor,
        )

    def publish_notification(
        self,
        user_id: int,
        notification_data: dict,
        tenant_code: Optional[str] = None,
        permission: Optional[str] = "notification.read",
    ) -> None:
        """Publish a notification event to a specific user."""
        self.publish(
            event_type="NOTIFICATION_CREATED",
            payload={"notification": notification_data},
            domain="notification",
            tenant_code=tenant_code,
            user_ids=[user_id],
            permission=permission,
        )

    def publish_workflow(
        self,
        event_type: str,
        payload: dict,
        tenant_code: Optional[str] = None,
        user_ids: Optional[list[int]] = None,
        permission: Optional[str] = "workflow.read",
    ) -> None:
        """Publish a workflow event."""
        self.publish(
            event_type=event_type,
            payload=payload,
            domain="workflow",
            tenant_code=tenant_code,
            user_ids=user_ids,
            permission=permission,
        )

    def publish_dispatch(
        self,
        event_type: str,
        payload: dict,
        tenant_code: Optional[str] = None,
        user_ids: Optional[list[int]] = None,
        permission: Optional[str] = "dispatch.read",
    ) -> None:
        """Publish a dispatch event."""
        self.publish(
            event_type=event_type,
            payload=payload,
            domain="dispatch",
            tenant_code=tenant_code,
            user_ids=user_ids,
            permission=permission,
        )

    def publish_deathsync(
        self,
        event_type: str,
        payload: dict,
        tenant_code: Optional[str] = None,
        permission: Optional[str] = "audit.read",
    ) -> None:
        """Publish a death sync event."""
        self.publish(
            event_type=event_type,
            payload=payload,
            domain="deathsync",
            tenant_code=tenant_code,
            permission=permission,
        )

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def handler_count(self) -> dict:
        """Return counts of registered handlers by category."""
        return self._get_registry.handler_count()

    def reset(self) -> None:
        """Clear all registrations. For testing only."""
        self._get_registry.reset()


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

event_bus = EventBus()


def configure_default_handlers() -> None:
    """
    Register the standard handler set.

    Called once at Django startup (from AppConfig.ready).
    Idempotent — safe to call multiple times.

    Handlers are registered via handler_registry:
        - soul domain:    AuditHandler (audit logging)
        - * domains:      WebSocketHandler (real-time push)
        - notification:   NotificationHandler (UserNotification + WS)
        - all domains:    WebhookHandler (external delivery)
    """
    from apps.events.handlers.registry import handler_registry
    from apps.events.handlers.audit_handler import AuditHandler
    from apps.events.handlers.websocket_handler import WebSocketHandler
    from apps.events.handlers.notification_handler import NotificationHandler
    from apps.events.handlers.webhook_handler import WebhookHandler

    counts = handler_registry.handler_count()
    if counts["total"] > 0:
        return  # already configured

    # Audit logging — all domains that carry soul_id in payload
    for domain in ("soul", "workflow", "notification", "dispatch", "deathsync", "social"):
        handler_registry.register_domain(domain, AuditHandler())

    # All domains — WebSocket real-time push
    for domain in ("workflow", "notification", "dispatch", "deathsync", "social"):
        handler_registry.register_domain(domain, WebSocketHandler())

    # Notification domain — UserNotification + WS push
    handler_registry.register_domain("notification", NotificationHandler())

    # All domains — webhook delivery (filters by tenant internally)
    for domain in ("workflow", "notification", "dispatch", "deathsync", "social"):
        handler_registry.register_domain(domain, WebhookHandler())

    logger.info("EventBus: default handlers configured (%s)", handler_registry.handler_count())
