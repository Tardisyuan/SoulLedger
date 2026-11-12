"""绑殿 ADMIN 的权限清单不报 `GLOBAL_ONLY_CODENAMES`(用户 2026-11-11)。

`check_permission` 只把 `menu.manage` 这类全站配置码给没绑殿的 ADMIN(`is_tenant_exempt`)。上报清单用的
`RoleHolder` 替身此前没有殿,于是对绑殿 ADMIN 也读成「无殿」—— 登录返回、`GET /perm/role-permissions/`、
`/auth/me/` 一类与 WebSocket 的权限集都报了服务端实际会拒的码。现在三处都按真实用户的殿判断。

每条断言两边：绑殿 ADMIN 不报、无殿 ADMIN 照报;且上报与 `check_permission(真实用户)` 一致。
"""
import pytest
from rest_framework.test import APIClient

from apps.authentication.models import User
from apps.authentication.serializers import UserSerializer, UserWithTenantSerializer
from apps.core.ws_permissions import resolve_permissions_for
from apps.perm.checker import GLOBAL_ONLY_CODENAMES, check_permission
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db


@pytest.fixture
def admins():
    tenant = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})[0]
    bound = User.objects.create_user(username="ga_bound", password="x", role="ADMIN", tenant=tenant)
    hallless = User.objects.create_user(username="ga_global", password="x", role="ADMIN", tenant=None)
    return bound, hallless


def _endpoint(user):
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/v1/perm/role-permissions/")
    assert response.status_code == 200, response.content
    return set(response.json()["permissions"])


def _reports(user):
    return {
        "role-permissions": _endpoint(user),
        "login / me": set(UserWithTenantSerializer(user).data["permissions"]),
        "user": set(UserSerializer(user).data["permissions"]),
        "websocket": resolve_permissions_for(user),
    }


def test_a_hall_bound_admin_is_not_reported_what_the_server_refuses_it(admins):
    bound, hallless = admins
    assert GLOBAL_ONLY_CODENAMES  # 不空转
    for code in GLOBAL_ONLY_CODENAMES:
        assert check_permission(bound, code) is False and check_permission(hallless, code) is True
    for path, reported in _reports(bound).items():
        assert not reported & GLOBAL_ONLY_CODENAMES, f"{path} reports {sorted(reported & GLOBAL_ONLY_CODENAMES)}"
        assert "soul.read" in reported, path  # 别的码照报
    for path, reported in _reports(hallless).items():
        assert reported >= GLOBAL_ONLY_CODENAMES, path
