"""`manage.py sync_permissions`:补齐缺失的码名,不碰已有码名上的授予。

测试库经迁移建好,里面已有一部分 Permission 行(0013–0024 播种的那些),所以每条
测试先把 Permission / RolePermission 清成自己要的样子,再跑命令。
"""
from io import StringIO

import pytest
from django.core.management import call_command

from apps.authentication.models import User
from apps.perm.checker import check_permission
from apps.perm.models import DEFAULT_PERMISSIONS, DEFAULT_ROLES, ROLE_PERMISSIONS, Permission, Role, RolePermission

ALL_CODENAMES = {codename for codename, _, _ in DEFAULT_PERMISSIONS}


def _sync(*args):
    out = StringIO()
    call_command("sync_permissions", *args, stdout=out)
    return out.getvalue()


def _grants():
    return {
        (role, codename)
        for role, codename in RolePermission.objects.values_list("role__name", "permission__codename")
    }


def _default_grants(codenames):
    return {(role, c) for role, codes in ROLE_PERMISSIONS.items() for c in codes if c in codenames}


@pytest.fixture
def roles(db):
    for name, display in DEFAULT_ROLES:
        Role.revive_or_create(name, display_name=display)


@pytest.fixture
def only(roles):
    """Leave exactly these codenames in the database, each with its default grants."""

    def seed(codenames):
        RolePermission.all_objects.all().delete()
        Permission.all_objects.all().delete()
        by_name = {r.name: r for r in Role.objects.all()}
        for codename, name, category in DEFAULT_PERMISSIONS:
            if codename in codenames:
                perm = Permission.objects.create(codename=codename, name=name, category=category)
                for role, codes in ROLE_PERMISSIONS.items():
                    if codename in codes:
                        RolePermission.objects.create(role=by_name[role], permission=perm)

    return seed


@pytest.mark.django_db
def test_every_codename_the_code_knows_is_creatable_from_an_empty_table(only):
    """The guard: nothing in DEFAULT_PERMISSIONS / ROLE_PERMISSIONS is out of reach."""
    only(set())
    _sync()
    assert set(Permission.objects.values_list("codename", flat=True)) == ALL_CODENAMES
    held = {c for codes in ROLE_PERMISSIONS.values() for c in codes}
    assert held <= ALL_CODENAMES, f"granted but not creatable: {sorted(held - ALL_CODENAMES)}"
    assert _grants() == _default_grants(ALL_CODENAMES)


@pytest.mark.django_db
def test_a_subset_database_gets_exactly_the_missing_ones(only):
    """115's shape: judgment.read / execute seeded, judgment.assign not."""
    present = ALL_CODENAMES - {"judgment.assign", "dispatch.return"}
    only(present)
    before = set(Permission.objects.values_list("pk", "codename"))

    out = _sync()

    assert "created judgment.assign -> ADMIN, MODERATOR" in out
    after = set(Permission.objects.values_list("pk", "codename"))
    assert before <= after, "an existing Permission row was replaced"
    assert {c for _, c in after - before} == {"judgment.assign", "dispatch.return"}
    assert _grants() == _default_grants(ALL_CODENAMES)
    assert ("JUDGE", "judgment.assign") not in _grants()


@pytest.mark.django_db
def test_a_revoked_default_on_an_existing_codename_stays_revoked(only):
    only(ALL_CODENAMES - {"judgment.assign"})
    # The admin revoked a default and granted a non-default, on codenames that exist.
    RolePermission.objects.filter(role__name="JUDGE", permission__codename="judgment.execute").delete()
    RolePermission.objects.create(
        role=Role.objects.get(name="VIEWER"), permission=Permission.objects.get(codename="judgment.read")
    )
    before = _grants()

    _sync()

    assert ("JUDGE", "judgment.execute") not in _grants()
    assert ("VIEWER", "judgment.read") in _grants()
    assert _grants() - before == {("ADMIN", "judgment.assign"), ("MODERATOR", "judgment.assign")}
    assert before <= _grants()


@pytest.mark.django_db
def test_a_second_run_does_nothing(only):
    only(ALL_CODENAMES - {"judgment.assign"})
    _sync()
    snapshot = (set(Permission.objects.values_list("pk", flat=True)), _grants())
    # Even after the admin revokes the one this command just created.
    RolePermission.objects.filter(role__name="MODERATOR", permission__codename="judgment.assign").delete()
    out = _sync()
    assert "Nothing to do" in out
    assert set(Permission.objects.values_list("pk", flat=True)) == snapshot[0]
    assert ("MODERATOR", "judgment.assign") not in _grants()


@pytest.mark.django_db
def test_dry_run_writes_nothing(only):
    only(ALL_CODENAMES - {"judgment.assign"})
    before = (Permission.objects.count(), RolePermission.objects.count())
    out = _sync("--dry-run")
    assert "[dry-run] would create judgment.assign -> ADMIN, MODERATOR" in out
    assert (Permission.objects.count(), RolePermission.objects.count()) == before


@pytest.mark.django_db
def test_syncing_does_not_change_what_anyone_may_do(only):
    """Without a row the checker answers from ROLE_PERMISSIONS; after the sync, from
    the new rows. Both must agree — the sync makes the codename manageable in the
    matrix, it does not change the answer."""
    from apps.perm.cache import invalidate_all_permissions

    only(ALL_CODENAMES - {"judgment.assign"})
    users = {
        role: User.objects.create_user(username=f"sync_{role.lower()}", password="x", role=role)
        for role in ("MODERATOR", "JUDGE")
    }
    invalidate_all_permissions()
    by_dict = {role: check_permission(u, "judgment.assign") for role, u in users.items()}
    _sync()
    by_rows = {role: check_permission(u, "judgment.assign") for role, u in users.items()}
    assert by_dict == by_rows == {"MODERATOR": True, "JUDGE": False}


@pytest.mark.django_db
def test_a_missing_role_row_is_reported_not_created(only):
    only(ALL_CODENAMES - {"judgment.assign"})
    Role.objects.filter(name="MODERATOR").delete()
    out = _sync()
    assert "[no Role row, not granted: MODERATOR]" in out
    assert not Role.objects.filter(name="MODERATOR").exists()
