"""首帧鉴权(`{"type": "auth", "token": ...}`)之后,带权限门的事件要和 `?token=` 路径一样送达。

2026-09-12 审计 BP-08。修之前:

  * `NotificationConsumer.receive` 的 auth 分支把结果写进 `self.permissions`,却不写回
    `self.scope["permissions"]`;而 `realtime_event` 的门禁读的是 scope —— 那里躺着
    `PermissionMiddleware` 用 AnonymousUser 算出来的**空集**。
  * `PermissionMiddleware.wrapped_receive` 里的 refresh 闭包捕获的 `user` 也是那个
    AnonymousUser,所以首帧鉴权之后发 `permission.refresh`,拿回的是空集。

实测:`connected` 帧列出 21 个码名,但任何带 `_permission` 门的事件都超时不达。
前端走 `?token=`,所以这条一直潜伏。

四条断言:同一用户两条路径的 `connected` 权限集相等;带门事件在首帧鉴权后送达;
无权限的仍然不送达(而紧随其后的无门事件送达 —— 证明 socket 活着);首帧鉴权之后
refresh 报的是真实集合,降权后收窄。
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


def _make_token_sync(user, tenant_code):
    refresh = RefreshToken.for_user(user)
    refresh["tenant_code"] = tenant_code
    return str(refresh.access_token)


_make_token = database_sync_to_async(_make_token_sync)


@database_sync_to_async
def _make_users():
    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    for name in ("JUDGE", "VIEWER"):
        Role.objects.get_or_create(name=name, defaults={"display_name": name.title()})
    judge_role = Role.objects.get(name="JUDGE")
    perm, _ = Permission.objects.get_or_create(
        codename="judgment.read", defaults={"name": "查看审判", "category": "judgment"}
    )
    RolePermission.objects.get_or_create(role=judge_role, permission=perm)
    judge = User.objects.create_user(username="ff_judge", password="x", role="JUDGE", tenant=tenant)
    viewer = User.objects.create_user(username="ff_viewer", password="x", role="VIEWER", tenant=tenant)
    return judge, viewer, tenant


@database_sync_to_async
def _demote(user_id, role):
    User.objects.filter(pk=user_id).update(role=role)


async def _connect_query_token(user, tenant_code):
    from config.asgi import application

    token = await _make_token(user, tenant_code)
    comm = WebsocketCommunicator(application, f"/ws/notifications/?token={token}")
    connected, _ = await comm.connect()
    assert connected
    return comm, await comm.receive_json_from()


async def _connect_first_frame(user, tenant_code):
    from config.asgi import application

    comm = WebsocketCommunicator(application, "/ws/notifications/")
    connected, _ = await comm.connect()
    assert connected
    token = await _make_token(user, tenant_code)
    await comm.send_json_to({"type": "auth", "token": token})
    frame = await comm.receive_json_from()
    assert frame["type"] == "connected", frame
    return comm, frame


def _gated(codename, marker):
    return {"type": "realtime_event", "data": {"_permission": codename, "marker": marker}}


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_both_paths_report_the_same_permission_set():
    judge, _viewer, tenant = await _make_users()
    q_comm, q_frame = await _connect_query_token(judge, tenant.code)
    f_comm, f_frame = await _connect_first_frame(judge, tenant.code)
    try:
        assert q_frame["permissions"], "前置条件:JUDGE 至少持有一个码名"
        assert sorted(f_frame["permissions"]) == sorted(q_frame["permissions"])
    finally:
        await q_comm.disconnect()
        await f_comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_a_gated_event_reaches_a_first_frame_authenticated_holder():
    judge, _viewer, tenant = await _make_users()
    comm, frame = await _connect_first_frame(judge, tenant.code)
    try:
        assert "judgment.read" in frame["permissions"], "前置条件:connected 帧已经列出了这个码名"
        await get_channel_layer().group_send(ChannelNaming.tenant_group(tenant.code), _gated("judgment.read", 1))
        received = await comm.receive_json_from(timeout=3)
        assert received["marker"] == 1, (
            "connected 帧说持有 judgment.read,门禁却把事件丢了 —— 门禁读的是 scope 里的空集"
        )
    finally:
        await comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_a_gated_event_still_does_not_reach_a_first_frame_non_holder():
    """反对照,同时证明 socket 活着:带门的不到,紧跟其后的无门事件要到。"""
    _judge, viewer, tenant = await _make_users()
    comm, frame = await _connect_first_frame(viewer, tenant.code)
    try:
        assert "judgment.read" not in frame["permissions"], "前置条件:VIEWER 不持有它"
        group = ChannelNaming.tenant_group(tenant.code)
        await get_channel_layer().group_send(group, _gated("judgment.read", 2))
        await get_channel_layer().group_send(
            group, {"type": "realtime_event", "data": {"marker": 3}}
        )
        received = await comm.receive_json_from(timeout=3)
        assert received["marker"] == 3, f"无权限的 VIEWER 收到了带门事件:{received}"
        assert await comm.receive_nothing(timeout=1.0)
    finally:
        await comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_refresh_after_first_frame_auth_reads_the_real_user():
    """修之前:refresh 走中间件的闭包,那里的 `user` 是 AnonymousUser → 空集,
    而门禁从此永远拒绝。修之后:报真实集合,降权后收窄,门禁跟着关。"""
    judge, _viewer, tenant = await _make_users()
    comm, frame = await _connect_first_frame(judge, tenant.code)
    try:
        await comm.send_json_to({"type": "permission.refresh"})
        refreshed = await comm.receive_json_from(timeout=3)
        assert refreshed["type"] == "permission.refreshed"
        assert sorted(refreshed["permissions"]) == sorted(frame["permissions"]), (
            "首帧鉴权之后的 refresh 报出了另一套集合 —— 它读的是 AnonymousUser"
        )

        await _demote(judge.id, "VIEWER")
        await comm.send_json_to({"type": "permission.refresh"})
        after = set((await comm.receive_json_from(timeout=3))["permissions"])
        assert "judgment.read" not in after
        assert after, "降权成 VIEWER 不是降成空集"

        await get_channel_layer().group_send(ChannelNaming.tenant_group(tenant.code), _gated("judgment.read", 4))
        assert await comm.receive_nothing(timeout=1.0), "降权之后带门事件仍然送达"
    finally:
        await comm.disconnect()
