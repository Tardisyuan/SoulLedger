"""Recycle-bin restore and hard delete are ADMIN-only as a server rule (2026-09-25).

Two layers: the permission matrix refuses to grant the codenames to any other
role (`admin_only_permission`), and the recycle-bin view refuses a non-ADMIN
caller even when a grant exists in the table anyway.
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User, UserRole
from apps.menus.models import Menu
from apps.perm.cache import invalidate_all_permissions
from apps.perm.export import import_permissions
from apps.perm.models import Permission, Role, RolePermission
from apps.tenants.models import Tenant

ADMIN_ONLY = ("recycle_bin.restore", "recycle_bin.hard_delete")
CODENAMES = (*ADMIN_ONLY, "recycle_bin.read")
CHANGES = "/api/v1/perm/role-permissions/changes/"
ASSIGN = "/api/v1/perm/role-permissions/assign/"
BIN = "/api/v1/recycle-bin/"


def _client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def world(db):
    invalidate_all_permissions()
    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    for name in UserRole.values:
        Role.objects.get_or_create(name=name, defaults={"display_name": name.title()})
    perms = {
        c: Permission.objects.get_or_create(codename=c, defaults={"name": c, "category": "system"})[0]
        for c in CODENAMES
    }
    admin = User.objects.create_user(username="bin_admin", password="x", role="ADMIN", tenant=tenant)
    yield {"tenant": tenant, "perms": perms, "admin": admin, "client": _client(admin)}
    invalidate_all_permissions()


def _held(role, codename):
    return RolePermission.objects.filter(role__name=role, permission__codename=codename).exists()


def test_the_matrix_refuses_admin_only_grants_to_other_roles_cell_by_cell(world):
    perms = world["perms"]
    changes = [
        {"role": "JUDGE", "permission_id": perms["recycle_bin.restore"].pk, "action": "grant"},
        {"role": "JUDGE", "permission_id": perms["recycle_bin.hard_delete"].pk, "action": "grant"},
        {"role": "JUDGE", "permission_id": perms["recycle_bin.read"].pk, "action": "grant"},
        {"role": "ADMIN", "permission_id": perms["recycle_bin.restore"].pk, "action": "grant"},
    ]
    res = world["client"].post(CHANGES, {"changes": changes}, format="json")
    assert res.status_code == 200, res.content
    got = [(r["status"], r["code"]) for r in res.json()["results"]]
    assert got == [
        ("refused", "admin_only_permission"),
        ("refused", "admin_only_permission"),
        ("saved", None),
        ("saved", None),
    ]
    assert not _held("JUDGE", "recycle_bin.restore") and not _held("JUDGE", "recycle_bin.hard_delete")
    assert _held("JUDGE", "recycle_bin.read") and _held("ADMIN", "recycle_bin.restore")


def test_revoking_a_stray_admin_only_grant_is_allowed(world):
    judge = Role.objects.get(name="JUDGE")
    RolePermission.objects.create(role=judge, permission=world["perms"]["recycle_bin.restore"])
    change = {"role": "JUDGE", "permission_id": world["perms"]["recycle_bin.restore"].pk, "action": "revoke"}
    res = world["client"].post(CHANGES, {"changes": [change]}, format="json")
    assert [r["status"] for r in res.json()["results"]] == ["saved"]
    assert not _held("JUDGE", "recycle_bin.restore")


def test_the_whole_set_assign_refuses_them_too(world):
    perms = world["perms"]
    ids = [perms["recycle_bin.read"].pk, perms["recycle_bin.hard_delete"].pk]
    before = set(RolePermission.objects.filter(role__name="MODERATOR").values_list("permission_id", flat=True))
    res = world["client"].post(ASSIGN, {"role": "MODERATOR", "permission_ids": ids}, format="json")
    assert res.status_code == 400 and res.json()["code"] == "admin_only_permission", res.content
    after = set(RolePermission.objects.filter(role__name="MODERATOR").values_list("permission_id", flat=True))
    assert after == before and perms["recycle_bin.hard_delete"].pk not in after
    # ADMIN's own rows stay in the set: dropping any is refused (`admin_always_all`).
    held = list(RolePermission.objects.filter(role__name="ADMIN").values_list("permission_id", flat=True))
    ok = world["client"].post(ASSIGN, {"role": "ADMIN", "permission_ids": [*held, *ids]}, format="json")
    assert ok.status_code == 200, ok.content


def test_a_copy_of_admin_leaves_the_admin_only_codenames_behind(world):
    admin_role = Role.objects.get(name="ADMIN")
    for c in CODENAMES:
        RolePermission.objects.get_or_create(role=admin_role, permission=world["perms"][c])
    res = world["client"].post(f"/api/v1/perm/roles/{admin_role.pk}/copy/",
                               {"name": "BIN_CLERK", "display_name": "回收站书记"}, format="json")
    assert res.status_code == 201, res.content
    assert _held("BIN_CLERK", "recycle_bin.read")
    assert not _held("BIN_CLERK", "recycle_bin.restore") and not _held("BIN_CLERK", "recycle_bin.hard_delete")


def test_an_import_does_not_grant_them_to_other_roles(world):
    import_permissions({"role_permissions": [
        {"role": "JUDGE", "permission": "recycle_bin.restore"},
        {"role": "JUDGE", "permission": "recycle_bin.read"},
    ]})
    assert _held("JUDGE", "recycle_bin.read") and not _held("JUDGE", "recycle_bin.restore")


def test_the_view_refuses_a_non_admin_even_with_the_grant_in_the_table(world):
    moderator_role = Role.objects.get(name="MODERATOR")
    for c in CODENAMES:
        RolePermission.objects.create(role=moderator_role, permission=world["perms"][c])
    invalidate_all_permissions()
    menu = Menu.objects.create(name="旧菜单", path="/old")
    menu.soft_delete()
    menu.refresh_from_db()
    moderator = User.objects.create_user(username="bin_mod", password="x", role="MODERATOR", tenant=world["tenant"])
    client = _client(moderator)

    assert client.get(BIN).status_code == 200  # read is not ADMIN-only
    res = client.post(f"{BIN}restore/", {"cascade_id": str(menu.delete_cascade_id)}, format="json")
    assert res.status_code == 403 and "Only ADMIN" in res.json()["error"], res.content
    res = client.post(f"{BIN}hard-delete/", {"entity_type": "menu", "id": menu.pk}, format="json")
    assert res.status_code == 403 and "Only ADMIN" in res.json()["error"], res.content
    assert Menu.all_objects.get(pk=menu.pk).is_deleted

    res = world["client"].post(f"{BIN}restore/", {"cascade_id": str(menu.delete_cascade_id)}, format="json")
    assert res.status_code == 200 and not Menu.all_objects.get(pk=menu.pk).is_deleted
