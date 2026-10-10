"""
overwrite 导入一份「不含任何 ADMIN 行」的文件之后,ADMIN 还进得了权限页吗?

这是 Web 导入入口(只做合并)动工前留下的未决问题:`overwrite=True` 会删授权行,
会不会把最后一个管理员锁在权限页外面?

实测结论(此测试钉住):**不能复现。** 三重保护,任何一重在都够:
  1. `import_permissions(overwrite=True)` 对授权表是 `.exclude(role__name=ADMIN_ROLE_NAME).delete()`
     —— ADMIN 的行不删(apps/perm/export.py,`admin_always_all`,2026-09-25);
  2. 权限页的接口用 `IsAdminPermission`,比的是 `user.role == "ADMIN"` 这个字符串,不读任何授权行;
  3. `check_permission` 对 ADMIN 在读授权之前就放行(apps/perm/checker.py)。
所以连第 1 重被将来的改动拿掉,第 2、3 重仍然让 ADMIN 进得来 —— 下面各有一条断言分别钉住。

另外两条事实一并钉住(它们决定界面该怎么说):真导入留一条 IMPORT 汇总审计行(2026-10-10 起;
此前只有逐行信号的 PERMISSION_CHANGE);「合并」模式只新增、不改已有行、不删。
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.perm.checker import check_permission
from apps.perm.models import Permission, Role, RolePermission
from apps.tenants.models import Tenant

IMPORT = "/api/v1/perm/import/"


def _client(user, tenant):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client



@pytest.fixture(autouse=True)
def _overwrite_import_on(settings):
    """Overwrite import is off by default (PERM_IMPORT_OVERWRITE_ENABLED); this file tests it."""
    settings.PERM_IMPORT_OVERWRITE_ENABLED = True

@pytest.fixture
def world(db):
    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    admin_role, _ = Role.objects.get_or_create(name="ADMIN", defaults={"display_name": "Admin"})
    for codename in ("system.settings", "user.manage"):
        perm, _ = Permission.objects.get_or_create(codename=codename, defaults={"name": codename, "category": "sys"})
        RolePermission.objects.get_or_create(role=admin_role, permission=perm)
    other, _ = Role.objects.get_or_create(name="LOCKOUT_PROBE", defaults={"display_name": "probe"})
    admin = User.objects.create_user(username="lock_admin", password="x", role="ADMIN", tenant=tenant)
    return {"tenant": tenant, "admin": admin, "admin_role": admin_role, "other": other}


def _overwrite_with_a_file_that_has_no_admin_rows(client):
    return client.post(
        IMPORT,
        {"overwrite": True, "roles": [{"name": "LOCKOUT_PROBE", "display_name": "probe"}]},
        format="json",
    )


@pytest.mark.django_db
def test_overwrite_without_admin_rows_does_not_strip_admin(world):
    before = set(RolePermission.objects.filter(role=world["admin_role"]).values_list("pk", flat=True))
    assert before, "前置条件:ADMIN 有授权行"

    response = _overwrite_with_a_file_that_has_no_admin_rows(_client(world["admin"], world["tenant"]))

    assert response.status_code == 200, response.content
    assert set(RolePermission.objects.filter(role=world["admin_role"]).values_list("pk", flat=True)) == before


@pytest.mark.django_db
def test_even_with_every_grant_row_gone_admin_still_reaches_the_permissions_page(world):
    """第 2、3 重:把 ADMIN 的授权行全部手工删光(模拟第 1 重失守),权限页接口照样放行,
    而且 ADMIN 还能再导入一次把状态救回来 —— 没有「锁在外面」的路径。"""
    client = _client(world["admin"], world["tenant"])
    RolePermission.objects.all().delete()

    assert check_permission(world["admin"], "system.settings") is True
    for path in ("/api/v1/perm/permissions/", "/api/v1/perm/roles/", "/api/v1/perm/roles/ADMIN/permissions/",
                 "/api/v1/perm/export/"):
        assert client.get(path).status_code == 200, path

    rescue = client.post(
        IMPORT,
        {"permissions": [{"codename": "system.settings", "name": "s", "category": "sys"}],
         "roles": [{"name": "ADMIN", "display_name": "Admin"}],
         "role_permissions": [{"role": "ADMIN", "permission": "system.settings", "conditions": {}}]},
        format="json",
    )
    assert rescue.status_code == 200, rescue.content


@pytest.mark.django_db
def test_overwrite_never_deletes_the_admin_role_itself(world):
    _overwrite_with_a_file_that_has_no_admin_rows(_client(world["admin"], world["tenant"]))
    assert Role.objects.filter(name="ADMIN").exists()


@pytest.mark.django_db
def test_a_real_import_leaves_one_summary_audit_row_and_a_dry_run_none(world):
    """2026-10-10 前这里钉的是「没有汇总行」;现在真导入(合并与覆盖)各留一条 IMPORT 行:谁、何时、
    模式、新增 / 更新 / 删除的条数。预演不留(它的事务回滚)。"""
    from apps.audit.models import AuditAction

    client = _client(world["admin"], world["tenant"])
    doc = {"roles": [{"name": "LOCKOUT_PROBE", "display_name": "probe"}]}

    client.post(IMPORT, {**doc, "dry_run": True, "overwrite": True}, format="json")
    assert not AuditLog.objects.filter(action=AuditAction.IMPORT).exists()

    assert client.post(IMPORT, doc, format="json").status_code == 200
    assert client.post(IMPORT, {**doc, "overwrite": True}, format="json").status_code == 200

    rows = list(AuditLog.objects.filter(action=AuditAction.IMPORT).order_by("timestamp"))
    assert [r.changes["mode"] for r in rows] == ["merge", "overwrite"]
    assert all(r.user_id == world["admin"].pk and r.resource == "permission_config" for r in rows)
    overwrite = rows[1].changes
    assert set(overwrite) == {"mode", "created", "skipped", "updated", "removed"}
    assert overwrite["removed"]["total"] == overwrite["removed"]["role_permissions"] + overwrite["removed"]["field_permissions"] + overwrite["removed"]["data_scopes"]


@pytest.mark.django_db
def test_merge_mode_adds_but_never_changes_or_deletes(world):
    """界面只用这个模式:已有授权不删,已有角色的标签不改。"""
    client = _client(world["admin"], world["tenant"])
    keep = RolePermission.objects.filter(role=world["admin_role"]).count()
    label = world["admin_role"].display_name

    response = client.post(
        IMPORT,
        {"roles": [{"name": "ADMIN", "display_name": "RENAMED"}, {"name": "NEW_ROLE", "display_name": "n"}]},
        format="json",
    )

    assert response.status_code == 200, response.content
    world["admin_role"].refresh_from_db()
    assert world["admin_role"].display_name == label
    assert Role.objects.filter(name="NEW_ROLE").exists()
    assert RolePermission.objects.filter(role=world["admin_role"]).count() == keep
    assert response.data["stats"]["roles"]["created"] == 1
