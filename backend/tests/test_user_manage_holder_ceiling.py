"""`user.manage` 授给非 ADMIN 角色时的上限(审计 2026-11-11 P-04 / P-05)。

默认矩阵里只有 ADMIN 持 `user.manage`;这里把它授给 GUARDIAN,问的是「授出去之后,持有人能不能借它拿到比自己多的东西」。
- P-04:邀请官员曾不查 `may_assign_role`,GUARDIAN 可以邀请一个 JUDGE 到自己控制的邮箱。
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User, UserRole
from apps.perm.cache import invalidate_all_permissions
from apps.perm.models import Permission, Role, RolePermission
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db


def _client(user):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _grant(name, *codenames):
    role, _ = Role.objects.get_or_create(name=name, defaults={"display_name": name})
    for c in codenames:
        perm, _ = Permission.objects.get_or_create(codename=c, defaults={"name": c, "category": c.split(".")[0]})
        RolePermission.objects.get_or_create(role=role, permission=perm)
    invalidate_all_permissions()
    return role


@pytest.fixture
def world():
    invalidate_all_permissions()
    tenant = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})[0]
    for name in UserRole.values:
        Role.objects.get_or_create(name=name, defaults={"display_name": name.title()})
    _grant("GUARDIAN", "user.manage")
    guardian = User.objects.create_user(username="um_guardian", password="x", role="GUARDIAN", tenant=tenant)
    yield {"tenant": tenant, "guardian": guardian, "g": _client(guardian)}
    invalidate_all_permissions()


def test_an_invitation_respects_the_role_ceiling(world):
    res = world["g"].post("/api/v1/users/invite/", {"email": "mine@example.com", "role": "JUDGE"}, format="json")
    assert res.status_code == 400, res.content
    assert res.json()["code"] == "role_forbidden"
    assert not User.objects.filter(email__iexact="mine@example.com").exists()
    # 不高于自己的照常邀请
    res = world["g"].post("/api/v1/users/invite/", {"email": "fine@example.com", "role": "VIEWER"}, format="json")
    assert res.status_code == 201, res.content
