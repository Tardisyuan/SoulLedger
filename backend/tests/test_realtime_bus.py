"""
Tests for M12 Phase 3 — Unified Realtime Bus.

Covers:
  - RealtimeEventPublisher unified publishing
  - ChannelNaming convention
  - EventService integration with RealtimeEventPublisher
  - Dispatch event types
  - DeathSync event types
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


# ------------------------------------------------------------------
# RealtimeEventPublisher Tests
# ------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
class TestRealtimeEventPublisher:
    """Test unified RealtimeEventPublisher."""

    @pytest.mark.asyncio
    async def test_publish_does_not_raise(self, cn_tenant):
        """publish() should not raise even if channel layer is unavailable."""
        from apps.events.realtime import RealtimeEventPublisher

        # Should not raise
        await database_sync_to_async(RealtimeEventPublisher.publish)(
            domain="workflow",
            event_type="WORKFLOW_CREATED",
            payload={"test": True},
            tenant_code=cn_tenant.code,
        )

    @pytest.mark.asyncio
    async def test_publish_workflow(self, cn_tenant):
        """publish_workflow() sends to correct domain."""
        from apps.events.realtime import RealtimeEventPublisher

        await database_sync_to_async(RealtimeEventPublisher.publish_workflow)(
            "WORKFLOW_APPROVED",
            {"workflow_id": "test-123"},
            tenant_code=cn_tenant.code,
        )

    @pytest.mark.asyncio
    async def test_publish_dispatch(self, cn_tenant):
        """publish_dispatch() sends to correct domain."""
        from apps.events.realtime import RealtimeEventPublisher

        await database_sync_to_async(RealtimeEventPublisher.publish_dispatch)(
            "DISPATCH_CREATED",
            {"dispatch_id": "test-456"},
            tenant_code=cn_tenant.code,
        )

    @pytest.mark.asyncio
    async def test_publish_deathsync(self, cn_tenant):
        """publish_deathsync() sends to correct domain."""
        from apps.events.realtime import RealtimeEventPublisher

        await database_sync_to_async(RealtimeEventPublisher.publish_deathsync)(
            "DEATH_SYNC_RECEIVED",
            {"registration_id": "test-789"},
            tenant_code=cn_tenant.code,
        )

    @pytest.mark.asyncio
    async def test_publish_notification(self, cn_tenant):
        """publish_notification() sends to specific user."""
        from apps.events.realtime import RealtimeEventPublisher

        await database_sync_to_async(RealtimeEventPublisher.publish_notification)(
            user_id=1,
            notification_data={"title": "Test", "message": "Hello"},
            tenant_code=cn_tenant.code,
        )


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
    """Test EventService uses RealtimeEventPublisher."""

    @pytest.mark.asyncio
    async def test_workflow_created_uses_publisher(self, soul, cn_tenant):
        """log_workflow_created() creates audit + publishes via RealtimeEventPublisher."""
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
        """notify_user() creates notification + publishes via RealtimeEventPublisher."""
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
