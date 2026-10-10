"""改密码 / 邮箱重置 / 停用:已经连上的 WebSocket 在事务提交后被关闭(4002),不等下次重连。

握手那一关早就拒绝旧令牌(`ws_auth`);缺口是**已连上**的 socket 会一直活到自己断线。
机制:`end_sessions` → `close_user_sockets` → `rt_user_{id}` 组 → consumer 的 `session_ended`:
握手时 `session_version` 低于新值的连接关闭;停用(`min_version=None`)关全部。
"""
import pytest
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.db import transaction
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.authentication.passwords import end_sessions
from apps.events.realtime import WS_CLOSE_SESSION_ENDED
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.asyncio]


@database_sync_to_async
def _user(name):
    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    return User.objects.create_user(username=name, password="x", role="JUDGE", tenant=tenant)


@database_sync_to_async
def _token(user):
    user.refresh_from_db(fields=["session_version"])
    refresh = RefreshToken.for_user(user)
    refresh["tenant_code"] = "CN_DIYU"
    refresh["sv"] = user.session_version
    return str(refresh.access_token)


async def _connect(user):
    from config.asgi import application

    comm = WebsocketCommunicator(application, f"/ws/notifications/?token={await _token(user)}")
    connected, _ = await comm.connect()
    assert connected
    await comm.receive_json_from(timeout=10)  # "connected"
    return comm


@database_sync_to_async
def _end(user_id, fail=False):
    user = User.objects.get(pk=user_id)
    try:
        with transaction.atomic():
            end_sessions(user)
            if fail:
                raise RuntimeError("business rolled back")
    except RuntimeError:
        pass


async def _closed_with(comm):
    out = await comm.receive_output(timeout=10)
    assert out["type"] == "websocket.close", out
    return out["code"]


async def _stays_open(comm):
    assert await comm.receive_nothing(timeout=1.5)


async def test_both_open_sockets_of_the_user_are_closed_and_a_later_one_is_not():
    user = await _user("ws_kick_a")
    d1, d2 = await _connect(user), await _connect(user)
    await _end(user.id)
    assert await _closed_with(d1) == WS_CLOSE_SESSION_ENDED
    assert await _closed_with(d2) == WS_CLOSE_SESSION_ENDED

    fresh = await _connect(user)  # 带新版本令牌重连:当前设备恢复的路径
    try:
        await _stays_open(fresh)
    finally:
        await fresh.disconnect()


async def test_another_users_socket_is_untouched():
    user, other = await _user("ws_kick_b"), await _user("ws_kick_other")
    mine, theirs = await _connect(user), await _connect(other)
    try:
        await _end(user.id)
        assert await _closed_with(mine) == WS_CLOSE_SESSION_ENDED
        await _stays_open(theirs)
    finally:
        await theirs.disconnect()


async def test_a_rolled_back_change_sends_nothing():
    user = await _user("ws_kick_c")
    comm = await _connect(user)
    try:
        await _end(user.id, fail=True)
        await _stays_open(comm)
    finally:
        await comm.disconnect()


async def test_deactivating_closes_every_open_socket():
    user = await _user("ws_kick_d")
    comm = await _connect(user)

    @database_sync_to_async
    def deactivate():
        from rest_framework.test import APIClient

        admin = User.objects.create_user(
            username="ws_kick_admin", password="x", role="ADMIN", is_staff=True, is_superuser=True
        )
        c = APIClient()
        c.force_authenticate(admin)
        return c.post(f"/api/v1/users/{user.id}/deactivate/").status_code

    status = await deactivate()
    assert status == 200
    assert await _closed_with(comm) == WS_CLOSE_SESSION_ENDED
