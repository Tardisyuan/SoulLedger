"""自建角色是一等角色:能被持有、能删进回收站再恢复。(「能改名并级联」于 2026-09-24
被「角色 code 创建后不可改」取代,见下文 BP-07 一节。)

2026-09-12 审计 BP-06 / BP-07 / BP-11,用户决策「允许改名并级联」。修之前:

  BP-11  `User.role` 是 `choices=UserRole` 的字符串,`assign_roles` / 建用户 /
         CSV 导入都按固定枚举校验 → `roles/create/` 建出来的角色**没有任何人能持有**。
  BP-07  PUT `/perm/roles/<pk>/` 允许改 `name`;信号只失效**新**名字的缓存,旧名
         300s 内照旧通过;之后所有持旧名的用户被全拒,而他们的 `User.role` 没人改。
  BP-06  Role/Permission 软删除,但 `name`/`codename` 是无条件 `unique=True`:
         删掉 VIEWER 之后 `roles/init/` 500、`roles/create/` 400「已存在」,回收站
         只注册了 soul / menu —— 没有任何恢复路径。

内置角色(`UserRole` 的五个成员)是例外:代码里直接比较 `'ADMIN'` 等字面量
(数字见提交信息),改名会让这些比较全部失效,所以它们的 `name` 不可改、行不可删。
"""
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User, UserRole
from apps.perm.cache import invalidate_all_permissions
from apps.perm.checker import check_permission
from apps.perm.models import Permission, Role, RolePermission
from apps.perm.services import RoleHolder
from apps.tenants.models import Tenant

ROLES = "/api/v1/perm/roles/"


def _client_for(user, tenant):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def world(db):
    invalidate_all_permissions()
    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    for name in UserRole.values:
        Role.objects.get_or_create(name=name, defaults={"display_name": name.title()})
    admin = User.objects.create_user(username="cr_admin", password="x", role="ADMIN", tenant=tenant)
    scribe = Role.objects.create(name="SCRIBE", display_name="书记")
    perm, _ = Permission.objects.get_or_create(
        codename="ledger.read", defaults={"name": "查看功德", "category": "ledger"}
    )
    RolePermission.objects.get_or_create(role=scribe, permission=perm)
    return {"tenant": tenant, "admin": admin, "scribe": scribe, "client": _client_for(admin, tenant)}


# ── BP-11: a custom role can be held ─────────────────────────────────────


@pytest.mark.django_db
def test_assign_roles_accepts_a_role_that_exists_in_the_table(world):
    user = User.objects.create_user(username="cr_holder", password="x", role="VIEWER", tenant=world["tenant"])
    response = world["client"].post(f"/api/v1/users/{user.pk}/assign_roles/", {"role": "SCRIBE"}, format="json")
    assert response.status_code == 200, response.content
    user.refresh_from_db()
    assert user.role == "SCRIBE"


@pytest.mark.django_db
def test_assign_roles_still_rejects_a_name_with_no_role_row(world):
    user = User.objects.create_user(username="cr_holder2", password="x", role="VIEWER", tenant=world["tenant"])
    response = world["client"].post(f"/api/v1/users/{user.pk}/assign_roles/", {"role": "NOBODY"}, format="json")
    assert response.status_code == 400, response.content
    user.refresh_from_db()
    assert user.role == "VIEWER"


@pytest.mark.django_db
def test_assign_roles_rejects_a_soft_deleted_role(world):
    """回收站里的角色不是可持有的角色 —— 「按 Role 表中未删除的角色名校验」的另一半。"""
    world["scribe"].soft_delete()
    user = User.objects.create_user(username="cr_holder3", password="x", role="VIEWER", tenant=world["tenant"])
    response = world["client"].post(f"/api/v1/users/{user.pk}/assign_roles/", {"role": "SCRIBE"}, format="json")
    assert response.status_code == 400, response.content


@pytest.mark.django_db
def test_creating_a_user_with_a_custom_role_works(world):
    response = world["client"].post(
        "/api/v1/users/",
        {"username": "cr_new", "email": "cr_new@example.com", "password": "LongEnough123", "role": "SCRIBE"},
        format="json",
    )
    assert response.status_code == 201, response.content
    assert User.objects.get(username="cr_new").role == "SCRIBE"


@pytest.mark.django_db
def test_creating_a_user_with_an_unknown_role_is_a_400(world):
    response = world["client"].post(
        "/api/v1/users/",
        {"username": "cr_bad", "email": "cr_bad@example.com", "password": "LongEnough123", "role": "NOBODY"},
        format="json",
    )
    assert response.status_code == 400, response.content
    assert "role" in response.data
    assert not User.objects.filter(username="cr_bad").exists()


@pytest.mark.django_db
def test_csv_import_accepts_a_custom_role(world):
    csv_file = SimpleUploadedFile(
        "users.csv",
        b"username,email,role,password\ncsv_scribe,csv@example.com,SCRIBE,LongEnough123\n",
        content_type="text/csv",
    )
    response = world["client"].post("/api/v1/users/import_csv/", {"file": csv_file}, format="multipart")
    assert response.status_code == 200, response.content
    assert response.data["created"] == 1, response.data
    assert User.objects.get(username="csv_scribe").role == "SCRIBE"


@pytest.mark.django_db
def test_a_custom_role_holder_gets_the_roles_grants(world):
    """持有它得有意义:checker 对这个角色名要按 RolePermission 作答。"""
    user = User.objects.create_user(username="cr_scribe", password="x", role="SCRIBE", tenant=world["tenant"])
    assert check_permission(user, "ledger.read") is True
    assert check_permission(user, "soul.delete") is False


# ── BP-07 superseded: a role's code is immutable ─────────────────────────
#
# 2026-09-12 the decision was "allow rename and cascade"; 2026-09-24 (the
# permissions-page redesign) made every role's code immutable instead, so the
# three rename-cascade tests that stood here are gone with the cascade. The
# refusal itself is pinned in tests/test_perm_matrix_and_role_table.py.


@pytest.mark.django_db
def test_renaming_a_custom_role_is_refused_and_moves_nobody(world):
    holder = User.objects.create_user(username="cr_rename_holder", password="x", role="SCRIBE", tenant=world["tenant"])
    response = world["client"].put(
        f"{ROLES}{world['scribe'].pk}/", {"name": "ARCHIVIST", "display_name": "档案官"}, format="json"
    )
    assert response.status_code == 400, response.content
    world["scribe"].refresh_from_db()
    holder.refresh_from_db()
    assert world["scribe"].name == "SCRIBE"
    assert world["scribe"].display_name == "书记", "被拒的请求改了别的字段"
    assert holder.role == "SCRIBE"
    assert check_permission(RoleHolder("SCRIBE"), "ledger.read") is True


@pytest.mark.django_db
@pytest.mark.parametrize("builtin", UserRole.values)
def test_a_builtin_roles_name_is_read_only(world, builtin):
    role = Role.objects.get(name=builtin)
    response = world["client"].put(f"{ROLES}{role.pk}/", {"name": "SOMETHING_ELSE"}, format="json")
    assert response.status_code == 400, response.content
    assert "cannot be changed" in str(response.data), response.data
    role.refresh_from_db()
    assert role.name == builtin


@pytest.mark.django_db
def test_a_builtin_roles_other_fields_still_update(world):
    role = Role.objects.get(name="VIEWER")
    response = world["client"].put(
        f"{ROLES}{role.pk}/", {"name": "VIEWER", "display_name": "访客(改)"}, format="json"
    )
    assert response.status_code == 200, response.content
    role.refresh_from_db()
    assert role.display_name == "访客(改)"


# ── BP-06: delete → recycle bin → restore ────────────────────────────────


@pytest.mark.django_db
@pytest.mark.parametrize("builtin", UserRole.values)
def test_a_builtin_role_cannot_be_deleted(world, builtin):
    role = Role.objects.get(name=builtin)
    response = world["client"].delete(f"{ROLES}{role.pk}/")
    assert response.status_code == 400, response.content
    role.refresh_from_db()
    assert role.is_deleted is False


@pytest.mark.django_db
def test_a_role_still_held_cannot_be_deleted_and_the_count_is_reported(world):
    User.objects.create_user(username="cr_h1", password="x", role="SCRIBE", tenant=world["tenant"])
    User.objects.create_user(username="cr_h2", password="x", role="SCRIBE", tenant=world["tenant"])
    response = world["client"].delete(f"{ROLES}{world['scribe'].pk}/")
    assert response.status_code == 400, response.content
    assert response.data.get("user_count") == 2, response.data
    world["scribe"].refresh_from_db()
    assert world["scribe"].is_deleted is False


@pytest.mark.django_db
def test_deleting_an_unheld_role_puts_it_and_its_grants_in_the_bin(world):
    role = world["scribe"]
    response = world["client"].delete(f"{ROLES}{role.pk}/")
    assert response.status_code == 204, response.content
    role.refresh_from_db()
    assert role.is_deleted is True
    # The grant went with it under the same cascade id, so a restore brings it back.
    grants = RolePermission.all_objects.filter(role=role)
    assert grants.count() == 1
    assert grants.first().is_deleted is True
    assert grants.first().delete_cascade_id == role.delete_cascade_id

    listing = world["client"].get("/api/v1/recycle-bin/")
    assert listing.status_code == 200
    entries = [(e["entity_type"], e["id"]) for e in listing.data["results"]]
    assert ("role", role.pk) in entries, entries

    restored = world["client"].post(
        "/api/v1/recycle-bin/restore/", {"cascade_id": str(role.delete_cascade_id)}, format="json"
    )
    assert restored.status_code == 200, restored.content
    role.refresh_from_db()
    assert role.is_deleted is False
    assert RolePermission.objects.filter(role=role).count() == 1


@pytest.mark.django_db
def test_init_roles_revives_a_binned_builtin_instead_of_500(world):
    viewer = Role.objects.get(name="VIEWER")
    # Straight through the model, the way a shell or the admin would do it.
    viewer.soft_delete()
    assert not Role.objects.filter(name="VIEWER").exists()

    response = world["client"].post(f"{ROLES}init/")
    assert response.status_code == 200, response.content
    alive = Role.objects.filter(name="VIEWER")
    assert alive.count() == 1, "既没有恢复旧行,也没有建新行"
    assert alive.first().pk == viewer.pk, "建了第二行而不是恢复回收站里的那一行"


@pytest.mark.django_db
def test_creating_a_role_whose_name_sits_in_the_bin_points_at_the_bin(world):
    world["scribe"].soft_delete()
    response = world["client"].post(f"{ROLES}create/", {"name": "SCRIBE", "display_name": "x"}, format="json")
    assert response.status_code == 400, response.content
    assert "recycle" in str(response.data).lower() or "回收站" in str(response.data), response.data
    assert Role.all_objects.filter(name="SCRIBE").count() == 1


@pytest.mark.django_db
def test_a_deleted_permission_codename_can_be_created_again(world):
    """Permission 没进回收站,所以对它,「重建同名」就是恢复。"""
    perm = Permission.objects.get(codename="ledger.read")
    perm.soft_delete()
    response = world["client"].post(
        "/api/v1/perm/permissions/create/",
        {"codename": "ledger.read", "name": "查看功德(重建)", "category": "ledger"},
        format="json",
    )
    assert response.status_code == 201, response.content
    alive = Permission.objects.filter(codename="ledger.read")
    assert alive.count() == 1
    assert alive.first().pk == perm.pk, "建了第二行而不是复活软删除的那一行"
    assert alive.first().name == "查看功德(重建)"


@pytest.mark.django_db
def test_the_role_serializer_says_which_roles_are_builtin(world):
    response = world["client"].get(ROLES)
    assert response.status_code == 200
    by_name = {r["name"]: r for r in response.data}
    assert by_name["ADMIN"]["is_builtin"] is True
    assert by_name["SCRIBE"]["is_builtin"] is False
