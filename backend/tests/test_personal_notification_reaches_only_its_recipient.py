"""个人通知只到收件人的 socket(RBAC 严查 2026-10-29 H1)。

修之前 `WebSocketHandler` 对带 `user_ids` 的事件同时发 `rt_tenant_<殿>` 和
`rt_user_<id>`,consumer 只看 `_permission`(`notification.read`,五个角色都有)。
于是同殿每位在线官员都收到别人的通知标题与正文,收件人自己收两次。

三条:真实 `notify_user` 之后,同殿另一官员什么都收不到、收件人只收一次;
consumer 的纵深:即便带 `_recipients` 的帧被发进殿组,非收件人也收不到,
收件人收到的帧里不带 `_recipients`。
"""
import pytest
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.events.realtime import ChannelNaming
from apps.perm.models import Permission, Role, RolePermission
from apps.tenants.models import Tenant


@database_sync_to_async
def _setup():
    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    role, _ = Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
    perm, _ = Permission.objects.get_or_create(
        codename="notification.read", defaults={"name": "查看通知", "category": "notification"}
    )
    RolePermission.objects.get_or_create(role=role, permission=perm)
    alice = User.objects.create_user(username="pn_alice", password="x", role="JUDGE", tenant=tenant)
    bob = User.objects.create_user(username="pn_bob", password="x", role="JUDGE", tenant=tenant)
    return alice, bob, tenant


@database_sync_to_async
def _token(user, tenant_code):
    refresh = RefreshToken.for_user(user)
    refresh["tenant_code"] = tenant_code
    return str(refresh.access_token)


async def _connect(user, tenant_code):
    from config.asgi import application

    comm = WebsocketCommunicator(application, f"/ws/notifications/?token={await _token(user, tenant_code)}")
    connected, _ = await comm.connect()
    assert connected
    frame = await comm.receive_json_from(timeout=10)
    assert frame["type"] == "connected", frame
    assert "notification.read" in frame["permissions"], "前置条件:持有 notification.read"
    return comm


@database_sync_to_async
def _notify(user):
    from apps.notifications.models import notify_user

    notify_user(user, title="密码求助", message="pn_alice 的私事")


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_a_personal_notification_reaches_the_recipient_once_and_no_one_else():
    alice, bob, tenant = await _setup()
    a = await _connect(alice, tenant.code)
    b = await _connect(bob, tenant.code)
    try:
        await _notify(alice)

        got = await a.receive_json_from(timeout=5)
        assert got["notification"]["title"] == "密码求助"
        assert "_recipients" not in got
        assert await a.receive_nothing(timeout=0.5), "收件人收到了第二份(殿组那份)"

        assert await b.receive_nothing(timeout=0.5), "同殿另一官员收到了别人的个人通知"
        # socket 活着:殿组的广播照样到 bob。
        await get_channel_layer().group_send(
            ChannelNaming.tenant_group(tenant.code), {"type": "realtime_event", "data": {"marker": 1}}
        )
        assert (await b.receive_json_from(timeout=3))["marker"] == 1
    finally:
        await a.disconnect()
        await b.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_the_consumer_drops_a_targeted_frame_that_reaches_a_non_recipient():
    alice, bob, tenant = await _setup()
    a = await _connect(alice, tenant.code)
    b = await _connect(bob, tenant.code)
    try:
        group = ChannelNaming.tenant_group(tenant.code)
        await get_channel_layer().group_send(
            group, {"type": "realtime_event", "data": {"marker": 2, "_recipients": [alice.id]}}
        )
        await get_channel_layer().group_send(group, {"type": "realtime_event", "data": {"marker": 3}})

        assert (await b.receive_json_from(timeout=3))["marker"] == 3, "非收件人收到了定向帧"
        first = await a.receive_json_from(timeout=3)
        assert first == {"marker": 2}, first
        assert (await a.receive_json_from(timeout=3))["marker"] == 3
    finally:
        await a.disconnect()
        await b.disconnect()
