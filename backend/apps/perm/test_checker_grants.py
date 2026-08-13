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
from apps.perm.models import DEFAULT_ROLES, ROLE_PERMISSIONS, Permission, Role, RolePermission

User = get_user_model()

# VIEWER does NOT hold this in ROLE_PERMISSIONS — so a True can only come from the DB.
DENIED_BY_DICT = "soul.delete"
# VIEWER DOES hold this in ROLE_PERMISSIONS — so a False can only come from the DB.
GRANTED_BY_DICT = "soul.read"


class CheckerHonoursDatabaseGrantsTest(TestCase):
    def setUp(self):
        # get_or_create, not create: perm migration 0017 seeds all five Role rows
        # at migrate time, so these already exist in the test database.
        self.role, _ = Role.objects.get_or_create(
            name="VIEWER", defaults={"display_name": "Viewer"}
        )
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
        contract. Before the fix this returned the dict's True.

        The revoke is not redundant. Migration 0017 grants VIEWER whichever of
        its dict codenames already have a Permission row at migrate time; today
        soul.read has none, so no grant exists and the revoke is a no-op. But
        that is a fact about the current seed data, not about this test's
        subject. Stating the precondition outright means the test keeps testing
        "seeded and ungranted is denied" if 0017 (or a later seeder) ever starts
        creating that row, instead of silently inverting into its own opposite.
        """
        perm = self._seed(GRANTED_BY_DICT)
        self._revoke(perm)

        self.assertFalse(
            check_permission(self.user, GRANTED_BY_DICT),
            "codename is seeded and ungranted, so the DB denies it; the dict "
            "must not get to overrule that",
        )

    def test_a_grant_to_another_role_does_not_leak(self):
        """Pins the join to the right role. `filter(role=<name string>)` raised;
        a lookup that matched on nothing — or on everything — would also satisfy
        test_a_grant_grants on its own."""
        judge_role, _ = Role.objects.get_or_create(
            name="JUDGE", defaults={"display_name": "Judge"}
        )
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
def test_workflow_codenames_survive_on_a_migrate_only_database():
    """A migrate-only database must not silently revoke workflow.* from MODERATOR and JUDGE.

    This began life as an `xfail(strict=True)` recording a defect the checker fix
    exposed. On a fresh `manage.py migrate` database — exactly what pytest builds
    and what CI runs against — the measurement was:

        MODERATOR  33 -> 28   lost workflow.read/create/update/delete/escalate
        JUDGE      18 -> 15   lost workflow.read/approve/advance

    Cause: no migration seeded DEFAULT_ROLES. Role rows were created only by the
    init endpoints in apps/perm/views.py, which a fresh database has never
    called, and DEFAULT_ROLES did not even list MODERATOR. Migrations 0013/0015
    created the seven workflow.* Permission rows unconditionally while every
    grant bailed out on "role is None". That left the codenames seeded but
    ungranted, and since checker.py treats the DB as authoritative for a seeded
    codename, they were answered from an empty RolePermission table and denied.
    Before the checker fix the ValueError-plus-bare-except path returned the
    dict's answer and hid all of it.

    Migration 0017 closes it by seeding roles, permissions and grants in one
    operation, so the assertion now holds and the xfail is retired — which is
    exactly what strict=True was there to force. Had it been left non-strict it
    would have flipped to a silent XPASS and told nobody, the failure mode the
    seven non-strict xfails elsewhere in this suite still demonstrate.

    Keep this as a live test. It is the only thing asserting a role's effective
    permissions against a migrate-only database, and re-introducing a Permission
    row without its grant would make it fail again.
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


def test_every_role_with_a_permission_matrix_is_also_seeded():
    """DEFAULT_ROLES and ROLE_PERMISSIONS must name the same five roles.

    MODERATOR held a 33-codename matrix in ROLE_PERMISSIONS while being absent
    from DEFAULT_ROLES, so no environment built from the seed data ever had a
    Role row for it and migrations 0014/0015 skipped its every grant. A role
    that exists in one list and not the other is a role whose permissions are
    written down and never take effect.

    Static assertion on purpose — no database. The point is that the two
    declarations agree at import time, before anything gets seeded anywhere.
    """
    seeded = {name for name, _ in DEFAULT_ROLES}
    with_matrix = set(ROLE_PERMISSIONS)

    assert seeded == with_matrix, (
        f"in ROLE_PERMISSIONS but never seeded: {sorted(with_matrix - seeded)}; "
        f"seeded but holding no permissions: {sorted(seeded - with_matrix)}"
    )


class CacheInvalidateRoleDatabaseErrorTest(TestCase):
    """The same swallowed-DatabaseError defect as
    ``test_a_database_error_is_not_swallowed`` above, one module over:
    ``PermissionCache.invalidate_role`` wrapped its descendant walk — a
    ``Role.objects.filter()`` — in a bare ``except Exception`` that logged one
    warning and returned.

    On PostgreSQL that is an amplifier, not a nicety. A failed statement aborts
    the surrounding transaction, so every query after it raises
    ``InFailedSqlTransaction``; swallowing the first error hides the only
    message that names the real cause and lets the request produce a cascade of
    derived failures instead. Cache invalidation runs from signal handlers on
    permission writes, which is exactly where it sits inside somebody else's
    transaction.
    """

    def test_a_database_error_is_not_swallowed(self):
        from apps.perm.cache import PermissionCache

        cache = PermissionCache()
        with patch("apps.perm.models.Role.objects") as objects:
            objects.filter.side_effect = DatabaseError("connection lost")
            with self.assertRaises(DatabaseError):
                cache.invalidate_role("VIEWER")
