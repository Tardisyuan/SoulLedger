"""`/perm/` 前缀对非 ADMIN 泄漏什么,不泄漏什么。

`get_role_permissions` 上曾经写着「仅允许用户查询自己的角色权限,防止枚举」,
而同一前缀下 `list_permissions` 与 `list_roles` 都是 `[IsAuthenticated]` ——
任何登录用户拿得到全部 codename 目录与全部角色名。**那句注释描述的策略,
它自己的邻居不执行。**

重新核过之后边界是这样的,这个文件把它变成可执行的:

* **授权**(哪个角色有哪些 codename)对非 ADMIN 关闭 —— 只有两条读取路径,
  一条只给自己,一条只给 ADMIN;
* **角色名单**(角色叫什么、每个角色几个人)对任何登录用户开放;
* **codename 目录**只给 ADMIN 与持 system.settings / menu.manage 的人(2026-10-29,RBAC 审查 L4)。

后两条是产品决定。把它写成测试,是为了下一次有人改动时**是这里报红**,
而不是几年后某份审计报告里再出现一次「注释与代码不一致」。
"""
import pytest
from rest_framework.test import APIClient

from apps.authentication.models import User, UserRole
from apps.perm.models import Permission, Role
from apps.tenants.models import Tenant


@pytest.fixture
def viewer(db):
    tenant, _ = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "CN_DIYU"}
    )
    Role.objects.get_or_create(name=UserRole.ADMIN, defaults={"display_name": "管理员"})
    Role.objects.get_or_create(name=UserRole.VIEWER, defaults={"display_name": "查看者"})
    Permission.objects.get_or_create(
        codename="soul.read", defaults={"name": "读取灵魂", "category": "soul"}
    )
    user = User.objects.create_user(
        username="a-viewer", password="x", role=UserRole.VIEWER, tenant=tenant
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
def test_a_viewer_cannot_read_another_roles_grants(viewer):
    """**这是真正的边界。** 它成立;上面那句注释声称的就是它。"""
    response = viewer.get(f"/api/v1/perm/roles/{UserRole.ADMIN}/permissions/")
    assert response.status_code == 403, (
        f"VIEWER 读到了 ADMIN 的授权:{response.status_code} {response.data}"
    )


@pytest.mark.django_db
def test_a_viewer_reads_its_own_grants_and_only_its_own(viewer):
    response = viewer.get("/api/v1/perm/role-permissions/")
    assert response.status_code == 200
    assert response.data["role"] == UserRole.VIEWER, response.data


@pytest.mark.django_db
def test_the_role_names_are_open_to_any_authenticated_user(viewer):
    """角色名单仍对任何登录用户开放(下面那条守着它不带授权)。"""
    assert viewer.get("/api/v1/perm/roles/").status_code == 200


@pytest.mark.django_db
def test_the_codename_catalogue_is_closed_to_a_plain_viewer(viewer):
    """2026-10-29(RBAC 审查 L4):codename 目录只给 ADMIN 与持 system.settings / menu.manage 的人 ——
    调它的只有权限页与菜单编辑页。此前 `[IsAuthenticated]`,VIEWER 拿得到全部目录。"""
    assert viewer.get("/api/v1/perm/permissions/").status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize("codename", ["menu.manage", "system.settings"])
def test_a_custom_role_holding_a_page_codename_reads_the_catalogue(viewer, codename):
    """菜单编辑页的闸是 `menu.manage`、权限页是 `system.settings`:持其一的自定义角色照样拿到目录,
    不持的(同一租户、同一请求)拿不到 —— 两页都不被这道门打断。"""
    from apps.perm.cache import invalidate_all_permissions
    from apps.perm.models import RolePermission

    role = Role.objects.create(name="CATALOGUER", display_name="CATALOGUER")
    perm, _ = Permission.objects.get_or_create(codename=codename, defaults={"name": codename, "category": "system"})
    Permission.objects.get_or_create(codename="menu.manage", defaults={"name": "m", "category": "system"})
    Permission.objects.get_or_create(codename="system.settings", defaults={"name": "s", "category": "system"})
    RolePermission.objects.create(role=role, permission=perm)
    invalidate_all_permissions()
    holder = User.objects.create_user(username="cataloguer", password="x", role="CATALOGUER",
                                      tenant=Tenant.objects.get(code="CN_DIYU"))
    client = APIClient()
    client.force_authenticate(user=holder)
    response = client.get("/api/v1/perm/permissions/")
    assert response.status_code == 200
    assert codename in {row["codename"] for row in response.data}
    assert viewer.get("/api/v1/perm/permissions/").status_code == 403


@pytest.mark.django_db
def test_the_role_listing_does_not_carry_the_grants(viewer):
    """`list_roles` 开放的前提是它不带授权。**这条守着那个前提。**

    给 `RoleSerializer` 加一个 `permissions` 字段,会让上面那条「目录开放」
    从一个无害的决定变成一个越权读 —— 而它自己不会红。
    """
    response = viewer.get("/api/v1/perm/roles/")
    assert response.status_code == 200
    leaked = [row for row in response.data if "permissions" in row]
    assert leaked == [], (
        f"角色列表带上了授权,而它对任何登录用户开放:{leaked}"
    )
