"""Role and Permission rows for tests that grant a permission to a seeded role.

`apps/perm/migrations/0017_seed_roles_and_grants.py` seeds the five roles, and
other migrations and `sync_permissions` seed the Permission rows. A
`transaction=True` test truncates every table when it ends, and nothing puts
those rows back (see the docstring in `apps/perm/test_ws_permissions_match_granted.py`).
pytest-django happens to run transactional tests last, so `Role.objects.get(...)`
in a plain `db` test passes in the usual order and raises `DoesNotExist` in any
other: 2026-09-30, with the transactional tests moved first, ten tests across
three files failed in setup. These helpers make such a test own its rows.
"""
from importlib import import_module

from apps.perm.cache import invalidate_all_permissions
from apps.perm.models import DEFAULT_PERMISSIONS, ROLE_PERMISSIONS, Permission, Role, RolePermission

_ROLE_NAMES = dict(import_module("apps.perm.migrations.0017_seed_roles_and_grants").ROLES)
_PERMISSIONS = {codename: (name, category) for codename, name, category in DEFAULT_PERMISSIONS}


def seeded_role(name):
    return Role.objects.get_or_create(name=name, defaults={"display_name": _ROLE_NAMES[name]})[0]


def seeded_permission(codename):
    name, category = _PERMISSIONS[codename]
    return Permission.objects.get_or_create(codename=codename, defaults={"name": name, "category": category})[0]


def seeded_grants():
    """All five roles, every catalogue Permission, and the grants `ROLE_PERMISSIONS` promises.

    The coherent deployment `0017` leaves (roles with their grants, so the checker answers from
    the database), for a test that reads or edits a role's grants. The same three loops as
    `apps/perm/tests.py::PermissionAPITest.setUp`, and idempotent on a database that still has
    the migration's rows.
    """
    for codename in _PERMISSIONS:
        seeded_permission(codename)
    for role_name, codenames in ROLE_PERMISSIONS.items():
        role = seeded_role(role_name)
        for codename in filter(_PERMISSIONS.__contains__, codenames):
            RolePermission.objects.get_or_create(role=role, permission=seeded_permission(codename))
    invalidate_all_permissions()


def seeded_menus():
    """Put back the menu rows the data migrations seed, by replaying their forward functions.

    Each `apps/menus/migrations/*.py` that has a `RunPython` (0007 social, 0009 regroup into
    directories, 0010/0011 moves, 0013 onward one entry each) is idempotent (get-or-create by
    path, `update` for placement), so replaying them in order on an empty or a seeded table
    gives the shape a fresh database has. The rows are read from the migrations themselves,
    not copied here. Returns nothing; call it from a test or fixture that reads a seeded path.
    """
    from django.apps import apps as django_apps
    from django.db import migrations as m
    from django.db.migrations.loader import MigrationLoader

    loader = MigrationLoader(None, ignore_no_migrations=True)
    for app, name in sorted(k for k in loader.disk_migrations if k[0] == "menus"):
        for op in loader.disk_migrations[(app, name)].operations:
            if isinstance(op, m.RunPython) and op.code is not None:
                op.code(django_apps, None)
