"""Does a grant grant, and does a revocation revoke?

The permission audit's first finding: `check_permission()` looked up its DB
answer with `RolePermission.objects.filter(role=role, ...)` where `role` is the
role NAME string off the user, not a `Role` instance. Postgres and SQLite alike
answered that with `ValueError: Field 'id' expected a number but got 'VIEWER'`,
and a bare `except Exception` a few lines below turned every one of those into
the `ROLE_PERMISSIONS` dict's answer. The DB branch never once decided anything,
so no grant in the `RolePermission` table has ever granted and no revocation has
ever revoked — for months, on a table with 49 rows in it.

Nothing in the suite noticed, because every existing "DB beats dict" test either
grants a codename the dict already holds (so both sources agree and the wrong one
can answer) or exercises the ADMIN bypass, which returns before either source is
read. These tests are written so that the dict and the database DISAGREE: each
assertion below is one the dict cannot satisfy, which is exactly why every one of
them failed before the lookup was fixed.

`soul.delete` and `soul.read` are both in `DEFAULT_PERMISSIONS`, so both are real
seeded codenames; VIEWER holds `soul.read` in the dict and does not hold
`soul.delete`. That gives one codename to grant against the dict and one to
revoke against it.
"""
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.db import DatabaseError
from django.test import TestCase

from apps.perm.cache import invalidate_all_permissions
from apps.perm.checker import check_permission
from apps.perm.models import ROLE_PERMISSIONS, Permission, Role, RolePermission

User = get_user_model()

# VIEWER does NOT hold this in ROLE_PERMISSIONS — so a True can only come from the DB.
DENIED_BY_DICT = "soul.delete"
# VIEWER DOES hold this in ROLE_PERMISSIONS — so a False can only come from the DB.
GRANTED_BY_DICT = "soul.read"


class CheckerHonoursDatabaseGrantsTest(TestCase):
    def setUp(self):
        self.role = Role.objects.create(name="VIEWER", display_name="Viewer")
        self.user = User.objects.create_user(
            username="viewer_grants", password="x", role="VIEWER"
        )
        # The permission cache is a module-level singleton keyed by
        # (role, codename); the root conftest only clears Django's cache
        # framework, which this does not use.
        invalidate_all_permissions()
        self.addCleanup(invalidate_all_permissions)

    def _seed(self, codename):
        perm, _ = Permission.objects.get_or_create(
            codename=codename,
            defaults={"name": codename, "category": codename.split(".")[0]},
        )
        return perm

    def _grant(self, perm, role=None):
        RolePermission.objects.get_or_create(role=role or self.role, permission=perm)
        invalidate_all_permissions()

    def _revoke(self, perm, role=None):
        RolePermission.objects.filter(role=role or self.role, permission=perm).delete()
        invalidate_all_permissions()

    def test_the_two_codenames_sit_on_opposite_sides_of_the_dict(self):
        """Guards the premise the rest of the file rests on. If someone adds
        soul.delete to VIEWER (or drops soul.read), these tests stop being able
        to tell the DB's answer from the dict's and quietly go green forever."""
        self.assertNotIn(DENIED_BY_DICT, ROLE_PERMISSIONS["VIEWER"])
        self.assertIn(GRANTED_BY_DICT, ROLE_PERMISSIONS["VIEWER"])

    def test_a_grant_grants(self):
        perm = self._seed(DENIED_BY_DICT)
        self._grant(perm)

        self.assertTrue(
            check_permission(self.user, DENIED_BY_DICT),
            "an explicit RolePermission row must grant the codename; the dict "
            "denies it, so a False here means the DB branch was not consulted",
        )

    def test_a_revocation_revokes(self):
        perm = self._seed(DENIED_BY_DICT)
        self._grant(perm)
        self.assertTrue(check_permission(self.user, DENIED_BY_DICT))

        self._revoke(perm)

        self.assertFalse(
            check_permission(self.user, DENIED_BY_DICT),
            "deleting the RolePermission row must take the codename away again",
        )

    def test_a_seeded_codename_with_no_grant_is_denied_even_though_the_dict_allows_it(self):
        """The DB is authoritative for seeded codenames — that is the documented
        contract. Before the fix this returned the dict's True."""
        self._seed(GRANTED_BY_DICT)

        self.assertFalse(
            check_permission(self.user, GRANTED_BY_DICT),
            "codename is seeded and ungranted, so the DB denies it; the dict "
            "must not get to overrule that",
        )

    def test_a_grant_to_another_role_does_not_leak(self):
        """Pins the join to the right role. `filter(role=<name string>)` raised;
        a lookup that matched on nothing — or on everything — would also satisfy
        test_a_grant_grants on its own."""
        judge_role = Role.objects.create(name="JUDGE", display_name="Judge")
        perm = self._seed(DENIED_BY_DICT)
        self._grant(perm, role=judge_role)

        judge = User.objects.create_user(username="judge_grants", password="x", role="JUDGE")
        self.assertTrue(check_permission(judge, DENIED_BY_DICT))
        self.assertFalse(check_permission(self.user, DENIED_BY_DICT))

    def test_an_unseeded_codename_still_falls_back_to_the_dict(self):
        """The branch that must NOT change. Codenames with no Permission row —
        the majority of what the views declare — keep answering from the dict."""
        Permission.objects.filter(codename=GRANTED_BY_DICT).delete()

        self.assertTrue(check_permission(self.user, GRANTED_BY_DICT))

    def test_a_database_error_is_not_swallowed(self):
        """The bare `except Exception` is the reason this went unnoticed: it
        caught the ValueError and answered from the dict, so a permanently
        broken DB branch looked exactly like a working one."""
        self._seed(GRANTED_BY_DICT)

        with patch("apps.perm.models.RolePermission.objects") as objects:
            objects.filter.side_effect = DatabaseError("connection lost")
            with self.assertRaises(DatabaseError):
                check_permission(self.user, GRANTED_BY_DICT)


# The permission set MODERATOR and JUDGE are supposed to hold, per ROLE_PERMISSIONS.
MODERATOR_WORKFLOW = (
    "workflow.read",
    "workflow.create",
    "workflow.update",
    "workflow.delete",
    "workflow.escalate",
)
JUDGE_WORKFLOW = ("workflow.read", "workflow.approve", "workflow.advance")


@pytest.mark.django_db
@pytest.mark.xfail(strict=True, reason="workflow.* is seeded but ungranted on a migrate-only DB")
def test_workflow_codenames_survive_on_a_migrate_only_database():
    """A migrate-only database silently revokes workflow.* from MODERATOR and JUDGE.

    This asserts the CORRECT behaviour and currently fails. Measured against a
    fresh `manage.py migrate` database — which is exactly what pytest builds,
    and what CI runs against:

        MODERATOR  33 -> 28   loses workflow.read/create/update/delete/escalate
        JUDGE      18 -> 15   loses workflow.read/approve/advance

    Cause: nothing seeds DEFAULT_ROLES in a migration — the Role rows are
    created by the init endpoints in apps/perm/views.py, which a fresh database
    has never called. Migrations 0013 and 0015 create the seven workflow.*
    Permission rows unconditionally, but every grant in 0013/0014/0015 bails out
    with "role is None" and is skipped. That leaves those seven codenames seeded
    but ungranted, and since checker.py treats the DB as authoritative for any
    seeded codename, they are now answered from an empty RolePermission table
    and denied. Before the checker fix the ValueError-plus-bare-except path
    returned the dict's answer and hid this.

    Not fixed here on purpose: the repair is to seed the roles (or stop seeding
    Permission rows without them), and that is a decision the user has not taken.
    Turning CI red to force it would be the wrong way to ask.

    Why strict=True. A non-strict xfail that starts passing is reported as XPASS
    and changes nothing, so the news never reaches anyone — which is precisely
    what the seven non-strict xfails step0-snapshot found have been doing while
    quietly passing. strict=True inverts that: the moment someone seeds the Role
    rows, this XPASSes, XPASS is a FAILURE, and the suite announces that the
    defect is gone and this guard should be retired. The contrast is the point.

    Deliberately asserts only the positive behaviour. It does not assert that
    the Role table is empty, because under an xfail any failed assertion counts
    as the expected failure — a premise check would absorb the very change this
    test exists to announce.
    """
    invalidate_all_permissions()

    moderator = User.objects.create_user(username="mod_migrate_only", password="x", role="MODERATOR")
    judge = User.objects.create_user(username="judge_migrate_only", password="x", role="JUDGE")

    denied = [c for c in MODERATOR_WORKFLOW if not check_permission(moderator, c)]
    denied += [f"JUDGE:{c}" for c in JUDGE_WORKFLOW if not check_permission(judge, c)]

    assert denied == [], (
        f"seeded-but-ungranted codenames denied to their own role: {denied}. "
        f"Permission rows for workflow.*: "
        f"{sorted(Permission.objects.filter(codename__startswith='workflow.').values_list('codename', flat=True))}; "
        f"Role rows: {sorted(Role.objects.values_list('name', flat=True))}"
    )
