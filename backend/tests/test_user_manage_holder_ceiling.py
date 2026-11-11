"""`user.manage` 授给非 ADMIN 角色时的上限(审计 2026-11-11 P-04 / P-05)。

默认矩阵里只有 ADMIN 持 `user.manage`;这里把它授给 GUARDIAN,问的是「授出去之后,持有人能不能借它拿到比自己多的东西」。
- P-04:邀请官员曾不查 `may_assign_role`,GUARDIAN 可以邀请一个 JUDGE 到自己控制的邮箱。
- P-05:自建角色没有等级(一律 999);授出要求「它的码 ⊆ 调用者的码」,动一个账号要求「对方的码 ⊆ 调用者的码」。
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


def test_a_custom_role_is_assignable_only_when_the_caller_holds_all_it_grants(world):
    """P-05:自建角色曾一律排名 999,任何调用者都「不高于」它 —— GUARDIAN 可给自己兼任一个持 judgment.execute 的角色。"""
    _grant("DEPUTY", "judgment.execute")  # GUARDIAN 不持有
    _grant("LESSER", "user.manage")  # GUARDIAN 持有(fixture 里显式授的;别的码不行:_grant 一建出 Permission 行，就只认 RolePermission,GUARDIAN 没有那一行)
    g, me = world["g"], world["guardian"]
    viewer = User.objects.create_user(username="um_viewer", password="x", role="VIEWER", tenant=world["tenant"])

    assert g.post(f"/api/v1/users/{me.pk}/assign_roles/", {"extra_roles": ["DEPUTY"]},
                  format="json").status_code == 403
    assert g.patch(f"/api/v1/users/{viewer.pk}/", {"role": "DEPUTY"}, format="json").status_code == 400
    assert g.post("/api/v1/users/", {"username": "um_new", "password": "N0t-Guessable!2026-x", "role": "DEPUTY"},
                  format="json").status_code == 400
    res = g.post("/api/v1/users/invite/", {"email": "deputy@example.com", "role": "DEPUTY"}, format="json")
    assert res.status_code == 400 and res.json()["code"] == "role_forbidden"
    me.refresh_from_db()
    viewer.refresh_from_db()
    assert me.extra_roles == [] and viewer.role == "VIEWER"
    assert not User.objects.filter(username="um_new").exists()

    # 码是自己的子集的自建角色照常授出
    res = g.post(f"/api/v1/users/{viewer.pk}/assign_roles/", {"extra_roles": ["LESSER"]}, format="json")
    assert res.status_code == 200, res.content


def test_an_account_holding_more_than_the_caller_is_out_of_reach(world):
    """P-05 的另一半:等级只管「授出什么」,不管「动的是谁」—— GUARDIAN 曾能重置 JUDGE 的密码拿到设置链接。"""
    judge = User.objects.create_user(username="um_judge", password="x", role="JUDGE", tenant=world["tenant"])
    peer = User.objects.create_user(username="um_peer", password="x", role="GUARDIAN", tenant=world["tenant"])
    g = world["g"]

    for method, path, body in [
        ("post", f"/api/v1/users/{judge.pk}/reset_password/", {}),
        ("post", f"/api/v1/users/{judge.pk}/deactivate/", {}),
        ("patch", f"/api/v1/users/{judge.pk}/", {"position": "x"}),
        ("post", f"/api/v1/users/{judge.pk}/assign_roles/", {"extra_roles": []}),
        ("delete", f"/api/v1/users/{judge.pk}/", {}),
    ]:
        res = getattr(g, method)(path, body, format="json")
        assert res.status_code == 403, (path, res.content)
        assert res.json()["code"] == "target_outranks_caller"
    # 同等权限的人照常可重置
    assert g.post(f"/api/v1/users/{peer.pk}/reset_password/", {}, format="json").status_code == 200

    res = g.post("/api/v1/users/batch_deactivate/", {"user_ids": [judge.pk, peer.pk]}, format="json")
    assert res.status_code == 200 and res.json()["updated"] == 1, res.content
    judge.refresh_from_db()
    peer.refresh_from_db()
    assert judge.is_active and judge.has_usable_password() and not peer.is_active
