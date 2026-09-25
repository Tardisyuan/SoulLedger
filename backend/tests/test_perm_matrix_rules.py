"""Permission-matrix rules decided by the product owner on 2026-09-25.

* ADMIN always has everything: a revoke on an ADMIN cell is refused
  (`admin_always_all`) and nothing is written.
* MODERATOR may never hold workflow.approve / workflow.advance / user.manage:
  a server rule on the same footing as the recycle-bin ADMIN-only one —
  refused by the matrix (`role_forbidden_permission`), `assign` and import,
  and denied by `check_permission` whatever the grant table says.
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User, UserRole
from apps.perm.cache import invalidate_all_permissions
from apps.perm.checker import check_permission
from apps.perm.export import import_permissions
from apps.perm.models import Permission, Role, RolePermission
from apps.perm.services import RoleHolder
from apps.tenants.models import Tenant

CHANGES = "/api/v1/perm/role-permissions/changes/"
FORBIDDEN = ("workflow.approve", "workflow.advance", "user.manage")
CODENAMES = ("soul.read", "soul.update", *FORBIDDEN)
ASSIGN = "/api/v1/perm/role-permissions/assign/"


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
        c: Permission.objects.get_or_create(codename=c, defaults={"name": c, "category": "soul"})[0]
        for c in CODENAMES
    }
    admin = User.objects.create_user(username="rules_admin", password="x", role="ADMIN", tenant=tenant)
    yield {"tenant": tenant, "perms": perms, "admin": admin, "client": _client(admin)}
    invalidate_all_permissions()


def _held(role, codename):
    return RolePermission.objects.filter(role__name=role, permission__codename=codename).exists()


def _post(world, changes, **extra):
    res = world["client"].post(CHANGES, {"changes": changes, **extra}, format="json")
    assert res.status_code == 200, res.content
    return res.json()


# ── 1. ADMIN always has everything ─────────────────────────────────────


def test_a_revoke_on_an_admin_cell_is_refused_and_nothing_is_written(world):
    admin_role = Role.objects.get(name="ADMIN")
    RolePermission.objects.get_or_create(role=admin_role, permission=world["perms"]["soul.read"])
    version = Role.objects.get(name="ADMIN").version
    body = _post(world, [
        {"role": "ADMIN", "permission_id": world["perms"]["soul.read"].pk, "action": "revoke"},
        {"role": "JUDGE", "permission_id": world["perms"]["soul.update"].pk, "action": "grant"},
    ])
    got = [(r["role"], r["status"], r["code"]) for r in body["results"]]
    assert got == [("ADMIN", "refused", "admin_always_all"), ("JUDGE", "saved", None)]
    assert body["refused"] == 1 and body["saved"] == 1
    assert _held("ADMIN", "soul.read")
    assert Role.objects.get(name="ADMIN").version == version  # no write, no version bump


def test_the_whole_set_assign_refuses_removing_any_admin_row(world):
    admin_role = Role.objects.get(name="ADMIN")
    p = world["perms"]
    for c in ("soul.read", "soul.update"):
        RolePermission.objects.get_or_create(role=admin_role, permission=p[c])
    version = Role.objects.get(name="ADMIN").version

    res = world["client"].post(ASSIGN, {"role": "ADMIN", "permission_ids": [p["soul.read"].pk]}, format="json")
    assert res.status_code == 400, res.content
    assert res.json()["code"] == "admin_always_all" and "soul.update" in res.json()["error"]
    assert _held("ADMIN", "soul.read") and _held("ADMIN", "soul.update")
    assert Role.objects.get(name="ADMIN").version == version

    # A superset still saves, and another role's shrink is not ADMIN's rule.
    held = set(RolePermission.objects.filter(role=admin_role).values_list("permission_id", flat=True))
    everything = sorted(held | {p[c].pk for c in CODENAMES})
    ok = world["client"].post(ASSIGN, {"role": "ADMIN", "permission_ids": everything}, format="json")
    assert ok.status_code == 200, ok.content
    assert all(_held("ADMIN", c) for c in CODENAMES)
    RolePermission.objects.get_or_create(role=Role.objects.get(name="JUDGE"), permission=p["soul.update"])
    shrink = world["client"].post(ASSIGN, {"role": "JUDGE", "permission_ids": []}, format="json")
    assert shrink.status_code == 200, shrink.content
    assert not _held("JUDGE", "soul.update")


def test_a_grant_to_admin_is_still_accepted(world):
    body = _post(world, [{"role": "ADMIN", "permission_id": world["perms"]["soul.update"].pk, "action": "grant"}])
    assert [r["status"] for r in body["results"]] == ["saved"]
    assert _held("ADMIN", "soul.update")


# ── 3. MODERATOR is forbidden workflow.approve / workflow.advance / user.manage ─


def test_the_matrix_refuses_the_forbidden_grants_to_moderator_cell_by_cell(world):
    Role.objects.create(name="CLERK", display_name="书吏")
    p = world["perms"]
    body = _post(world, [
        *({"role": "MODERATOR", "permission_id": p[c].pk, "action": "grant"} for c in FORBIDDEN),
        {"role": "MODERATOR", "permission_id": p["soul.read"].pk, "action": "grant"},
        {"role": "CLERK", "permission_id": p["workflow.approve"].pk, "action": "grant"},
    ])
    assert [(r["role"], r["codename"], r["status"], r["code"]) for r in body["results"]] == [
        ("MODERATOR", "workflow.approve", "refused", "role_forbidden_permission"),
        ("MODERATOR", "workflow.advance", "refused", "role_forbidden_permission"),
        ("MODERATOR", "user.manage", "refused", "role_forbidden_permission"),
        ("MODERATOR", "soul.read", "saved", None),
        ("CLERK", "workflow.approve", "saved", None),  # the rule is MODERATOR's, not the codename's
    ]
    assert not any(_held("MODERATOR", c) for c in FORBIDDEN)


def test_revoking_a_stray_forbidden_grant_from_moderator_is_allowed(world):
    moderator = Role.objects.get(name="MODERATOR")
    RolePermission.objects.create(role=moderator, permission=world["perms"]["user.manage"])
    body = _post(world, [{"role": "MODERATOR", "permission_id": world["perms"]["user.manage"].pk, "action": "revoke"}])
    assert [r["status"] for r in body["results"]] == ["saved"]
    assert not _held("MODERATOR", "user.manage")


def test_the_whole_set_assign_refuses_them_for_moderator(world):
    p = world["perms"]
    before = set(RolePermission.objects.filter(role__name="MODERATOR").values_list("permission_id", flat=True))
    res = world["client"].post(
        ASSIGN, {"role": "MODERATOR", "permission_ids": [p["soul.read"].pk, p["workflow.advance"].pk]}, format="json"
    )
    assert res.status_code == 400 and res.json()["code"] == "role_forbidden_permission", res.content
    after = set(RolePermission.objects.filter(role__name="MODERATOR").values_list("permission_id", flat=True))
    assert after == before


def test_an_import_does_not_grant_them_to_moderator(world):
    import_permissions({"role_permissions": [
        {"role": "MODERATOR", "permission": "workflow.approve"},
        {"role": "MODERATOR", "permission": "soul.update"},
    ]})
    assert _held("MODERATOR", "soul.update") and not _held("MODERATOR", "workflow.approve")


def test_an_overwrite_import_keeps_every_admin_row(world):
    admin = Role.objects.get(name="ADMIN")
    for c in CODENAMES:
        RolePermission.objects.get_or_create(role=admin, permission=world["perms"][c])
    RolePermission.objects.get_or_create(role=Role.objects.get(name="JUDGE"), permission=world["perms"]["soul.update"])
    before = set(RolePermission.objects.filter(role=admin).values_list("permission_id", flat=True))
    assert before
    import_permissions({"role_permissions": [{"role": "JUDGE", "permission": "soul.read"}]}, overwrite=True)
    assert set(RolePermission.objects.filter(role=admin).values_list("permission_id", flat=True)) == before
    # Absence on the other side: overwrite still clears the other roles.
    assert _held("JUDGE", "soul.read") and not _held("JUDGE", "soul.update")


def test_check_permission_denies_moderator_even_with_the_grant_in_the_table(world):
    moderator = Role.objects.get(name="MODERATOR")
    judge = Role.objects.get(name="JUDGE")
    for c in FORBIDDEN:
        RolePermission.objects.create(role=moderator, permission=world["perms"][c])
        RolePermission.objects.get_or_create(role=judge, permission=world["perms"][c])
    invalidate_all_permissions()
    assert [check_permission(RoleHolder("MODERATOR"), c) for c in FORBIDDEN] == [False, False, False]
    # Presence of the other half: the same rows do grant them to JUDGE.
    assert [check_permission(RoleHolder("JUDGE"), c) for c in FORBIDDEN] == [True, True, True]
