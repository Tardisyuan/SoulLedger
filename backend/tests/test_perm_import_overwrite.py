"""`POST /perm/import/` in overwrite mode - what the dialog's "will delete N" may honestly say.

The importer deletes every field rule, every data scope and every non-ADMIN grant, then
rebuilds from the file. So "deleted first" (7 below) is not "the file does not have them"
(5 below): the dialog's sentence is the second, and these tests pin that the number is the
net - entries that existed and do not afterwards - and that `updated` / `created` are net too.

Also pinned: the dry run leaves nothing, the real import leaves one summary audit row, a
failure in the middle (of the merge or of the audit row) rolls everything back, and
`removes_own_permissions` follows who actually holds the removed entries.
"""
from unittest import mock

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditAction, AuditLog
from apps.authentication.models import User
from apps.perm.export import import_permissions
from apps.perm.models import FieldPermission, Permission, Role, RolePermission, RowLevelDataScope
from apps.tenants.models import Tenant

IMPORT = "/api/v1/perm/import/"


def _client(user, tenant):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def world(db):
    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    # Migrations seed roles and grants; start from a known table instead of counting on them.
    RolePermission.objects.all().delete()
    FieldPermission.objects.all().delete()
    RowLevelDataScope.objects.all().delete()
    admin_role, _ = Role.objects.get_or_create(name="ADMIN", defaults={"display_name": "Admin"})
    judge, _ = Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
    Role.objects.filter(pk=judge.pk).update(description="old", display_name="Judge")
    mod, _ = Role.objects.get_or_create(name="MODERATOR", defaults={"display_name": "Mod"})
    perms = {
        c: Permission.objects.get_or_create(codename=c, defaults={"name": c, "category": "t"})[0]
        for c in ("soul.read", "soul.write", "judgment.read", "system.settings")
    }
    RolePermission.objects.get_or_create(role=admin_role, permission=perms["system.settings"])
    for c in ("soul.read", "soul.write", "judgment.read"):
        RolePermission.objects.create(role=judge, permission=perms[c])
    RolePermission.objects.create(role=mod, permission=perms["soul.read"])
    for f in ("name", "birth_name", "description"):
        FieldPermission.objects.create(role=judge, model_name="soul", field_name=f)
    RowLevelDataScope.objects.create(role=judge, model_name="soul", scope_type="READ")
    RowLevelDataScope.objects.create(role=admin_role, model_name="soul", scope_type="READ")
    FieldPermission.objects.create(role=admin_role, model_name="soul", field_name="name")
    admin = User.objects.create_user(username="ow_admin", password="x", role="ADMIN", tenant=tenant)
    return {"tenant": tenant, "admin": admin, "judge": judge, "admin_role": admin_role}


# The file keeps: JUDGE soul.read (conditions changed), a new JUDGE grant, the `name` field rule
# unchanged, and renames JUDGE's description. It drops: JUDGE soul.write + judgment.read,
# MODERATOR soul.read, two field rules, the JUDGE data scope.
FILE = {
    "permissions": [],
    "roles": [{"name": "JUDGE", "display_name": "Judge", "description": "new", "scope": "ORG"}],
    "role_permissions": [
        {"role": "JUDGE", "permission": "soul.read", "conditions": {"own": True}},  # kept, changed
        {"role": "JUDGE", "permission": "system.settings", "conditions": {}},       # new
    ],
    "field_permissions": [{"role": "JUDGE", "model_name": "soul", "field_name": "name"}],  # kept, same
    "data_scopes": [],
}


def _counts():
    return (RolePermission.objects.count(), FieldPermission.objects.count(), RowLevelDataScope.objects.count())


def test_removed_is_what_the_file_does_not_have_not_what_was_deleted_first(world):
    before = _counts()
    deleted_first = (
        RolePermission.objects.exclude(role__name="ADMIN").count()
        + FieldPermission.objects.count()
        + RowLevelDataScope.objects.count()
    )
    stats = import_permissions(FILE, overwrite=True, dry_run=True)

    # judge: write + judgment.read; moderator: read -> 3 grants. fields: birth_name, description -> 2.
    # scopes: the JUDGE one and ADMIN's own (no file row for either) -> 2.
    assert stats["removed"] == {"role_permissions": 3, "field_permissions": 3, "data_scopes": 2, "total": 8}
    # The ADMIN field rule is deleted too (overwrite wipes every field rule); the file lacks it.
    assert deleted_first == 10  # 4 non-ADMIN grants + 4 field rules + 2 scopes
    assert stats["removed"]["total"] < deleted_first, "the kept entries are rebuilt, not lost"
    # Net created: only the one entry that did not exist before. Rebuilt entries are not 'created'.
    assert stats["role_permissions"]["created"] == 1
    assert stats["field_permissions"]["created"] == 0
    assert stats["data_scopes"]["created"] == 0
    # Updated: the role's description + the grant whose conditions differ. The unchanged field rule is not.
    assert stats["updated"] == 2
    assert _counts() == before, "a dry run leaves no row"


def test_a_merge_removes_and_updates_nothing(world):
    stats = import_permissions(FILE, overwrite=False, dry_run=True)
    assert stats["removed"] == {"role_permissions": 0, "field_permissions": 0, "data_scopes": 0, "total": 0}
    assert stats["updated"] == 0
    assert stats["removes_own_permissions"] is False


def test_the_dry_run_and_the_real_overwrite_agree_and_the_rows_match_the_file(world):
    client = _client(world["admin"], world["tenant"])
    dry = client.post(IMPORT, {**FILE, "overwrite": True, "dry_run": True}, format="json")
    assert dry.status_code == 200, dry.content
    assert Role.objects.get(name="JUDGE").description == "old"

    real = client.post(IMPORT, {**FILE, "overwrite": True}, format="json")
    assert real.status_code == 200, real.content
    assert real.data["stats"] == dry.data["stats"]
    assert Role.objects.get(name="JUDGE").description == "new"
    assert sorted(RolePermission.objects.filter(role__name="JUDGE").values_list("permission__codename", flat=True)) == [
        "soul.read", "system.settings",
    ]
    assert not RowLevelDataScope.objects.exists()
    assert list(FieldPermission.objects.values_list("field_name", flat=True)) == ["name"]


def test_only_a_real_import_leaves_a_summary_audit_row_with_the_counts(world):
    client = _client(world["admin"], world["tenant"])
    client.post(IMPORT, {**FILE, "overwrite": True, "dry_run": True}, format="json")
    assert not AuditLog.objects.filter(action=AuditAction.IMPORT).exists()

    client.post(IMPORT, {**FILE, "overwrite": True}, format="json")
    row = AuditLog.objects.get(action=AuditAction.IMPORT)
    assert row.user_id == world["admin"].pk
    assert row.changes["mode"] == "overwrite"
    assert row.changes["removed"]["total"] == 8
    assert row.changes["updated"] == 2
    assert row.changes["created"]["role_permissions"] == 1


def test_a_failure_in_the_middle_of_an_overwrite_changes_nothing(world):
    before = _counts()
    boom = mock.patch("apps.perm.export.admin_only_violations", side_effect=RuntimeError("boom"))
    with boom, pytest.raises(RuntimeError):
        import_permissions(FILE, overwrite=True)
    assert _counts() == before
    assert Role.objects.get(name="JUDGE").description == "old"


def test_a_failure_writing_the_audit_row_rolls_the_import_back(world):
    client = _client(world["admin"], world["tenant"])
    before = _counts()
    down = mock.patch("apps.perm.views._audit_import", side_effect=RuntimeError("audit down"))
    with down, pytest.raises(RuntimeError):
        client.post(IMPORT, {**FILE, "overwrite": True}, format="json")
    assert _counts() == before
    assert Role.objects.get(name="JUDGE").description == "old"


def test_the_cache_is_cleared_after_a_real_overwrite_and_not_after_a_dry_run(world):
    client = _client(world["admin"], world["tenant"])
    with mock.patch("apps.perm.views.invalidate_all_permissions") as invalidate:
        client.post(IMPORT, {**FILE, "overwrite": True, "dry_run": True}, format="json")
        invalidate.assert_not_called()
        client.post(IMPORT, {**FILE, "overwrite": True}, format="json")
        invalidate.assert_called_once()


# ── removes_own_permissions ────────────────────────────────────────────────


def test_an_admin_never_removes_its_own_permissions_even_when_admin_field_and_scope_rows_go(world):
    # ADMIN's field rule and data scope ARE removed (the file has none)...
    stats = import_permissions({"roles": [{"name": "ADMIN", "display_name": "Admin"}]}, overwrite=True,
                               dry_run=True, user=world["admin"])
    assert stats["removed"]["field_permissions"] >= 1 and stats["removed"]["data_scopes"] >= 1
    # ...but ADMIN bypasses grants, field rules and scopes, so none of them is "its own".
    assert stats["removes_own_permissions"] is False


def test_a_non_admin_caller_whose_role_loses_entries_removes_its_own(world):
    judge = User.objects.create_user(username="ow_judge", password="x", role="JUDGE", tenant=world["tenant"])
    assert import_permissions(FILE, overwrite=True, dry_run=True, user=judge)["removes_own_permissions"] is True


def test_a_non_admin_caller_whose_role_loses_nothing_does_not(world):
    mod = User.objects.create_user(username="ow_mod", password="x", role="MODERATOR", tenant=world["tenant"])
    keep_mod = {**FILE, "role_permissions": [*FILE["role_permissions"], {"role": "MODERATOR", "permission": "soul.read"}]}
    # JUDGE entries are removed, MODERATOR's single grant is kept.
    assert import_permissions(keep_mod, overwrite=True, dry_run=True, user=mod)["removes_own_permissions"] is False


def test_an_extra_role_counts_as_the_callers_own(world):
    mod = User.objects.create_user(
        username="ow_dual", password="x", role="MODERATOR", tenant=world["tenant"], extra_roles=["JUDGE"],
    )
    assert import_permissions(FILE, overwrite=True, dry_run=True, user=mod)["removes_own_permissions"] is True


def test_through_the_api_an_admin_gets_false(world):
    client = _client(world["admin"], world["tenant"])
    response = client.post(IMPORT, {**FILE, "overwrite": True, "dry_run": True}, format="json")
    assert response.data["stats"]["removes_own_permissions"] is False
