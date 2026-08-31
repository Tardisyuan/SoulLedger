"""token 断言的租户与用户自己的外键对不上,socket 就不给连。

HTTP 从 token 的 `tenant_code` claim 解析租户(`TenantMiddleware`),
WebSocket 从 `user.tenant` 外键解析。**两者可以不一致** —— 2026-08-29 实测:
同一个 token 让 `request.tenant = ZZB`,而 socket 加入了 `rt:tenant:ZZA`。

不是泄漏:外键是更严的一边(token 断言不了它),所以 WS 加入的组永远是用户真正
属于的那个。**但在此之前,「两条路径对同一个问题给出不同答案」不会让任何东西报错**
—— 两个传输层各自安静地正确,而没有人知道它们不一致。

用户 2026-09-01 的决定:不统一两条路径,但**不一致时拒绝连接**。
拒绝而不是纠正:一个断言了错租户的 token 是一件需要有人去看的事,
静默地用外键覆盖它会把它变回不可见。
"""
import pytest
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User, UserRole
from apps.tenants.models import Tenant


@pytest.fixture
def two_tenants(db):
    a, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "A"})
    b, _ = Tenant.objects.get_or_create(
        code="EU_HEAVEN_HELL", defaults={"display_name": "B"}
    )
    return a, b


@pytest.fixture
def user_in_a(two_tenants):
    a, _ = two_tenants
    return User.objects.create_user(
        username="ws-tenant-probe", password="x", role=UserRole.VIEWER, tenant=a
    )


def _token_sync(user, tenant_code=None):
    """签 token 要读库,所以走 `database_sync_to_async` —— 与
    `tests/test_websocket.py` 同一个做法。"""
    refresh = RefreshToken.for_user(user)
    if tenant_code is not None:
        refresh["tenant_code"] = tenant_code
    return str(refresh.access_token)


_token = database_sync_to_async(_token_sync)


@database_sync_to_async
def _make_user(username, tenant):
    return User.objects.create_user(
        username=username, password="x", role=UserRole.VIEWER, tenant=tenant
    )


async def _connect(token):
    from config.asgi import application

    communicator = WebsocketCommunicator(
        application, f"/ws/notifications/?token={token}"
    )
    try:
        connected, _ = await communicator.connect()
    except Exception:
        # 服务端发了 close 帧 —— communicator 会抛。与 tests/test_websocket.py
        # 的 `_try_connect` 同一个做法。
        return communicator, False
    return communicator, connected


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_a_token_claiming_another_tenant_is_refused(user_in_a, two_tenants):
    _a, b = two_tenants
    communicator, connected = await _connect(await _token(user_in_a, tenant_code=b.code))
    try:
        assert not connected, (
            "token 断言 EU_HEAVEN_HELL、而用户属于 CN_DIYU,socket 竟然连上了"
        )
    finally:
        await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_a_token_claiming_the_right_tenant_connects(user_in_a, two_tenants):
    """**断存在。** 只断「不一致被拒」的实现,可以简单地拒绝一切。"""
    a, _b = two_tenants
    communicator, connected = await _connect(await _token(user_in_a, tenant_code=a.code))
    try:
        assert connected, "claim 与外键一致,却连不上"
    finally:
        await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_a_token_without_the_claim_still_connects(user_in_a):
    """**claim 缺失不算冲突。**

    不是每个 token 都带 `tenant_code`(`TenantMiddleware` 自己就有回落路径),
    而「没有断言」与「断言错了」是两件事。把前者也拒掉,会让这条守卫变成一个
    「所有旧 token 一律断线」的开关。
    """
    communicator, connected = await _connect(await _token(user_in_a))
    try:
        assert connected, "没有 tenant_code claim 的 token 被拒了"
    finally:
        await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_a_tenantless_user_with_a_claim_is_refused(two_tenants):
    """用户没有租户,而 token 断言有一个 —— 也是对不上。"""
    a, _b = two_tenants
    user = await _make_user("ws-no-tenant", None)
    communicator, connected = await _connect(await _token(user, tenant_code=a.code))
    try:
        assert not connected
    finally:
        await communicator.disconnect()
