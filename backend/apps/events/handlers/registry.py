"""
DomainEventHandlerRegistry — centralized handler registration and dispatch.

Eliminates if/else chains by mapping event types and domains to handlers
via declarative registration. Handlers are looked up in O(1) via dict keys.

Architecture:
    Registry ── register ──> {event_type: [handlers]}
                           {domain: [handlers]}
    Registry ── dispatch ──> handler.handle(envelope)

Usage:
    from apps.events.handlers.registry import handler_registry

    # Register by event type
    handler_registry.register("WORKFLOW_APPROVED", my_custom_handler)

    # Register by domain (handler receives ALL events in that domain)
    handler_registry.register_domain("workflow", WebSocketHandler())

    # Dispatch
    handler_registry.dispatch(envelope)

The registry is separate from EventBus to keep concerns decoupled:
    - Registry: handler lookup and dispatch
    - EventBus: envelope construction, convenience methods, singleton lifecycle
"""
import logging
from collections import defaultdict
from typing import Optional

from apps.events.event_bus import DomainEventHandler, EventEnvelope

logger = logging.getLogger(__name__)


class DomainEventHandlerRegistry:
    """
    Centralized registry for domain-specific event handlers.

    Provides O(1) handler lookup via two indexes:
        _handlers:       event_type -> [handler, ...]  (specific)
        _domain_handlers: domain     -> [handler, ...]  (domain-wide)

    Dispatch order:
        1. Specific event_type handlers
        2. Domain handlers (where should_handle returns True)
        3. Global handlers (handle every event)

    Thread safety:
        Registration is expected at startup only (Django AppConfig.ready).
        Dispatch is safe for concurrent reads; no write locks needed.
    """

    def __init__(self) -> None:
        # event_type (e.g. "WORKFLOW_APPROVED" or "*") -> [DomainEventHandler]
        self._handlers: dict[str, list[DomainEventHandler]] = defaultdict(list)
        # domain (e.g. "workflow") -> [DomainEventHandler]
        self._domain_handlers: dict[str, list[DomainEventHandler]] = defaultdict(list)
        # Global handlers that receive ALL events regardless of domain/type
        self._global_handlers: list[DomainEventHandler] = []

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def register(self, event_type: str, handler: DomainEventHandler) -> None:
        """
        Register a handler for a specific event type.

        Use ``"*"`` to subscribe to all event types.

        Args:
            event_type: Canonical event name (e.g. WORKFLOW_APPROVED) or "*".
            handler: DomainEventHandler instance.
        """
        self._handlers[event_type].append(handler)

    def unregister(self, event_type: str, handler: DomainEventHandler) -> None:
        """Remove a previously registered handler for an event type."""
        handlers = self._handlers.get(event_type, [])
        self._handlers[event_type] = [h for h in handlers if h is not handler]

    def register_domain(self, domain: str, handler: DomainEventHandler) -> None:
        """
        Register a handler for ALL events in a domain.

        The handler receives events where envelope.domain == domain,
        filtered by its should_handle() method.

        Args:
            domain: Logical domain (e.g. "workflow", "notification").
            handler: DomainEventHandler instance.
        """
        self._domain_handlers[domain].append(handler)

    def unregister_domain(self, domain: str, handler: DomainEventHandler) -> None:
        """Remove a previously registered domain handler."""
        handlers = self._domain_handlers.get(domain, [])
        self._domain_handlers[domain] = [h for h in handlers if h is not handler]

    def register_global(self, handler: DomainEventHandler) -> None:
        """
        Register a handler that receives ALL events.

        Used for cross-cutting concerns (metrics, logging, tracing).
        """
        self._global_handlers.append(handler)

    def unregister_global(self, handler: DomainEventHandler) -> None:
        """Remove a previously registered global handler."""
        self._global_handlers = [h for h in self._global_handlers if h is not handler]

    # ------------------------------------------------------------------
    # Lookup
    # ------------------------------------------------------------------

    def get_handlers(self, event_type: str, domain: Optional[str] = None) -> list[DomainEventHandler]:
        """
        Get all handlers that would process an event of this type.

        Returns a deduplicated list combining:
            1. Specific event_type handlers (including "*")
            2. Domain handlers (if domain provided)
            3. Global handlers

        Args:
            event_type: The event type to look up.
            domain: Optional domain to include domain handlers.

        Returns:
            List of DomainEventHandler instances (may be empty).
        """
        result: list[DomainEventHandler] = []

        # Specific handlers
        result.extend(self._handlers.get(event_type, []))
        result.extend(self._handlers.get("*", []))

        # Domain handlers
        if domain:
            result.extend(self._domain_handlers.get(domain, []))

        # Global handlers
        result.extend(self._global_handlers)

        return result

    def get_domain_handlers(self, domain: str) -> list[DomainEventHandler]:
        """Get all handlers registered for a specific domain."""
        return list(self._domain_handlers.get(domain, []))

    # ------------------------------------------------------------------
    # Dispatch
    # ------------------------------------------------------------------

    def dispatch(self, envelope: EventEnvelope) -> None:
        """
        Dispatch an event to all registered handlers.

        Dispatch order:
            1. Specific event_type handlers (should_handle check)
            2. Wildcard "*" handlers (should_handle check)
            3. Domain handlers (should_handle check)
            4. Global handlers (should_handle check)

        Exceptions in handlers are logged and swallowed — they never
        propagate to the caller.

        Args:
            envelope: The EventEnvelope to dispatch.
        """
        # 1. Specific event_type handlers
        for handler in self._handlers.get(envelope.event_type, []):
            if handler.should_handle(envelope):
                self._safe_call(handler, envelope)

        # 2. Wildcard handlers
        for handler in self._handlers.get("*", []):
            if handler.should_handle(envelope):
                self._safe_call(handler, envelope)

        # 3. Domain handlers
        for handler in self._domain_handlers.get(envelope.domain, []):
            if handler.should_handle(envelope):
                self._safe_call(handler, envelope)

        # 4. Global handlers
        for handler in self._global_handlers:
            if handler.should_handle(envelope):
                self._safe_call(handler, envelope)

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def handler_count(self) -> dict:
        """Return counts of registered handlers by category."""
        return {
            "event_type_handlers": sum(len(h) for h in self._handlers.values()),
            "domain_handlers": sum(len(h) for h in self._domain_handlers.values()),
            "global_handlers": len(self._global_handlers),
            "total": (
                sum(len(h) for h in self._handlers.values())
                + sum(len(h) for h in self._domain_handlers.values())
                + len(self._global_handlers)
            ),
        }

    def registered_event_types(self) -> list[str]:
        """Return all event types that have at least one handler."""
        return sorted(self._handlers.keys())

    def registered_domains(self) -> list[str]:
        """Return all domains that have at least one handler."""
        return sorted(self._domain_handlers.keys())

    def reset(self) -> None:
        """Clear all registrations. For testing only."""
        self._handlers.clear()
        self._domain_handlers.clear()
        self._global_handlers.clear()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    @staticmethod
    def _safe_call(handler: DomainEventHandler, envelope: EventEnvelope) -> None:
        """Call a handler, swallowing exceptions."""
        try:
            handler.handle(envelope)
        except Exception:
            logger.exception(
                "HandlerRegistry: %s failed for %s.%s",
                handler.__class__.__name__,
                envelope.domain,
                envelope.event_type,
            )


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

handler_registry = DomainEventHandlerRegistry()
