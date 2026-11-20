"""Stage 3: a websocket of a caller with no hall reads the way its HTTP requests do (apps/core/ws_tenant.py).

The socket stack (JWT -> TenantMiddleware -> consumer) sets the tenant contextvar for a hall-bound user; a
SYSTEM_ADMIN or soul-account socket has no hall, and with a civilization cut over every SHARD read in its
consumer raised NoShardContext. The middleware now opens the same read context HTTP gives that user: every
leg (FANOUT) for SYSTEM_ADMIN and a soul with no hall, its soul's primary shard for a soul with one. Driven here with an inner app that reads a SHARD model the way a consumer does
(database_sync_to_async).

Mutation (2026-11-16): drop the `read_context(...)` in TenantMiddleware -> both cases raise NoShardContext.
"""
import pytest
from channels.db import database_sync_to_async
from django.test import override_settings

from apps.authentication.models import User, UserRole
from apps.core.shard_reads import FANOUT, current_context
from apps.core.ws_tenant import TenantMiddleware
from tests.test_shard_sync import HAS_SHARDS


def _inner(seen):
    async def app(scope, receive, send):
        from apps.souls.models import Soul

        seen["context"] = current_context()
        seen["souls"] = await database_sync_to_async(Soul.objects.count)()
    return app


@pytest.mark.sharded
@pytest.mark.skipif(not HAS_SHARDS, reason="needs --ds=config.settings_sharded")
@pytest.mark.django_db(transaction=True, databases="__all__")  # the consumer's reads run on another thread
@pytest.mark.parametrize("role", [UserRole.SYSTEM_ADMIN, UserRole.SOUL])
async def test_a_hall_less_socket_reads_every_shard(role):
    user = await database_sync_to_async(User.objects.create_user)(
        username=f"ws-{role.lower()}", password="x", role=role, tenant=None)
    seen = {}
    with override_settings(SHARDED=True):
        await TenantMiddleware(_inner(seen))({"type": "websocket", "user": user}, None, None)
    assert seen["context"] == FANOUT
    assert isinstance(seen["souls"], int)  # read across every leg, no NoShardContext


def _greek_soul_user():
    from apps.tenants.models import Tenant
    from tests.soul_account_support import ready_soul

    hall = Tenant.objects.create(code="GR_WS", display_name="ws", declared_civilization="GREEK")
    account, _client = ready_soul(hall, name="ws soul")
    return User.objects.select_related("tenant").get(pk=account.user_id)  # the socket stack loads it so


@pytest.mark.sharded
@pytest.mark.skipif(not HAS_SHARDS, reason="needs --ds=config.settings_sharded")
@pytest.mark.django_db(transaction=True, databases="__all__")
async def test_a_soul_socket_reads_its_souls_shard():
    """A soul account with a hall: its socket reads its soul's primary shard, as its HTTP requests do
    (shard_reads.soul_read_context: a control query, run off the event loop)."""
    user = await database_sync_to_async(_greek_soul_user)()
    seen = {}
    with override_settings(SHARDED=True):
        await TenantMiddleware(_inner(seen))({"type": "websocket", "user": user}, None, None)
    assert seen["context"] == "civ_greek"
    assert isinstance(seen["souls"], int)
