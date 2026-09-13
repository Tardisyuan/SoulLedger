"""浏览器从别的站点打开的 socket 不给连;同源、CORS 放行的源、不带 Origin 的客户端照连(IS-10)。

`config/asgi.py` 此前没有任何 origin 校验:任何网页都能对 `/ws/` 发起握手。
认证靠 token(query 或首帧)而不是 cookie,所以今天没有可被劫持的环境凭据 ——
这是纵深防御,但策略必须与 HTTP 的 CORS 一致,否则会把正常连接挡掉:

- 生产经 nginx 同源:页面 origin 的 host 就在 `ALLOWED_HOSTS` 里。
- 前后端分域:页面 origin 在 `CORS_ALLOWED_ORIGINS` 里。
- DEBUG 下 `CORS_ALLOW_ALL_ORIGINS` 为真,HTTP 放行一切,WS 也一样。
- 不带 `Origin` 的是非浏览器客户端:网页驱动不了它,没有跨站可言;
  channels 自带的 `AllowedHostsOriginValidator` 会拒它,那会断掉所有现有测试
  和任何原生客户端。
"""
import pytest
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.test import override_settings
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User, UserRole
from apps.tenants.models import Tenant


@database_sync_to_async
def _token():
    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "A"})
    user = User.objects.create_user(
        username="ws-origin-probe", password="x", role=UserRole.VIEWER, tenant=tenant
    )
    return str(RefreshToken.for_user(user).access_token)


async def _connects(origin):
    from config.asgi import application

    headers = [(b"origin", origin.encode())] if origin else []
    comm = WebsocketCommunicator(
        application, f"/ws/notifications/?token={await _token()}", headers=headers
    )
    try:
        connected, _ = await comm.connect()
    except Exception:
        connected = False
    await comm.disconnect()
    return connected


_PROD = override_settings(
    CORS_ALLOW_ALL_ORIGINS=False,
    ALLOWED_HOSTS=["soulledger.example"],
    CORS_ALLOWED_ORIGINS=["https://app.partner.example"],
)


@_PROD
@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_a_foreign_origin_is_refused():
    assert not await _connects("https://evil.example"), "别的站点的页面连上了 /ws/"


@_PROD
@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_the_same_origin_behind_nginx_connects():
    assert await _connects("https://soulledger.example")


@_PROD
@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_a_cors_allowed_origin_connects():
    assert await _connects("https://app.partner.example")


@_PROD
@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_a_client_without_an_origin_header_connects():
    assert await _connects(None)


@override_settings(CORS_ALLOW_ALL_ORIGINS=True, ALLOWED_HOSTS=["localhost"])
@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_debug_cors_allow_all_also_allows_any_socket_origin():
    assert await _connects("http://192.168.0.9:3333")
