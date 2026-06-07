"""
Tests for M12 Phase 1 — Notification Realtime.

Covers:
  - Tenant group join/leave
  - Auto-push on notification creation
  - Cross-user isolation
"""
import pytest
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from rest_framework_simplejwt.tokens import RefreshToken

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------


def _make_token_sync(user, tenant_code=None):
    refresh = RefreshToken.for_user(user)
    if tenant_code:
        refresh["tenant_code"] = tenant_code
    return str(refresh.access_token)


_make_token = database_sync_to_async(_make_token_sync)


def _get_ws_app():
    from config.asgi import application
    return application


async def _connect_user(user, tenant_code=None):
    token = await _make_token(user, tenant_code)
    app = _get_ws_app()
    return WebsocketCommunicator(app, f"/ws/notifications/?token={token}")


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
def admin_user(db, django_user_model, cn_tenant):
    user, _ = django_user_model.objects.get_or_create(
        username="m12_admin",
        defaults={"role": "ADMIN", "tenant": cn_tenant},
    )
    user.set_password("test123")
    user.save()
    return user


@pytest.fixture
def eu_admin_user(db, django_user_model, eu_tenant):
    user, _ = django_user_model.objects.get_or_create(
        username="m12_eu_admin",
        defaults={"role": "ADMIN", "tenant": eu_tenant},
    )
    user.set_password("test123")
    user.save()
    return user


# ------------------------------------------------------------------
# Tenant Group Tests
# ------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
class TestTenantGroup:
    """Test tenant group join/leave."""

    @pytest.mark.asyncio
    async def test_user_joins_tenant_group(self, admin_user, cn_tenant):
        """User connects → joins both user and tenant groups."""
        communicator = await _connect_user(admin_user, cn_tenant.code)
        connected, _ = await communicator.connect()
        assert connected

        response = await communicator.receive_json_from()
        assert response["type"] == "connected"
        assert response["tenant_code"] == "CN_DIYU"

        await communicator.disconnect()

    @pytest.mark.asyncio
    async def test_tenant_broadcast_reaches_user(self, admin_user, cn_tenant):
        """Message sent to tenant group → user receives it."""
        communicator = await _connect_user(admin_user, cn_tenant.code)
        connected, _ = await communicator.connect()
        assert connected
        await communicator.receive_json_from()  # connected message

        # Send to tenant group via channel layer
        channel_layer = get_channel_layer()
        await channel_layer.group_send(
            f"rt_tenant_{cn_tenant.code}",
            {
                "type": "realtime_event",
                "data": {"type": "notification", "title": "Tenant broadcast"},
            },
        )

        response = await communicator.receive_json_from()
        assert response["type"] == "notification"
        assert response["title"] == "Tenant broadcast"

        await communicator.disconnect()

    @pytest.mark.asyncio
    async def test_cross_tenant_isolation(self, admin_user, eu_admin_user, cn_tenant, eu_tenant):
        """CN tenant broadcast does NOT reach EU user."""
        cn_comm = await _connect_user(admin_user, cn_tenant.code)
        eu_comm = await _connect_user(eu_admin_user, eu_tenant.code)

        cn_c, _ = await cn_comm.connect()
        eu_c, _ = await eu_comm.connect()
        assert cn_c and eu_c

        await cn_comm.receive_json_from()  # connected
        await eu_comm.receive_json_from()  # connected

        # Send to CN tenant group
        channel_layer = get_channel_layer()
        await channel_layer.group_send(
            f"rt_tenant_{cn_tenant.code}",
            {
                "type": "realtime_event",
                "data": {"type": "notification", "title": "CN only"},
            },
        )

        # CN user should receive it
        cn_resp = await cn_comm.receive_json_from()
        assert cn_resp["title"] == "CN only"

        # EU user should NOT receive it — send a heartbeat to verify connection is alive
        await eu_comm.send_json_to({"type": "heartbeat"})
        eu_resp = await eu_comm.receive_json_from()
        assert eu_resp["type"] == "pong"

        await cn_comm.disconnect()
        await eu_comm.disconnect()


# ------------------------------------------------------------------
# Auto-Push Tests
# ------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
class TestAutoPush:
    """Test notify_user auto-pushes via WebSocket."""

    @pytest.mark.asyncio
    async def test_notify_user_pushes_to_ws(self, admin_user, cn_tenant):
        """notify_user() creates notification AND pushes via WebSocket."""
        communicator = await _connect_user(admin_user, cn_tenant.code)
        connected, _ = await communicator.connect()
        assert connected
        await communicator.receive_json_from()  # connected

        # Create notification via notify_user
        from apps.notifications.models import notify_user
        await database_sync_to_async(notify_user)(
            admin_user,
            title="Test Push",
            message="Hello via WebSocket",
            notification_type="SYSTEM",
        )

        # Should receive WebSocket push (unified format)
        response = await communicator.receive_json_from()
        assert response["domain"] == "notification"
        assert response["event"] == "NOTIFICATION_CREATED"
        assert response["notification"]["title"] == "Test Push"
        assert response["notification"]["message"] == "Hello via WebSocket"

        await communicator.disconnect()

    @pytest.mark.asyncio
    async def test_notify_user_creates_db_record(self, admin_user, cn_tenant):
        """notify_user() creates DB record even if WS push fails."""
        from apps.notifications.models import UserNotification, notify_user

        count_before = await database_sync_to_async(
            lambda: UserNotification.objects.filter(user=admin_user).count()
        )()

        await database_sync_to_async(notify_user)(
            admin_user,
            title="DB Test",
            message="Should exist in DB",
        )

        count_after = await database_sync_to_async(
            lambda: UserNotification.objects.filter(user=admin_user).count()
        )()
        assert count_after == count_before + 1
