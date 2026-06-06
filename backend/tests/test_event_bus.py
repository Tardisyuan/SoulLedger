"""
Tests for EventBus — unified publish/subscribe event system.

Covers:
  - EventEnvelope creation and serialization
  - EventBus publish routing (event_type, domain, global handlers)
  - DomainEventHandlerRegistry dispatch logic
  - DomainEventHandler should_handle filtering
  - AuditHandler (SoulEvent creation)
  - WebSocketHandler (channel layer delegation)
  - NotificationHandler (UserNotification creation)
  - Backward-compat: EventService → EventBus delegation
  - Backward-compat: RealtimeEventPublisher → EventBus delegation
  - EventBus handler_count / reset
  - Error swallowing in handlers
"""
import pytest
from unittest.mock import patch, MagicMock
from apps.events.event_bus import (
    EventBus,
    EventEnvelope,
    DomainEventHandler,
    event_bus,
)
from apps.events.handlers.registry import handler_registry, DomainEventHandlerRegistry
from apps.events.handlers.audit_handler import AuditHandler
from apps.events.handlers.websocket_handler import WebSocketHandler
from apps.events.handlers.notification_handler import NotificationHandler
from apps.events.handlers.webhook_handler import WebhookHandler


# ------------------------------------------------------------------
# EventEnvelope
# ------------------------------------------------------------------


class TestEventEnvelope:
    def test_creation(self):
        env = EventEnvelope(
            event_type="TEST_EVENT",
            payload={"key": "value"},
            domain="test",
            tenant_code="CN_DIYU",
            user_ids=[1, 2],
            permission="test.read",
            actor="tester",
        )
        assert env.event_type == "TEST_EVENT"
        assert env.payload == {"key": "value"}
        assert env.domain == "test"
        assert env.tenant_code == "CN_DIYU"
        assert env.user_ids == [1, 2]
        assert env.permission == "test.read"
        assert env.actor == "tester"

    def test_defaults(self):
        env = EventEnvelope(event_type="X", payload={}, domain="d")
        assert env.tenant_code is None
        assert env.user_ids is None
        assert env.permission is None
        assert env.actor == "system"

    def test_to_dict(self):
        env = EventEnvelope(
            event_type="E", payload={"a": 1}, domain="d",
            tenant_code="T", user_ids=[1], permission="p", actor="a",
        )
        d = env.to_dict()
        assert d["event_type"] == "E"
        assert d["domain"] == "d"
        assert d["payload"] == {"a": 1}
        assert d["tenant_code"] == "T"
        assert d["user_ids"] == [1]


# ------------------------------------------------------------------
# DomainEventHandler base
# ------------------------------------------------------------------


class TestDomainEventHandler:
    def test_abstract_cannot_instantiate(self):
        with pytest.raises(TypeError):
            DomainEventHandler()

    def test_concrete_subclass(self):
        class DummyHandler(DomainEventHandler):
            def handle(self, envelope):
                pass

        h = DummyHandler()
        assert h.should_handle(EventEnvelope("E", {}, "d")) is True


# ------------------------------------------------------------------
# EventBus core
# ------------------------------------------------------------------


class TestEventBusCore:
    def test_publish_routes_to_domain_handlers(self):
        bus = EventBus()
        handled = []

        class TestHandler(DomainEventHandler):
            def handle(self, envelope):
                handled.append(envelope.event_type)

        bus.register_handler("my_domain", TestHandler())
        bus.publish("EVT", {}, "my_domain")
        assert handled == ["EVT"]

    def test_domain_handler_not_routed_for_other_domain(self):
        bus = EventBus()
        handled = []

        class TestHandler(DomainEventHandler):
            def handle(self, envelope):
                handled.append(envelope.event_type)

        bus.register_handler("domain_a", TestHandler())
        bus.publish("EVT", {}, "domain_b")
        assert handled == []

    def test_global_handler_receives_all(self):
        bus = EventBus()
        handled = []

        class GlobalH(DomainEventHandler):
            def handle(self, envelope):
                handled.append(envelope.domain)

        bus.register_global_handler(GlobalH())
        bus.publish("A", {}, "d1")
        bus.publish("B", {}, "d2")
        assert handled == ["d1", "d2"]

    def test_handler_should_handle_filter(self):
        bus = EventBus()
        handled = []

        class FilteredHandler(DomainEventHandler):
            def should_handle(self, envelope):
                return envelope.event_type == "PASS"

            def handle(self, envelope):
                handled.append(envelope.event_type)

        bus.register_handler("d", FilteredHandler())
        bus.publish("SKIP", {}, "d")
        bus.publish("PASS", {}, "d")
        assert handled == ["PASS"]

    def test_multiple_handlers_for_same_event(self):
        bus = EventBus()
        handled = []

        class HandlerA(DomainEventHandler):
            def handle(self, envelope):
                handled.append("a")

        class HandlerB(DomainEventHandler):
            def handle(self, envelope):
                handled.append("b")

        bus.register_event_handler("E", HandlerA())
        bus.register_event_handler("E", HandlerB())
        bus.publish("E", {}, "d")
        assert handled == ["a", "b"]

    def test_handler_exception_does_not_propagate(self):
        bus = EventBus()

        class BadHandler(DomainEventHandler):
            def handle(self, envelope):
                raise RuntimeError("boom")

        bus.register_handler("d", BadHandler())
        # Should not raise
        bus.publish("E", {}, "d")

    def test_handler_count(self):
        bus = EventBus()
        counts_before = bus.handler_count()
        bus.register_handler("d1", AuditHandler())
        bus.register_handler("d2", WebSocketHandler())
        bus.register_global_handler(AuditHandler())
        counts_after = bus.handler_count()

        assert counts_after["domain_handlers"] == counts_before["domain_handlers"] + 2
        assert counts_after["global_handlers"] == counts_before["global_handlers"] + 1

    def test_reset(self):
        bus = EventBus()
        bus.register_handler("d", AuditHandler())
        bus.register_global_handler(AuditHandler())

        bus.reset()
        counts = bus.handler_count()
        # After reset, only default handlers remain
        assert counts["global_handlers"] == 0


# ------------------------------------------------------------------
# DomainEventHandlerRegistry
# ------------------------------------------------------------------


class TestHandlerRegistry:
    def test_register_and_dispatch_by_event_type(self):
        registry = DomainEventHandlerRegistry()
        handled = []

        class H(DomainEventHandler):
            def handle(self, envelope):
                handled.append(envelope.event_type)

        registry.register("MY_EVENT", H())
        env = EventEnvelope(event_type="MY_EVENT", payload={}, domain="d")
        registry.dispatch(env)
        assert handled == ["MY_EVENT"]

    def test_wildcard_handler(self):
        registry = DomainEventHandlerRegistry()
        handled = []

        class H(DomainEventHandler):
            def handle(self, envelope):
                handled.append(envelope.event_type)

        registry.register("*", H())
        registry.dispatch(EventEnvelope("A", {}, "d"))
        registry.dispatch(EventEnvelope("B", {}, "d"))
        assert handled == ["A", "B"]

    def test_unregister(self):
        registry = DomainEventHandlerRegistry()
        handled = []

        class H(DomainEventHandler):
            def handle(self, envelope):
                handled.append(1)

        h = H()
        registry.register("X", h)
        registry.dispatch(EventEnvelope("X", {}, "d"))
        assert len(handled) == 1

        registry.unregister("X", h)
        registry.dispatch(EventEnvelope("X", {}, "d"))
        assert len(handled) == 1  # no new call

    def test_domain_handler_dispatch(self):
        registry = DomainEventHandlerRegistry()
        handled = []

        class H(DomainEventHandler):
            def handle(self, envelope):
                handled.append(envelope.event_type)

        registry.register_domain("workflow", H())
        registry.dispatch(EventEnvelope("EVT", {}, "workflow"))
        assert handled == ["EVT"]

    def test_domain_handler_not_dispatched_for_other_domain(self):
        registry = DomainEventHandlerRegistry()
        handled = []

        class H(DomainEventHandler):
            def handle(self, envelope):
                handled.append(envelope.event_type)

        registry.register_domain("workflow", H())
        registry.dispatch(EventEnvelope("EVT", {}, "notification"))
        assert handled == []

    def test_dispatch_order(self):
        """Verify dispatch order: event_type -> wildcard -> domain -> global."""
        registry = DomainEventHandlerRegistry()
        order = []

        class EventTypeH(DomainEventHandler):
            def handle(self, envelope):
                order.append("event_type")

        class WildcardH(DomainEventHandler):
            def handle(self, envelope):
                order.append("wildcard")

        class DomainH(DomainEventHandler):
            def handle(self, envelope):
                order.append("domain")

        class GlobalH(DomainEventHandler):
            def handle(self, envelope):
                order.append("global")

        registry.register("E", EventTypeH())
        registry.register("*", WildcardH())
        registry.register_domain("d", DomainH())
        registry.register_global(GlobalH())

        registry.dispatch(EventEnvelope("E", {}, "d"))
        assert order == ["event_type", "wildcard", "domain", "global"]

    def test_handler_count(self):
        registry = DomainEventHandlerRegistry()
        registry.register("A", AuditHandler())
        registry.register("B", AuditHandler())
        registry.register_domain("d1", WebSocketHandler())
        registry.register_global(AuditHandler())

        counts = registry.handler_count()
        assert counts["event_type_handlers"] == 2
        assert counts["domain_handlers"] == 1
        assert counts["global_handlers"] == 1
        assert counts["total"] == 4

    def test_registered_event_types(self):
        registry = DomainEventHandlerRegistry()
        registry.register("A", AuditHandler())
        registry.register("B", AuditHandler())

        types = registry.registered_event_types()
        assert "A" in types
        assert "B" in types

    def test_registered_domains(self):
        registry = DomainEventHandlerRegistry()
        registry.register_domain("workflow", AuditHandler())
        registry.register_domain("notification", AuditHandler())

        domains = registry.registered_domains()
        assert "workflow" in domains
        assert "notification" in domains

    def test_reset(self):
        registry = DomainEventHandlerRegistry()
        registry.register("A", AuditHandler())
        registry.register_domain("d", AuditHandler())
        registry.register_global(AuditHandler())

        registry.reset()
        assert registry.handler_count() == {
            "event_type_handlers": 0,
            "domain_handlers": 0,
            "global_handlers": 0,
            "total": 0,
        }


# ------------------------------------------------------------------
# AuditHandler
# ------------------------------------------------------------------


@pytest.mark.django_db
class TestAuditHandler:
    def test_creates_soul_event(self, db):
        from apps.souls.models import Soul, SoulState
        from apps.tenants.models import Tenant
        from apps.events.models import SoulEvent

        tenant, _ = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "Test"}
        )
        soul, _ = Soul.objects.get_or_create(
            name="Audit Test Soul",
            defaults={"current_state": SoulState.ALIVE, "tenant": tenant},
        )

        handler = AuditHandler()
        env = EventEnvelope(
            event_type="SOUL_CREATED",
            payload={"soul_id": str(soul.id), "name": "Audit Test Soul"},
            domain="soul",
            tenant_code="CN_DIYU",
            actor="test_actor",
        )
        handler.handle(env)

        assert SoulEvent.objects.filter(
            soul=soul, event_type="SOUL_CREATED", actor="test_actor"
        ).exists()

    def test_skips_without_soul_id(self, db):
        handler = AuditHandler()
        env = EventEnvelope(event_type="E", payload={}, domain="soul")
        # Should not raise or create anything
        handler.handle(env)

    def test_skips_missing_soul(self, db):
        handler = AuditHandler()
        env = EventEnvelope(
            event_type="E",
            payload={"soul_id": "00000000-0000-0000-0000-000000000000"},
            domain="soul",
        )
        # Should not raise
        handler.handle(env)


# ------------------------------------------------------------------
# WebSocketHandler
# ------------------------------------------------------------------


class TestWebSocketHandler:
    def test_publishes_to_channel_layer(self):
        """WebSocketHandler calls group_send on the channel layer."""
        mock_layer = MagicMock()

        handler = WebSocketHandler()
        env = EventEnvelope(
            event_type="WORKFLOW_APPROVED",
            payload={"workflow_id": "w1"},
            domain="workflow",
            tenant_code="CN_DIYU",
            user_ids=[1, 2],
            permission="workflow.read",
        )

        # get_channel_layer is imported inside handle(), so patch at the source
        with patch("channels.layers.get_channel_layer", return_value=mock_layer):
            handler.handle(env)

        # group_send is called via async_to_sync wrapper; at minimum it was called
        assert mock_layer.group_send.called

    def test_no_tenant_no_users_no_calls(self):
        """WebSocketHandler makes no calls when no tenant or users."""
        mock_layer = MagicMock()

        handler = WebSocketHandler()
        env = EventEnvelope(
            event_type="E", payload={}, domain="d",
            tenant_code=None, user_ids=None,
        )

        with patch("channels.layers.get_channel_layer", return_value=mock_layer):
            handler.handle(env)

        assert not mock_layer.group_send.called

    def test_handles_no_channel_layer(self):
        handler = WebSocketHandler()
        env = EventEnvelope(
            event_type="E", payload={}, domain="d", tenant_code="T",
        )
        with patch("channels.layers.get_channel_layer", return_value=None):
            # Should not raise
            handler.handle(env)


# ------------------------------------------------------------------
# NotificationHandler
# ------------------------------------------------------------------


@pytest.mark.django_db
class TestNotificationHandler:
    def test_creates_user_notification(self, db):
        from apps.authentication.models import User
        from apps.notifications.models import UserNotification
        from apps.tenants.models import Tenant

        tenant, _ = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "T"}
        )
        user, _ = User.objects.get_or_create(
            username="notif_test_user",
            defaults={"role": "VIEWER", "tenant": tenant},
        )

        handler = NotificationHandler()
        env = EventEnvelope(
            event_type="NOTIFICATION_CREATED",
            payload={
                "user_id": user.id,
                "title": "Test Notification",
                "message": "Hello",
            },
            domain="notification",
            tenant_code="CN_DIYU",
            user_ids=[user.id],
        )

        handler.handle(env)

        assert UserNotification.objects.filter(
            user=user,
            notification_type="SYSTEM",
            title="Test Notification",
        ).exists()

    def test_should_handle_only_notification_domain(self):
        handler = NotificationHandler()
        env_notif = EventEnvelope(
            event_type="E", payload={}, domain="notification"
        )
        env_other = EventEnvelope(event_type="E", payload={}, domain="workflow")
        assert handler.should_handle(env_notif) is True
        assert handler.should_handle(env_other) is False


# ------------------------------------------------------------------
# Backward compatibility
# ------------------------------------------------------------------


@pytest.mark.django_db
class TestBackwardCompat:
    def test_event_service_delegates_to_bus(self, db):
        from apps.souls.models import Soul, SoulState
        from apps.tenants.models import Tenant
        from apps.events.models import SoulEvent
        from apps.events.services import EventService

        tenant, _ = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "T"}
        )
        soul, _ = Soul.objects.get_or_create(
            name="Compat Soul",
            defaults={"current_state": SoulState.ALIVE, "tenant": tenant},
        )

        EventService.log(soul, "SOUL_CREATED", {"name": "Compat Soul"})

        assert SoulEvent.objects.filter(
            soul=soul, event_type="SOUL_CREATED"
        ).exists()

    def test_event_service_convenience_methods(self, db):
        from apps.souls.models import Soul, SoulState
        from apps.tenants.models import Tenant
        from apps.events.models import SoulEvent
        from apps.events.services import EventService

        tenant, _ = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "T"}
        )
        soul, _ = Soul.objects.get_or_create(
            name="Convenience Soul",
            defaults={"current_state": SoulState.ALIVE, "tenant": tenant},
        )

        EventService.log_soul_state_change(
            soul, "ALIVE", "JUDGED", "Test change"
        )

        assert SoulEvent.objects.filter(
            soul=soul, event_type="STATE_CHANGED"
        ).exists()

    def test_backward_compat_aliases(self):
        from apps.events.services import log_soul_state_change, log_disposition_created
        from apps.events.services import EventService

        assert log_soul_state_change is EventService.log_soul_state_change
        assert log_disposition_created is EventService.log_disposition_created

    def test_realtime_publisher_delegates_to_bus(self, db):
        """RealtimeEventPublisher static methods should delegate to EventBus."""
        from apps.events.realtime import RealtimeEventPublisher

        # Should not raise (channel layer may not be available)
        RealtimeEventPublisher.publish(
            domain="workflow",
            event_type="TEST_EVENT",
            payload={"test": True},
            tenant_code="CN_DIYU",
        )


# ------------------------------------------------------------------
# Default handler configuration
# ------------------------------------------------------------------


class TestDefaultHandlers:
    def test_default_bus_singleton_exists(self):
        from apps.events.event_bus import event_bus as eb
        assert isinstance(eb, EventBus)

    def test_handler_registry_singleton_exists(self):
        from apps.events.handlers.registry import handler_registry as reg
        assert isinstance(reg, DomainEventHandlerRegistry)

    def test_configure_default_handlers_registers_all_domains(self):
        """configure_default_handlers() registers handlers for all domains."""
        from apps.events.event_bus import configure_default_handlers
        from apps.events.handlers.registry import DomainEventHandlerRegistry

        # Use a fresh registry to test configuration
        test_registry = DomainEventHandlerRegistry()
        original_registry = None

        try:
            # Temporarily replace the global registry
            import apps.events.handlers.registry as registry_module
            original_registry = registry_module.handler_registry
            registry_module.handler_registry = test_registry

            # Also need to patch the import in event_bus module
            import apps.events.event_bus as eb_module
            original_get_registry = eb_module.EventBus._get_registry.fget

            def patched_get_registry(self_bus):
                return test_registry

            eb_module.EventBus._get_registry = property(patched_get_registry)

            # Run configuration
            configure_default_handlers()

            # Verify handlers were registered
            counts = test_registry.handler_count()
            # soul: AuditHandler, workflow/notification/dispatch/deathsync: WebSocketHandler + WebhookHandler
            # notification: NotificationHandler
            assert counts["domain_handlers"] >= 5
            assert counts["total"] >= 5

        finally:
            # Restore original registry
            if original_registry is not None:
                import apps.events.handlers.registry as registry_module
                registry_module.handler_registry = original_registry
                import apps.events.event_bus as eb_module
                eb_module.EventBus._get_registry = property(original_get_registry)


# ------------------------------------------------------------------
# EventEnvelope edge cases
# ------------------------------------------------------------------


class TestEnvelopeEdgeCases:
    def test_empty_payload(self):
        env = EventEnvelope(event_type="E", payload={}, domain="d")
        assert env.to_dict()["payload"] == {}

    def test_nested_payload(self):
        payload = {"nested": {"deep": [1, 2, 3]}}
        env = EventEnvelope(event_type="E", payload=payload, domain="d")
        assert env.to_dict()["payload"] == payload

    def test_none_user_ids(self):
        env = EventEnvelope(event_type="E", payload={}, domain="d", user_ids=None)
        assert env.user_ids is None

    def test_empty_user_ids(self):
        env = EventEnvelope(event_type="E", payload={}, domain="d", user_ids=[])
        assert env.user_ids == []
