"""`GET /audit-logs/?tenant=<殿码>` —— 审计页「殿」下拉的后端。2026-10-09。

全局管理员(ADMIN,不属于任何殿)可选任何一个殿,只看到那个殿的行;绑了殿的人只看得到自己殿,
点别的殿的名是 403(不是一页恰好为空的 200);不存在的殿码是 400;导出与列表同一组筛选。
"""
import csv
import io

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditAction, AuditLog
from apps.authentication.models import User
from apps.perm.models import Permission, Role, RolePermission
from apps.tenants.models import Tenant

LIST = "/api/v1/audit-logs/"
EXPORT = "/api/v1/audit-logs/export/"


def _client(user, tenant=None):
    token = RefreshToken.for_user(user)
    if tenant is not None:
        token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def halls(db):
    cn = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})[0]
    eg = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "埃及杜阿特"})[0]
    AuditLog.objects.bulk_create([
        AuditLog(tenant=cn, action=AuditAction.CREATE, resource="soul", resource_id="1", description="cn-1"),
        AuditLog(tenant=cn, action=AuditAction.UPDATE, resource="soul", resource_id="2", description="cn-2"),
        AuditLog(tenant=eg, action=AuditAction.CREATE, resource="soul", resource_id="9", description="eg-1"),
        AuditLog(tenant=None, action=AuditAction.CREATE, resource="soul", resource_id="0", description="global"),
    ])
    return cn, eg


@pytest.fixture
def global_admin(db):
    return _client(User.objects.create_user(username="aud_admin", password="x", role="ADMIN", tenant=None))


@pytest.fixture
def moderator(halls):
    cn, _ = halls
    role, _ = Role.objects.get_or_create(name="MODERATOR", defaults={"display_name": "Realm Lead"})
    perm, _ = Permission.objects.get_or_create(
        codename="audit.read", defaults={"name": "查看审计日志", "category": "audit"}
    )
    RolePermission.objects.get_or_create(role=role, permission=perm)
    return _client(User.objects.create_user(username="aud_mod", password="x", role="MODERATOR", tenant=cn), cn)


def _descriptions(response):
    return sorted(row["description"] for row in response.json()["results"])


def test_a_global_admin_without_the_param_sees_every_hall(global_admin, halls):
    assert _descriptions(global_admin.get(LIST)) == ["cn-1", "cn-2", "eg-1", "global"]


def test_a_global_admin_picks_one_hall_and_sees_only_its_rows(global_admin, halls):
    assert _descriptions(global_admin.get(LIST, {"tenant": "EG_DUAT"})) == ["eg-1"]
    assert _descriptions(global_admin.get(LIST, {"tenant": "CN_DIYU"})) == ["cn-1", "cn-2"]


def test_the_hall_filter_composes_with_the_other_filters(global_admin, halls):
    res = global_admin.get(LIST, {"tenant": "CN_DIYU", "action": "UPDATE"})
    assert _descriptions(res) == ["cn-2"]


def test_an_unknown_hall_is_a_400(global_admin, halls):
    res = global_admin.get(LIST, {"tenant": "NOPE"})
    assert res.status_code == 400


def test_a_bound_user_naming_their_own_hall_gets_their_rows(moderator, halls):
    assert _descriptions(moderator.get(LIST, {"tenant": "CN_DIYU"})) == ["cn-1", "cn-2"]


def test_a_bound_user_cannot_read_another_hall(moderator, halls):
    res = moderator.get(LIST, {"tenant": "EG_DUAT"})
    assert res.status_code == 403
    assert "eg-1" not in res.content.decode()
    # An unknown code is refused the same way: nothing here says whether a hall exists.
    assert moderator.get(LIST, {"tenant": "NOPE"}).status_code == 403


def test_a_bound_user_without_the_param_is_unchanged(moderator, halls):
    assert _descriptions(moderator.get(LIST)) == ["cn-1", "cn-2"]


def test_the_export_takes_the_same_hall_filter_and_the_same_refusal(global_admin, moderator, halls):
    rows = list(csv.reader(io.StringIO(global_admin.get(EXPORT, {"tenant": "EG_DUAT"}).content.decode())))
    assert [r[1] for r in rows[1:]] == ["EG_DUAT"]
    assert moderator.get(EXPORT, {"tenant": "EG_DUAT"}).status_code == 403


# --- 2026-10-09: the 「殿」 dropdown and the cross-hall read are for GLOBAL admins only ---

@pytest.fixture
def bound_admin(halls):
    cn, _ = halls
    return _client(User.objects.create_user(username="aud_bound", password="x", role="ADMIN", tenant=cn), cn)


def test_a_hall_bound_admin_sees_only_their_own_hall_without_the_param(bound_admin, halls):
    assert _descriptions(bound_admin.get(LIST)) == ["cn-1", "cn-2"]


def test_a_hall_bound_admin_may_name_their_own_hall_but_not_another(bound_admin, halls):
    assert _descriptions(bound_admin.get(LIST, {"tenant": "CN_DIYU"})) == ["cn-1", "cn-2"]
    res = bound_admin.get(LIST, {"tenant": "EG_DUAT"})
    assert res.status_code == 403
    assert "eg-1" not in res.content.decode()


def test_the_export_of_a_hall_bound_admin_is_their_hall_only(bound_admin, halls):
    rows = list(csv.reader(io.StringIO(bound_admin.get(EXPORT).content.decode())))
    assert {r[1] for r in rows[1:]} == {"CN_DIYU"}
    assert bound_admin.get(EXPORT, {"tenant": "EG_DUAT"}).status_code == 403
