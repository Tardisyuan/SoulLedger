"""Seeding a Permission row must never revoke what the dict was granting.

`check_permission` (apps/perm/checker.py) treats the database as authoritative
*iff* a row exists for that codename, and otherwise falls back to the
ROLE_PERMISSIONS dict. So creating the row without creating the grants flips a
codename from "granted by the dict" to "seeded but ungranted", which reads as
denied.

`POST /api/v1/perm/init/` did exactly that. Measured 2026-08-29 on a freshly
migrated database: 8 Permission rows existed, the endpoint created 38 more,
answered `200 {"message": "Initialized 38 permissions"}`, and revoked **69**
role-codename grants -- JUDGE lost `soul.read`, `soul.die` and
`judgment.create`; VIEWER lost `soul.read`. Migration
0017_seed_roles_and_grants names this failure mode in its own docstring and
deliberately refuses to seed the whole catalogue because of it.

That endpoint is gone (2026-08-30), and so is its successor
`POST /perm/role-permissions/init/` (2026-10-23): it deleted every role's
grants before re-creating them from the dict, which wiped the admin's matrix
edits along with any `conditions` / `data_scope` on them. The one way to seed
missing codenames now is `manage.py sync_permissions`, which creates only the
rows that do not exist and grants them to the dict's holders.

**Deleting an endpoint is not the same as removing a class of defect**, which
is why this file did not shrink to a 404 assertion. The property that matters
is "seeding leaves no codename seeded-but-ungranted", and it is asserted here
against the command, through `check_permission` rather than through row
counts -- the row count was never the thing that broke. The old endpoint
reported 38 rows created and that number was true.
"""
from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.urls import NoReverseMatch, reverse

from apps.perm.checker import check_permission
from apps.perm.management.commands.sync_permissions import missing_permissions
from apps.perm.models import (
    DEFAULT_PERMISSIONS,
    DEFAULT_ROLES,
    ROLE_PERMISSIONS,
    Permission,
    Role,
    RolePermission,
)
from apps.tenants.models import Tenant

User = get_user_model()
_ALL_CODENAMES = sorted({c for c, _, _ in DEFAULT_PERMISSIONS})


@pytest.fixture
def tenant(db):
    # Every built-in role gets a Role row first, the way `roles/init/` leaves
    # it: sync_permissions grants only to roles that have one.
    for name, display in DEFAULT_ROLES:
        Role.revive_or_create(name, display_name=display)
    return Tenant.objects.get_or_create(
        code="PI_T", defaults={"display_name": "Perm Init"}
    )[0]


def _sync():
    call_command("sync_permissions", stdout=StringIO())


def _probe_user(role_name, tenant):
    """One probe per role, reused.

    A fresh user per reading hit a UNIQUE constraint the second time round,
    and reusing one is the more honest measurement anyway: the before/after
    comparison should differ in exactly one thing, the command run.
    """
    user, _ = User.objects.get_or_create(
        username=f"probe_{role_name.lower()}",
        defaults={"role": role_name, "tenant": tenant},
    )
    return user


def _effective(role_name, tenant):
    """What a role actually resolves to, through the real checker.

    Deliberately not a row count.
    """
    return {
        c for c in _ALL_CODENAMES if check_permission(_probe_user(role_name, tenant), c)
    }


@pytest.mark.parametrize("name", ["perm:init", "perm:init-role-permissions"])
def test_the_endpoints_that_rebuilt_grants_are_gone(name):
    with pytest.raises(NoReverseMatch):
        reverse(name)


@pytest.mark.django_db
def test_seeding_revokes_nothing(tenant):
    """The surviving entry point, held to the property the endpoints broke."""
    before = {role: _effective(role, tenant) for role in ROLE_PERMISSIONS}

    _sync()

    lost = {}
    for role, had in before.items():
        missing = had - _effective(role, tenant)
        if missing:
            lost[role] = sorted(missing)

    assert lost == {}, (
        f"seeding revoked grants: {lost}. Creating a Permission row moves that "
        f"codename from the ROLE_PERMISSIONS fallback to the database branch "
        f"of check_permission; without the matching RolePermission rows that "
        f"reads as denied, and the command still says success."
    )


@pytest.mark.django_db
def test_seeding_actually_seeds(tenant):
    """Positive control. A command that does nothing also revokes nothing."""
    assert Permission.objects.count() < len(DEFAULT_PERMISSIONS), (
        "the catalogue is already complete before the call -- this test would "
        "pass without the command doing anything"
    )
    _sync()
    seeded = set(Permission.objects.values_list("codename", flat=True))
    assert set(_ALL_CODENAMES) <= seeded, sorted(set(_ALL_CODENAMES) - seeded)


@pytest.mark.django_db
def test_no_codename_seeded_by_the_command_is_left_ungranted(tenant):
    """The property itself, measured on what the command created.

    A row with no grant behind it denies a role that ROLE_PERMISSIONS says
    should hold it. Rows that existed before the call belong to the admin
    (their grants are the matrix) and are deliberately out of scope here;
    `apps/perm/test_sync_permissions.py` pins that they are left alone.
    """
    created = {codename for codename, _, _, _ in missing_permissions()}
    assert created, "nothing to seed -- this test would pass vacuously"
    _sync()

    orphaned = []
    for role_name, codenames in ROLE_PERMISSIONS.items():
        role = Role.objects.filter(name=role_name).first()
        if role is None:
            continue
        granted = set(
            RolePermission.objects.filter(role=role).values_list(
                "permission__codename", flat=True
            )
        )
        orphaned += [f"{role_name}:{c}" for c in codenames if c in created and c not in granted]

    assert orphaned == [], (
        f"{len(orphaned)} codename(s) are seeded as Permission rows without the "
        f"grant ROLE_PERMISSIONS says the role holds, so check_permission's "
        f"database branch denies them: {orphaned[:10]}"
    )
