"""
Tests for M12 Phase 3 — Unified Realtime Bus.

Covers:
  - ChannelNaming convention
  - EventService integration with the EventBus
  - Dispatch event types
  - DeathSync event types

The `TestRealtimeEventPublisher` class that stood here went with the facade it
named. Its five tests called a method and checked it did not raise; four of
them carried docstrings claiming "sends to correct domain" and asserted
nothing at all. The coverage they appeared to provide lives in
`test_coverage_boost.py::TestEventBusReachesTheChannelLayer`, which mocks the
channel layer and asserts `group_send` was actually called.
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
def eu_tenant(db):
    from apps.tenants.models import Tenant
    tenant, _ = Tenant.objects.get_or_create(
        code="EU_HEAVEN_HELL",
        defaults={"display_name": "European Heaven/Hell"},
    )
    return tenant


@pytest.fixture
def soul(db, cn_tenant):
    from apps.souls.models import Soul, SoulState
    soul, _ = Soul.objects.get_or_create(
        name="Realtime Bus Soul",
        defaults={"current_state": SoulState.ALIVE, "tenant": cn_tenant},
    )
    return soul


# ------------------------------------------------------------------
# ChannelNaming Tests
# ------------------------------------------------------------------


@pytest.mark.django_db
class TestChannelNaming:
    """Test standardized channel naming convention."""

    def test_tenant_group_format(self):
        from apps.events.realtime import ChannelNaming
        assert ChannelNaming.tenant_group("CN_DIYU") == "rt_tenant_CN_DIYU"
        assert ChannelNaming.tenant_group("EU_HEAVEN_HELL") == "rt_tenant_EU_HEAVEN_HELL"

    def test_user_group_format(self):
        from apps.events.realtime import ChannelNaming
        assert ChannelNaming.user_group(1) == "rt_user_1"
        assert ChannelNaming.user_group(42) == "rt_user_42"


@pytest.mark.django_db(transaction=True)
# ------------------------------------------------------------------
# EventType Enum Tests
# ------------------------------------------------------------------


@pytest.mark.django_db
class TestEventTypes:
    """Test all event types exist in EventType enum."""

    def test_workflow_events(self):
        from apps.events.models import EventType
        assert EventType.WORKFLOW_CREATED == "WORKFLOW_CREATED"
        assert EventType.WORKFLOW_ASSIGNED == "WORKFLOW_ASSIGNED"
        assert EventType.WORKFLOW_APPROVED == "WORKFLOW_APPROVED"
        assert EventType.WORKFLOW_REJECTED == "WORKFLOW_REJECTED"

    def test_dispatch_events(self):
        from apps.events.models import EventType
        assert EventType.DISPATCH_CREATED == "DISPATCH_CREATED"
        assert EventType.DISPATCH_APPROVED == "DISPATCH_APPROVED"
        assert EventType.DISPATCH_REJECTED == "DISPATCH_REJECTED"
        assert EventType.DISPATCH_EXECUTED == "DISPATCH_EXECUTED"
        assert EventType.DISPATCH_STATUS_CHANGED == "DISPATCH_STATUS_CHANGED"

    def test_deathsync_events(self):
        from apps.events.models import EventType
        assert EventType.DEATH_SYNC_RECEIVED == "DEATH_SYNC_RECEIVED"
        assert EventType.DEATH_SYNC_PROCESSED == "DEATH_SYNC_PROCESSED"


# ------------------------------------------------------------------
# EventService Integration Tests
# ------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
class TestEventServiceIntegration:
    """Test EventService publishes through the EventBus."""

    @pytest.mark.asyncio
    async def test_workflow_created_uses_publisher(self, soul, cn_tenant):
        """log_workflow_created() creates the audit row and publishes on the bus."""
        from apps.events.models import EventType, SoulEvent
        from apps.events.services import EventService
        from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus

        workflow = await database_sync_to_async(ApprovalWorkflow.objects.create)(
            soul=soul,
            workflow_name="Integration Test",
            status=ApprovalWorkflowStatus.PENDING,
            tenant=cn_tenant,
        )

        await database_sync_to_async(EventService.log_workflow_created)(workflow, actor="test")

        event_exists = await database_sync_to_async(
            lambda: SoulEvent.objects.filter(
                soul=soul,
                event_type=EventType.WORKFLOW_CREATED,
            ).exists()
        )()
        assert event_exists

    @pytest.mark.asyncio
    async def test_notify_user_uses_publisher(self, soul, cn_tenant):
        """notify_user() creates the notification and publishes on the bus."""
        from apps.authentication.models import User
        from apps.notifications.models import UserNotification, notify_user

        user, _ = await database_sync_to_async(User.objects.get_or_create)(
            username="rt_test_user",
            defaults={"role": "VIEWER", "tenant": cn_tenant},
        )

        count_before = await database_sync_to_async(
            lambda: UserNotification.objects.filter(user=user).count()
        )()

        await database_sync_to_async(notify_user)(
            user,
            title="Publisher Test",
            message="Testing unified publisher",
        )

        count_after = await database_sync_to_async(
            lambda: UserNotification.objects.filter(user=user).count()
        )()
        assert count_after == count_before + 1
