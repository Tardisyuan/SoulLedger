"""指派权限这个动作会**收回**没被指派的那些。

`apps/perm/views.py::assign_role_permissions` 是全量替换语义:

    RolePermission.objects.filter(role=role).delete()
    RolePermission.objects.bulk_create(...)

那个 `.delete()` 是「撤销」的唯一实现。删掉它,授权就变成只增不减 —— 一个管理员
把某个角色的权限勾掉再保存,界面会告诉他成功了,而那条授权还在。

**实证:删掉第 202 行那句 `.delete()`,`apps/perm/` + `tests/test_perm_api.py` +
`test_matrix_snapshot.py` 共 410 passed,一条不红。**

原因是唯一一个 POST 空 `permission_ids` 的测试
(`test_matrix_snapshot.py::test_perm_assign_snapshot`,那是一次 VIEWER 全量清空)
**只断言 HTTP 状态码**,从不回查库;而并发守卫那条只在**被拒的 409** 之后查库,
409 根本走不到第 202 行。于是「指派」的两半里,只有「增」被测过。

这个文件补的是另一半,四条,每条都断言**缺席**而不只是在场 ——
「新的那条在」这句话在只增不减的实现下同样为真。
"""
import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.perm.models import Permission, Role, RolePermission

ASSIGN_URL = "/api/v1/perm/role-permissions/assign/"


@pytest.fixture
def admin_client(api_client, admin_user):
    token = RefreshToken.for_user(admin_user)
    if admin_user.tenant:
        token["tenant_code"] = admin_user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return api_client


@pytest.fixture
def role_with_three(db):
    role, _ = Role.objects.get_or_create(name="REVOKE_PROBE", defaults={"display_name": "Revoke Probe Role"})
    perms = []
    for i in range(3):
        p, _ = Permission.objects.get_or_create(
            codename=f"revoke.probe.{i}",
            defaults={"name": f"Revoke Probe {i}", "category": "test"},
        )
        perms.append(p)
        RolePermission.objects.get_or_create(role=role, permission=p)
    return role, perms


def granted(role):
    return set(
        RolePermission.objects.filter(role=role).values_list("permission__codename", flat=True)
    )


@pytest.mark.django_db
def test_assigning_a_smaller_set_removes_what_is_no_longer_in_it(
    admin_client, cn_tenant, role_with_three
):
    role, perms = role_with_three
    assert len(granted(role)) == 3, "前置条件:三条授权真的建起来了"

    response = admin_client.post(
        ASSIGN_URL,
        {"role": role.name, "permission_ids": [perms[0].id]},
        format="json",
    )
    assert response.status_code == 200, response.data

    # 断言的是**缺席**。「revoke.probe.0 还在」这句话在只增不减的实现下同样为真,
    # 所以它一个字都守不住。
    assert granted(role) == {"revoke.probe.0"}
    assert not RolePermission.objects.filter(
        role=role, permission__codename__in=["revoke.probe.1", "revoke.probe.2"]
    ).exists()


@pytest.mark.django_db
def test_assigning_an_empty_set_clears_the_role(admin_client, cn_tenant, role_with_three):
    role, _ = role_with_three

    response = admin_client.post(
        ASSIGN_URL, {"role": role.name, "permission_ids": []}, format="json"
    )
    assert response.status_code == 200, response.data
    assert granted(role) == set()
    # 已有的那条快照测试也 POST 了空集合,但只看状态码。这一行是它缺的那半句。
    assert response.data["assigned_count"] == 0


@pytest.mark.django_db
def test_a_disjoint_set_replaces_rather_than_unions(admin_client, cn_tenant, role_with_three):
    """替换语义与并集语义的区分点。

    上面两条在「只增不减」下会红,但在一个**误判为并集**的实现下,第一条也会红 ——
    两者的区别要靠一个完全不相交的集合才说得清楚。
    """
    role, _ = role_with_three
    fresh, _ = Permission.objects.get_or_create(
        codename="revoke.probe.new",
        defaults={"name": "Fresh", "category": "test"},
    )

    response = admin_client.post(
        ASSIGN_URL, {"role": role.name, "permission_ids": [fresh.id]}, format="json"
    )
    assert response.status_code == 200, response.data
    assert granted(role) == {"revoke.probe.new"}


@pytest.mark.django_db
def test_a_rejected_request_revokes_nothing(admin_client, cn_tenant, role_with_three):
    """反对照。

    没有它,一个「每次请求都先清空」的实现 —— 包括一条走到 `.delete()` 就因为
    某个 ID 非法而返回 400 的路径 —— 同样满足上面三条,而那会在一次失败的保存里
    悄悄清掉整个角色。
    """
    role, perms = role_with_three
    before = granted(role)

    response = admin_client.post(
        ASSIGN_URL,
        {"role": role.name, "permission_ids": [perms[0].id, 99999999]},
        format="json",
    )
    assert response.status_code == 400, response.data
    assert granted(role) == before
