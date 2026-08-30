"""降权在一条已经建立的 WebSocket 上真的生效。

产品为这件事只提供了一个机制:客户端发 `{"type": "permission.refresh"}`。
实测(`WebsocketCommunicator` 跑完整的 `config.asgi.application`):

    [R0] JUDGE=21 个码名   VIEWER=9
    [R1] connect 时 perms n=21
    [R2] 数据库里降为 VIEWER 之后 refresh 返回 n=21
         等于 VIEWER 集? False    等于 JUDGE 集? True
    [R3] 推一条 `_permission='cross_judgment.create'` 的事件 → 客户端**收到了**

**两个互相独立的原因,各自单独就足以让它失效:**

  ① `PermissionMiddleware._resolve_permissions(user)` 读的是 connect 时那个**内存
     里的 user 对象**的 `.role`。数据库改了,它读不到。
  ② 即使 scope 更新了,consumer 的门禁读 `self.permissions` —— connect 时的一份
     拷贝 —— **从不重读 scope**。

所以修一个不够,而只修一个的测试会绿。下面两条分别把两个原因单独钉住,第三条
钉住端到端的结果。

**产品提供的唯一补救机制返回成功、并附上一份一个字段都没变的权限列表** ——
一个报告成功却什么都没做的补救,比没有补救更糟:它会终止调查。
"""
import json

import pytest
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.tenants.models import Tenant


def _make_token_sync(user, tenant_code=None):
    refresh = RefreshToken.for_user(user)
    if tenant_code:
        refresh["tenant_code"] = tenant_code
    return str(refresh.access_token)


_make_token = database_sync_to_async(_make_token_sync)


@database_sync_to_async
def _demote(user_id, role):
    User.objects.filter(pk=user_id).update(role=role)


@database_sync_to_async
def _make_user():
    tenant, _ = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "中国地府"}
    )
    return User.objects.create_user(
        username="ws_demote_probe", password="x", role="JUDGE", tenant=tenant
    ), tenant


async def _connect(user, tenant_code):
    from config.asgi import application

    token = await _make_token(user, tenant_code)
    comm = WebsocketCommunicator(application, f"/ws/notifications/?token={token}")
    connected, _ = await comm.connect()
    assert connected
    await comm.receive_json_from()  # the "connected" frame
    return comm


async def _refresh(comm):
    await comm.send_json_to({"type": "permission.refresh"})
    return await comm.receive_json_from()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_refresh_reports_the_new_permission_set_after_a_demotion():
    """原因 ①。中间件必须重读那一行,不能读闭包里那个 user 对象。"""
    user, tenant = await _make_user()
    comm = await _connect(user, tenant.code)
    try:
        before = set((await _refresh(comm))["permissions"])
        assert before, "前置条件:JUDGE 至少持有一个码名,否则下面比不出差别"

        await _demote(user.id, "VIEWER")
        after = set((await _refresh(comm))["permissions"])

        assert after != before, (
            f"降权之后 refresh 返回的还是同一套权限({len(after)} 个)—— "
            f"中间件读的是 connect 时那个内存 user 对象"
        )
        assert after < before, f"VIEWER 应当是 JUDGE 的真子集:{sorted(after - before)}"
    finally:
        await comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_a_gated_event_stops_arriving_after_a_demotion():
    """原因 ② 与端到端的结果。

    只测上面那条是不够的:即使 refresh 报出了新集合,门禁读的仍可能是 connect 时
    那份拷贝。这一条推一条带 `_permission` 门的事件,断言它**不再送达**。
    """
    user, tenant = await _make_user()
    comm = await _connect(user, tenant.code)
    layer = get_channel_layer()
    # `ChannelNaming.tenant_group` 的真实前缀是 `rt_`。写死 `tenant_{code}` 会让
    # group_send 发到一个没人监听的组里,于是「事件没送到」这件事以**正确的
    # 断言、错误的理由**成立 —— 那正是这条测试要抓的形状,而它会抓到自己。
    from apps.events.realtime import ChannelNaming

    group = ChannelNaming.tenant_group(tenant.code)
    gated = {"type": "realtime_event", "data": {"_permission": "judgment.execute", "hello": 1}}
    try:
        await _refresh(comm)
        await layer.group_send(group, gated)
        first = await comm.receive_json_from(timeout=3)
        assert first["hello"] == 1, "前置条件:降权之前这条事件是送得到的"

        await _demote(user.id, "VIEWER")
        await _refresh(comm)

        await layer.group_send(group, gated)
        assert await comm.receive_nothing(timeout=1.5), (
            "降权之后这条带门的事件仍然送达 —— consumer 的门禁读的是 "
            "connect 时的 self.permissions 拷贝,不是 scope"
        )
    finally:
        await comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_an_ungated_event_still_arrives_after_a_demotion():
    """反对照。

    没有它,一个「降权之后什么都不再送」的实现同样满足上面那条,而那等于把这条
    socket 静默关掉 —— 用户看到的是界面停止更新,没有任何提示。
    """
    user, tenant = await _make_user()
    comm = await _connect(user, tenant.code)
    layer = get_channel_layer()
    try:
        await _demote(user.id, "VIEWER")
        await _refresh(comm)

        from apps.events.realtime import ChannelNaming

        await layer.group_send(
            ChannelNaming.tenant_group(tenant.code),
            {"type": "realtime_event", "data": {"hello": "no gate"}},
        )
        received = await comm.receive_json_from(timeout=3)
        assert received["hello"] == "no gate"
    finally:
        await comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_deactivating_the_account_empties_the_permission_set():
    """`apps/core/ws_auth.py` 在 connect 时拒绝停用账号。一条已经建立的 socket
    也不该继续按旧权限工作 —— 否则「停用」这个动作对在线用户等于不存在。"""
    user, tenant = await _make_user()
    comm = await _connect(user, tenant.code)
    try:
        assert set((await _refresh(comm))["permissions"])

        @database_sync_to_async
        def deactivate():
            User.objects.filter(pk=user.id).update(is_active=False)

        await deactivate()
        assert set((await _refresh(comm))["permissions"]) == set()
    finally:
        await comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_the_refresh_reply_is_json_with_the_expected_shape():
    """上面几条都读 `["permissions"]`。若哪天回包的形状变了,它们会以 KeyError
    而不是断言失败的形式红,读的人会以为是测试坏了。这一条把形状说出来。"""
    user, tenant = await _make_user()
    comm = await _connect(user, tenant.code)
    try:
        await comm.send_json_to({"type": "permission.refresh"})
        raw = await comm.receive_from(timeout=3)
        payload = json.loads(raw)
        assert payload["type"] == "permission.refreshed"
        assert isinstance(payload["permissions"], list)
        assert payload["permissions"] == sorted(payload["permissions"])
    finally:
        await comm.disconnect()
