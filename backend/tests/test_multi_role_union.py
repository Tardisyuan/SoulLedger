"""One officer, several roles: permissions are the union (2026-10-09).

`User.role` is the primary role (ADMIN bypass, tenant exemption, ranking);
`User.extra_roles` are additional role names. `check_permission` answers True
when ANY held role grants the codename -- unless a hard rule forbids it:

* a codename in `ROLE_FORBIDDEN_CODENAMES` for ANY held role is denied outright
  (per role: a 殿主 who is also 判官 CAN approve, through 判官);
* ADMIN / SOUL are never accepted as additional roles (API 400, checker ignores);
* recycle-bin restore / hard delete stay ADMIN's act, whatever a second role holds.

The permission cache is keyed (role, codename) with no user in the key, so
changing a user's roles needs no invalidation: the next call re-reads the user.
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditAction, AuditLog
from apps.authentication.models import User, UserRole
from apps.menus.models import Menu
from apps.perm.cache import invalidate_all_permissions
from apps.perm.checker import ROLE_FORBIDDEN_CODENAMES, check_permission
from apps.perm.models import Permission, Role, RolePermission
from apps.perm.services import get_role_permission_codenames
from apps.tenants.models import Tenant

# JUDGE holds it (and judgment.create), VIEWER does not.
JUDGE_ONLY = "judgment.create"
APPROVE = "workflow.approve"  # JUDGE holds it; MODERATOR may never


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
    admin = User.objects.create_user(username="mr_admin", password="x", role="ADMIN", tenant=tenant)
    yield {"tenant": tenant, "admin": admin, "client": _client(admin)}
    invalidate_all_permissions()


def _user(world, name, role, extra=()):
    return User.objects.create_user(
        username=name, password="x", role=role, tenant=world["tenant"], extra_roles=list(extra)
    )


def _custom_role(name, *codenames):
    role, _ = Role.objects.get_or_create(name=name, defaults={"display_name": name})
    for c in codenames:
        perm, _ = Permission.objects.get_or_create(codename=c, defaults={"name": c, "category": c.split(".")[0]})
        RolePermission.objects.get_or_create(role=role, permission=perm)
    invalidate_all_permissions()
    return role


def _assign(world, user, body):
    return world["client"].post(f"/api/v1/users/{user.pk}/assign_roles/", body, format="json")


def test_the_premise_two_roles_that_disagree(world):
    assert check_permission(_user(world, "p_judge", "JUDGE"), JUDGE_ONLY)
    assert not check_permission(_user(world, "p_viewer", "VIEWER"), JUDGE_ONLY)
    assert "workflow.approve" not in ROLE_FORBIDDEN_CODENAMES.get("JUDGE", ())
    assert APPROVE in ROLE_FORBIDDEN_CODENAMES["MODERATOR"]


def test_union_grants_what_either_role_grants(world):
    user = _user(world, "u_union", "VIEWER", extra=["JUDGE"])
    assert check_permission(user, JUDGE_ONLY)  # from the extra role
    assert check_permission(user, "soul.read")  # from the primary role
    assert not check_permission(user, "user.manage")  # neither grants it


def test_union_includes_a_custom_role(world):
    _custom_role("AUDITOR", "ledger.manage")
    plain = _user(world, "u_plain", "VIEWER")
    both = _user(world, "u_both", "VIEWER", extra=["AUDITOR"])
    assert not check_permission(plain, "ledger.manage")
    assert check_permission(both, "ledger.manage")


def test_a_role_in_the_recycle_bin_no_longer_counts(world):
    role = _custom_role("TEMPR", "ledger.manage")
    user = _user(world, "u_binned", "VIEWER", extra=["TEMPR"])
    assert check_permission(user, "ledger.manage")
    role.soft_delete()
    invalidate_all_permissions()
    assert not check_permission(user, "ledger.manage")


def test_reported_codenames_follow_the_union(world):
    held = set(get_role_permission_codenames("VIEWER", ["JUDGE"]))
    assert JUDGE_ONLY in held
    assert JUDGE_ONLY not in set(get_role_permission_codenames("VIEWER"))
    user = _user(world, "u_report", "VIEWER", extra=["JUDGE"])
    res = _client(user).get("/api/v1/perm/role-permissions/")
    assert res.status_code == 200 and JUDGE_ONLY in res.json()["permissions"], res.content


# --- hard rules beat the union ---------------------------------------------


def test_moderator_alone_is_still_refused_its_forbidden_codenames(world):
    mod = _user(world, "h_mod", "MODERATOR")
    for codename in ROLE_FORBIDDEN_CODENAMES["MODERATOR"]:
        assert not check_permission(mod, codename), codename
    # a moderator with extras that grant none of them is refused too
    mod_viewer = _user(world, "h_mod_viewer", "MODERATOR", extra=["VIEWER"])
    for codename in ROLE_FORBIDDEN_CODENAMES["MODERATOR"]:
        assert not check_permission(mod_viewer, codename), codename


def test_moderator_plus_judge_approves_and_advances_through_judge(world):
    # Forbidden codenames are per role: they remove only what the MODERATOR role itself grants.
    both = _user(world, "h_mod_judge", "MODERATOR", extra=["JUDGE"])
    assert check_permission(both, APPROVE) and check_permission(both, "workflow.advance")
    # the same holds with the roles the other way round
    both2 = _user(world, "h_judge_mod", "JUDGE", extra=["MODERATOR"])
    assert check_permission(both2, APPROVE) and check_permission(both2, "workflow.advance")
    # what no held role grants stays refused: JUDGE does not hold user.manage
    assert not check_permission(both, "user.manage")


def test_a_custom_role_granting_a_forbidden_codename_counts_for_a_moderator(world):
    _custom_role("APPROVER", APPROVE)
    assert check_permission(_user(world, "h_mod_custom", "MODERATOR", extra=["APPROVER"]), APPROVE)
    assert not check_permission(_user(world, "h_mod_only", "MODERATOR"), APPROVE)


def test_admin_and_soul_are_not_accepted_as_additional_roles(world):
    target = _user(world, "h_target", "VIEWER")
    assert _assign(world, target, {"extra_roles": ["ADMIN"]}).status_code == 400
    assert _assign(world, target, {"extra_roles": ["SOUL"]}).status_code == 400
    assert _assign(world, target, {"role": "ADMIN", "extra_roles": ["JUDGE"]}).status_code == 400
    target.refresh_from_db()
    assert target.extra_roles == [] and target.role == "VIEWER"


def test_the_checker_ignores_admin_written_into_extra_roles_behind_the_api(world):
    # Written straight to the row (the API refuses it): still no bypass.
    user = _user(world, "h_sneaky", "VIEWER", extra=["ADMIN"])
    assert not check_permission(user, "user.manage")
    assert not check_permission(user, "recycle_bin.restore")


def test_a_soul_account_holds_nothing_whatever_it_lists(world):
    soul = User.objects.create_user(username="h_soul", password="x", role="SOUL", extra_roles=["JUDGE"])
    assert not check_permission(soul, JUDGE_ONLY)


def test_admin_only_endpoints_stay_closed_to_a_user_with_many_roles(world):
    user = _user(world, "h_many", "MODERATOR", extra=["JUDGE", "GUARDIAN"])
    assert _client(user).get("/api/v1/users/").status_code == 403  # IsAdminPermission: role == ADMIN
    assert _client(user).post("/api/v1/users/batch_deactivate/", {"user_ids": [1]}, format="json").status_code == 403


def test_recycle_bin_restore_stays_admin_only_even_with_a_stray_grant_on_an_extra_role(world):
    restore, _ = Permission.objects.get_or_create(
        codename="recycle_bin.restore", defaults={"name": "restore", "category": "system"}
    )
    role = _custom_role("BINNER")
    RolePermission.objects.create(role=role, permission=restore)
    invalidate_all_permissions()
    menu = Menu.objects.create(name="旧菜单", path="/old-mr")
    menu.soft_delete()
    menu.refresh_from_db()
    user = _user(world, "h_bin", "JUDGE", extra=["BINNER"])
    res = _client(user).post("/api/v1/recycle-bin/restore/", {"cascade_id": str(menu.delete_cascade_id)}, format="json")
    assert res.status_code == 403, res.content
    assert Menu.all_objects.get(pk=menu.pk).is_deleted


# --- cache -------------------------------------------------------------------


def test_assigning_a_role_takes_effect_with_a_warm_cache_and_no_invalidation(world):
    user = _user(world, "c_user", "VIEWER")
    assert not check_permission(user, JUDGE_ONLY)  # warms (VIEWER, codename) -> False
    assert check_permission(_user(world, "c_other", "JUDGE"), JUDGE_ONLY)  # warms (JUDGE, codename) -> True
    assert _assign(world, user, {"extra_roles": ["JUDGE"]}).status_code == 200
    user.refresh_from_db()
    assert check_permission(user, JUDGE_ONLY)
    assert _assign(world, user, {"extra_roles": []}).status_code == 200
    user.refresh_from_db()
    assert not check_permission(user, JUDGE_ONLY)


def test_a_grant_change_on_an_extra_role_reaches_its_holders(world):
    role = _custom_role("LATER")
    user = _user(world, "c_later", "VIEWER", extra=["LATER"])
    assert not check_permission(user, "ledger.manage")  # warm False
    perm, _ = Permission.objects.get_or_create(
        codename="ledger.manage", defaults={"name": "ledger.manage", "category": "ledger"}
    )
    RolePermission.objects.create(role=role, permission=perm)  # the audit signal invalidates the role
    assert check_permission(user, "ledger.manage")


# --- API: permission, validation, audit --------------------------------------


def test_assign_roles_sets_primary_and_extras_and_own_roles_reads_them(world):
    target = _user(world, "a_target", "VIEWER")
    _custom_role("AUDITOR", "ledger.manage")
    res = _assign(world, target, {"role": "GUARDIAN", "extra_roles": ["JUDGE", "AUDITOR", "JUDGE", "GUARDIAN"]})
    assert res.status_code == 200, res.content
    assert res.json()["role"] == "GUARDIAN" and res.json()["extra_roles"] == ["JUDGE", "AUDITOR"]
    own = world["client"].get(f"/api/v1/users/{target.pk}/own_roles/").json()
    assert own == {"role": "GUARDIAN", "extra_roles": ["JUDGE", "AUDITOR"]}
    # list rows carry the chips' data
    rows = world["client"].get("/api/v1/users/").json()
    rows = rows["results"] if isinstance(rows, dict) else rows
    assert next(r for r in rows if r["id"] == target.pk)["extra_roles"] == ["JUDGE", "AUDITOR"]


def test_assign_roles_sending_only_role_keeps_the_extras(world):
    target = _user(world, "a_keep", "VIEWER", extra=["JUDGE"])
    assert _assign(world, target, {"role": "GUARDIAN"}).status_code == 200
    target.refresh_from_db()
    assert target.role == "GUARDIAN" and target.extra_roles == ["JUDGE"]


def test_assign_roles_refuses_unknown_empty_and_non_list_bodies(world):
    target = _user(world, "a_bad", "VIEWER")
    assert _assign(world, target, {"extra_roles": ["NOPE"]}).status_code == 400
    assert _assign(world, target, {}).status_code == 400
    assert _assign(world, target, {"extra_roles": "JUDGE"}).status_code == 400


def test_assign_roles_is_admin_only(world):
    target = _user(world, "a_target2", "VIEWER")
    mod = _user(world, "a_mod", "MODERATOR")
    res = _client(mod).post(f"/api/v1/users/{target.pk}/assign_roles/", {"extra_roles": ["JUDGE"]}, format="json")
    assert res.status_code == 403
    target.refresh_from_db()
    assert target.extra_roles == []


def test_a_role_change_is_audited_with_the_extra_roles_diff(world):
    target = _user(world, "a_audit", "VIEWER")
    AuditLog.objects.all().delete()
    assert _assign(world, target, {"extra_roles": ["JUDGE"]}).status_code == 200
    rows = AuditLog.objects.filter(action=AuditAction.UPDATE, resource_id=str(target.pk), resource="authentication.user")
    changes = [r.changes for r in rows if r.changes and "extra_roles" in r.changes]
    assert changes, list(rows.values("resource", "changes"))
    assert "JUDGE" in changes[0]["extra_roles"][1]


def test_batch_deactivate_and_activate_are_audited_and_skip_admins_and_self(world):
    a = _user(world, "b_a", "JUDGE")
    b = _user(world, "b_b", "VIEWER")
    other_admin = _user(world, "b_admin2", "ADMIN")
    AuditLog.objects.all().delete()
    ids = [a.pk, b.pk, other_admin.pk, world["admin"].pk]
    res = world["client"].post("/api/v1/users/batch_deactivate/", {"user_ids": ids}, format="json")
    assert res.status_code == 200 and res.json() == {"updated": 2}
    assert not User.objects.get(pk=a.pk).is_active and not User.objects.get(pk=b.pk).is_active
    assert User.objects.get(pk=other_admin.pk).is_active
    row = AuditLog.objects.get(action=AuditAction.BATCH_UPDATE)
    assert row.changes["details"] == {"is_active": False} and row.changes["resource_count"] == 2

    res = world["client"].post("/api/v1/users/batch_activate/", {"user_ids": ids}, format="json")
    assert res.json() == {"updated": 2}
    assert User.objects.get(pk=a.pk).is_active
    assert AuditLog.objects.filter(action=AuditAction.BATCH_UPDATE).count() == 2


def test_batch_without_ids_is_400_and_writes_no_audit(world):
    AuditLog.objects.all().delete()
    res = world["client"].post("/api/v1/users/batch_activate/", {"user_ids": []}, format="json")
    assert res.status_code == 400
    assert not AuditLog.objects.filter(action=AuditAction.BATCH_UPDATE).exists()


def test_menu_visibility_counts_extra_roles(world):
    from apps.menus.access import menu_is_visible_to

    menu = Menu.objects.create(name="判官页", path="/judge-only-mr", roles=["JUDGE"])
    assert not menu_is_visible_to(menu, _user(world, "m_viewer", "VIEWER"))
    assert menu_is_visible_to(menu, _user(world, "m_both", "VIEWER", extra=["JUDGE"]))
