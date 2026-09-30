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

from apps.perm.models import DEFAULT_PERMISSIONS, Permission, Role

_ROLE_NAMES = dict(import_module("apps.perm.migrations.0017_seed_roles_and_grants").ROLES)
_PERMISSIONS = {codename: (name, category) for codename, name, category in DEFAULT_PERMISSIONS}


def seeded_role(name):
    return Role.objects.get_or_create(name=name, defaults={"display_name": _ROLE_NAMES[name]})[0]


def seeded_permission(codename):
    name, category = _PERMISSIONS[codename]
    return Permission.objects.get_or_create(codename=codename, defaults={"name": name, "category": category})[0]
