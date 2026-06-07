"""
Integration tests for EventBus — end-to-end publish → handler dispatch.

Tests:
  - EventBus publish → handler dispatch
  - Handler registration (event type, domain, global)
  - Domain-specific handlers (AuditHandler, WebSocketHandler, etc.)
  - EventService workflow methods → EventBus → AuditHandler
  - ChannelNaming conventions
"""
import pytest
from channels.db import database_sync_to_async

# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------


@pytest.fixture
def cn_tenant(db):
    from apps.tenants.models import Tenant
    tenant, _ = Tenant.objects.get_or_create(
        code="CN_DIYU",
        defaults={"display_name": "Chinese Diyu"},
    )
    return tenant


@pytest.fixture
def soul(db, cn_tenant):
    from apps.souls.models import Soul, SoulState
    soul, _ = Soul.objects.get_or_create(
        name="Integration Test Soul",
        defaults={"current_state": SoulState.ALIVE, "tenant": cn_tenant},
    )
    return soul


@pytest.fixture
def clean_event_bus():
    """Reset the EventBus registry before and after each test."""
    from apps.events.handlers.registry import handler_registry
    handler_registry.reset()
    yield handler_registry
    handler_registry.reset()


# ------------------------------------------------------------------
# EventBus Core Tests
# ------------------------------------------------------------------


@pytest.mark.django_db
class TestEventBusPublish:
    """Test EventBus publish → handler dispatch."""

    def test_publish_creates_envelope(self):
        """publish() constructs an EventEnvelope and dispatches."""
        from apps.events.event_bus import EventBus

        received = []

        class TestHandler:
            def handle(self, envelope):
                received.append(envelope)
            def should_handle(self, envelope):
                return True

        bus = EventBus()
        bus.register_handler("test", TestHandler())

        bus.publish(
            event_type="TEST_EVENT",
            payload={"key": "value"},
            domain="test",
            tenant_code="CN_DIYU",
        )

        assert len(received) == 1
        assert received[0].event_type == "TEST_EVENT"
        assert received[0].payload["key"] == "value"
        assert received[0].domain == "test"
        assert received[0].tenant_code == "CN_DIYU"

    def test_publish_with_user_ids(self):
        """publish() passes user_ids to envelope."""
        from apps.events.event_bus import EventBus

        received = []

        class TestHandler:
            def handle(self, envelope):
                received.append(envelope)
            def should_handle(self, envelope):
                return True

        bus = EventBus()
        bus.register_handler("workflow", TestHandler())

        bus.publish(
            event_type="WORKFLOW_ASSIGNED",
            payload={"workflow_id": "wf-123"},
            domain="workflow",
            user_ids=[1, 2, 3],
        )

        assert received[0].user_ids == [1, 2, 3]

    def test_publish_with_permission_gate(self):
        """publish() passes permission to envelope."""
        from apps.events.event_bus import EventBus

        received = []

        class TestHandler:
            def handle(self, envelope):
                received.append(envelope)
            def should_handle(self, envelope):
                return True

        bus = EventBus()
        bus.register_handler("workflow", TestHandler())

        bus.publish(
            event_type="WORKFLOW_APPROVED",
            payload={},
            domain="workflow",
            permission="workflow.read",
        )

        assert received[0].permission == "workflow.read"


# ------------------------------------------------------------------
# Handler Registration Tests
# ------------------------------------------------------------------


@pytest.mark.django_db
class TestHandlerRegistration:
    """Test handler registration and dispatch order."""

    def test_domain_handler_receives_events(self):
        """Domain handler receives all events in its domain."""
        from apps.events.event_bus import EventBus

        received = []

        class DomainHandler:
            def handle(self, envelope):
                received.append(envelope.domain)
            def should_handle(self, envelope):
                return True

        bus = EventBus()
        bus.register_handler("workflow", DomainHandler())

        bus.publish("EVENT_A", {}, domain="workflow")
        bus.publish("EVENT_B", {}, domain="workflow")
        bus.publish("EVENT_C", {}, domain="notification")

        assert received == ["workflow", "workflow"]

    def test_event_type_handler_receives_specific_events(self):
        """Event type handler receives only its registered event type."""
        from apps.events.event_bus import EventBus

        received = []

        class SpecificHandler:
            def handle(self, envelope):
                received.append(envelope.event_type)
            def should_handle(self, envelope):
                return True

        bus = EventBus()
        bus.register_event_handler("WORKFLOW_APPROVED", SpecificHandler())

        bus.publish("WORKFLOW_APPROVED", {}, domain="workflow")
        bus.publish("WORKFLOW_REJECTED", {}, domain="workflow")

        assert received == ["WORKFLOW_APPROVED"]

    def test_global_handler_receives_all_events(self):
        """Global handler receives every event regardless of domain."""
        from apps.events.event_bus import EventBus

        received = []

        class GlobalHandler:
            def handle(self, envelope):
                received.append(f"{envelope.domain}.{envelope.event_type}")
            def should_handle(self, envelope):
                return True

        bus = EventBus()
        bus.register_global_handler(GlobalHandler())

        bus.publish("EVENT_A", {}, domain="workflow")
        bus.publish("EVENT_B", {}, domain="notification")
        bus.publish("EVENT_C", {}, domain="dispatch")

        assert len(received) == 3
        assert "workflow.EVENT_A" in received
        assert "notification.EVENT_B" in received
        assert "dispatch.EVENT_C" in received

    def test_should_handle_filters_events(self):
        """should_handle() can filter out events."""
        from apps.events.event_bus import EventBus

        received = []

        class FilteringHandler:
            def handle(self, envelope):
                received.append(envelope.event_type)
            def should_handle(self, envelope):
                return envelope.event_type == "ONLY_ME"

        bus = EventBus()
        bus.register_handler("workflow", FilteringHandler())

        bus.publish("ONLY_ME", {}, domain="workflow")
        bus.publish("NOT_ME", {}, domain="workflow")

        assert received == ["ONLY_ME"]

    def test_handler_exception_does_not_propagate(self):
        """Exception in handler is logged and swallowed."""
        from apps.events.event_bus import EventBus

        class BrokenHandler:
            def handle(self, envelope):
                raise RuntimeError("handler broke")
            def should_handle(self, envelope):
                return True

        bus = EventBus()
        bus.register_handler("workflow", BrokenHandler())

        # Should not raise
        bus.publish("TEST", {}, domain="workflow")

    def test_handler_count(self):
        """handler_count() returns correct counts on a fresh registry."""
        from apps.events.handlers.registry import DomainEventHandlerRegistry

        # Use a fresh registry to avoid side effects on the global one
        fresh_registry = DomainEventHandlerRegistry()

        class DummyHandler:
            def handle(self, envelope):
                pass
            def should_handle(self, envelope):
                return True

        fresh_registry.register_domain("workflow", DummyHandler())
        fresh_registry.register_domain("notification", DummyHandler())
        fresh_registry.register("SPECIFIC_EVENT", DummyHandler())

        counts = fresh_registry.handler_count()
        assert counts["domain_handlers"] == 2
        assert counts["event_type_handlers"] == 1
        assert counts["total"] == 3


# ------------------------------------------------------------------
# AuditHandler Integration Tests
# ------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
class TestAuditHandlerIntegration:
    """Test AuditHandler writes SoulEvent records via EventBus."""

    @pytest.mark.asyncio
    async def test_soul_event_creates_audit_log(self, soul, cn_tenant):
        """publish_soul_event() → AuditHandler → SoulEvent record."""
        from apps.events.event_bus import event_bus
        from apps.events.models import SoulEvent

        count_before = await database_sync_to_async(
            lambda: SoulEvent.objects.filter(soul=soul).count()
        )()

        await database_sync_to_async(event_bus.publish_soul_event)(
            soul, "SOUL_CREATED", {"name": soul.name}, actor="test"
        )

        count_after = await database_sync_to_async(
            lambda: SoulEvent.objects.filter(soul=soul).count()
        )()
        assert count_after == count_before + 1

        event = await database_sync_to_async(
            lambda: SoulEvent.objects.filter(soul=soul).order_by("-create_time").first()
        )()
        assert event.event_type == "SOUL_CREATED"
        assert event.actor == "test"
        assert event.payload["name"] == soul.name

    @pytest.mark.asyncio
    async def test_workflow_event_creates_audit_log(self, soul, cn_tenant):
        """publish_workflow() → AuditHandler → SoulEvent record."""
        from apps.events.event_bus import event_bus
        from apps.events.models import EventType, SoulEvent
        from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus

        workflow = await database_sync_to_async(ApprovalWorkflow.objects.create)(
            soul=soul,
            workflow_name="Integration Test WF",
            status=ApprovalWorkflowStatus.PENDING,
            tenant=cn_tenant,
        )

        await database_sync_to_async(event_bus.publish_workflow)(
            event_type="WORKFLOW_CREATED",
            payload={
                "soul_id": str(soul.id),
                "workflow_id": str(workflow.id),
                "workflow_name": workflow.workflow_name,
            },
            tenant_code=cn_tenant.code,
        )

        event_exists = await database_sync_to_async(
            lambda: SoulEvent.objects.filter(
                soul=soul,
                event_type=EventType.WORKFLOW_CREATED,
            ).exists()
        )()
        assert event_exists


# ------------------------------------------------------------------
# EventService Workflow Integration Tests
# ------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
class TestEventServiceWorkflowIntegration:
    """Test EventService workflow methods integrate with EventBus."""

    @pytest.mark.asyncio
    async def test_log_workflow_created(self, soul, cn_tenant):
        """EventService.log_workflow_created() creates audit + publishes."""
        from apps.events.models import EventType, SoulEvent
        from apps.events.services import EventService
        from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus

        workflow = await database_sync_to_async(ApprovalWorkflow.objects.create)(
            soul=soul,
            workflow_name="Service Test WF",
            status=ApprovalWorkflowStatus.PENDING,
            tenant=cn_tenant,
        )

        await database_sync_to_async(EventService.log_workflow_created)(
            workflow, actor="service_test"
        )

        event = await database_sync_to_async(
            lambda: SoulEvent.objects.filter(
                soul=soul,
                event_type=EventType.WORKFLOW_CREATED,
            ).first()
        )()
        assert event is not None
        assert event.payload["workflow_id"] == str(workflow.id)
        assert event.payload["workflow_name"] == "Service Test WF"
        assert event.actor == "service_test"

    @pytest.mark.asyncio
    async def test_log_workflow_approved(self, soul, cn_tenant):
        """EventService.log_workflow_approved() creates audit entry."""
        from apps.events.models import EventType, SoulEvent
        from apps.events.services import EventService
        from apps.workflow.models import (
            ApprovalNode,
            ApprovalWorkflow,
            ApprovalWorkflowStatus,
            NodeStatus,
            NodeType,
        )

        workflow = await database_sync_to_async(ApprovalWorkflow.objects.create)(
            soul=soul,
            workflow_name="Approval Test WF",
            status=ApprovalWorkflowStatus.IN_PROGRESS,
            tenant=cn_tenant,
        )
        node = await database_sync_to_async(ApprovalNode.objects.create)(
            workflow=workflow,
            node_name="Test Node",
            node_order=1,
            node_type=NodeType.TRIAL,
            status=NodeStatus.APPROVED,
            verdict="PASSED",
        )

        await database_sync_to_async(EventService.log_workflow_approved)(
            workflow, node=node, actor="judge_test"
        )

        event = await database_sync_to_async(
            lambda: SoulEvent.objects.filter(
                soul=soul,
                event_type=EventType.WORKFLOW_APPROVED,
            ).first()
        )()
        assert event is not None
        assert event.payload["verdict"] == "PASSED"
        assert event.payload["node_name"] == "Test Node"

    @pytest.mark.asyncio
    async def test_log_workflow_rejected(self, soul, cn_tenant):
        """EventService.log_workflow_rejected() creates audit entry."""
        from apps.events.models import EventType, SoulEvent
        from apps.events.services import EventService
        from apps.workflow.models import (
            ApprovalNode,
            ApprovalWorkflow,
            ApprovalWorkflowStatus,
            NodeStatus,
            NodeType,
        )

        workflow = await database_sync_to_async(ApprovalWorkflow.objects.create)(
            soul=soul,
            workflow_name="Rejection Test WF",
            status=ApprovalWorkflowStatus.IN_PROGRESS,
            tenant=cn_tenant,
        )
        node = await database_sync_to_async(ApprovalNode.objects.create)(
            workflow=workflow,
            node_name="Rejection Node",
            node_order=1,
            node_type=NodeType.TRIAL,
            status=NodeStatus.REJECTED,
            verdict="FAILED",
            notes="Insufficient evidence for soul judgment",
        )

        await database_sync_to_async(EventService.log_workflow_rejected)(
            workflow, node=node, actor="judge_reject"
        )

        event = await database_sync_to_async(
            lambda: SoulEvent.objects.filter(
                soul=soul,
                event_type=EventType.WORKFLOW_REJECTED,
            ).first()
        )()
        assert event is not None
        assert event.payload["verdict"] == "FAILED"
        assert event.payload["reason"] == "Insufficient evidence for soul judgment"


# ------------------------------------------------------------------
# ChannelNaming Tests
# ------------------------------------------------------------------


@pytest.mark.django_db
class TestChannelNamingIntegration:
    """Test ChannelNaming conventions are consistent."""

    def test_tenant_group_consistent(self):
        from apps.events.realtime import ChannelNaming

        # ChannelNaming and WebSocketHandler use the same convention
        group = ChannelNaming.tenant_group("CN_DIYU")
        assert group == "rt_tenant_CN_DIYU"
        assert group.startswith("rt_tenant_")

    def test_user_group_consistent(self):
        from apps.events.realtime import ChannelNaming

        group = ChannelNaming.user_group(42)
        assert group == "rt_user_42"
        assert group.startswith("rt_user_")


# ------------------------------------------------------------------
# EventEnvelope Tests
# ------------------------------------------------------------------


@pytest.mark.django_db
class TestEventEnvelope:
    """Test EventEnvelope construction and serialization."""

    def test_envelope_to_dict(self):
        from apps.events.event_bus import EventEnvelope

        envelope = EventEnvelope(
            event_type="WORKFLOW_APPROVED",
            payload={"workflow_id": "wf-123"},
            domain="workflow",
            tenant_code="CN_DIYU",
            user_ids=[1, 2],
            permission="workflow.read",
            actor="judge_001",
        )

        d = envelope.to_dict()
        assert d["event_type"] == "WORKFLOW_APPROVED"
        assert d["domain"] == "workflow"
        assert d["tenant_code"] == "CN_DIYU"
        assert d["user_ids"] == [1, 2]
        assert d["permission"] == "workflow.read"
        assert d["actor"] == "judge_001"
        assert d["payload"]["workflow_id"] == "wf-123"

    def test_envelope_defaults(self):
        from apps.events.event_bus import EventEnvelope

        envelope = EventEnvelope(
            event_type="TEST",
            payload={},
            domain="test",
        )

        assert envelope.tenant_code is None
        assert envelope.user_ids is None
        assert envelope.permission is None
        assert envelope.actor == "system"
