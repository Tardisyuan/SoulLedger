"""Does the permission list the frontend is handed match what the server will allow?

The audit's §2 finding, and the test whose absence is why it lasted. Two
components answer "what may this user do?" and they answered it with two
separate implementations of the same rule:

- `apps/perm/checker.py::check_permission` decides what the server does.
- `apps/perm/views.py::_get_role_permissions_from_db` decides what the UI
  offers, via `GET /perm/role-permissions/` — the login response and the
  rehydrate fetch in `frontend/src/contexts/TenantContext.tsx` both end up in
  `usePermissions`, which is what every `RequirePermission` gate reads.

Where they disagreed the interface lied: it hid controls the server would have
allowed (over-hiding), or offered ones it would refuse. Two rewrites of the
reporting side each re-derived the checker's rule by hand and each drifted from
it in a different way — first all-or-nothing per role (VIEWER reported one
codename against the checker's eight), then per codename but without the ADMIN
short-circuit (ADMIN reported 39 of 40, dropping `workflow.escalate`, which is
seeded and not granted to the ADMIN role but which the server allows anyway).

So the property below is stated over the two components, not over either
component's internals: for every role and every declared codename, being in the
reported list must mean exactly the same thing as `check_permission` returning
True. It is deliberately blind to *how* either side reaches its answer, which
is what makes it survive the next rewrite of either.

The tests drive the real HTTP endpoint with real users rather than calling the
helper, because `_get_role_permissions_from_db` takes a role name and
`check_permission` takes a user. Comparing them through the endpoint is what
pins the role probe in views.py to a real user: if `check_permission` ever
starts reading something off the user besides `.role` — `rbac_role`, tenant,
group — these go red instead of the UI quietly diverging again.

STILL DIVERGENT, and not fixable from here: the login response does not come
from this endpoint. `apps/authentication/serializers.py::
UserWithTenantSerializer.get_permissions` is a third implementation, and it is
the all-or-nothing one — on a migrate-only database it reports VIEWER 1
codename against the checker's 8, GUARDIAN 1 against 14, ADMIN 7 against 40.
The rehydrate fetch overwrites that list on the next page load, so the damage
is confined to the first render after login, but it is the same defect in a
file this change does not own.
"""
from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.perm.cache import invalidate_all_permissions
from apps.perm.checker import check_permission
from apps.perm.models import DEFAULT_PERMISSIONS, ROLE_PERMISSIONS, Permission, Role, RolePermission

User = get_user_model()

CATALOGUE = [codename for codename, _, _ in DEFAULT_PERMISSIONS]

# VIEWER holds neither in ROLE_PERMISSIONS, so a True for these can only come
# from the database — the same pair apps/perm/test_checker_grants.py uses, for
# the same reason: a codename both sources agree on cannot tell them apart.
DENIED_BY_DICT = "soul.delete"
GRANTED_BY_DICT = "soul.read"


class ReportedPermissionsMatchTheCheckerTest(TestCase):
    """Every role, every declared codename, reported == granted."""

    def setUp(self):
        self.client = APIClient()
        # The permission cache is a module-level singleton keyed by
        # (role, codename) with a 300s TTL, and nothing in conftest clears it.
        # Without this a grant made by an earlier test in the same process
        # answers for this one.
        invalidate_all_permissions()
        self.addCleanup(invalidate_all_permissions)
        self.users = {
            role: User.objects.create_user(username=f"rp_{role}", password="x", role=role)
            for role in ROLE_PERMISSIONS
        }

    def _reported(self, user):
        self.client.force_authenticate(user=user)
        response = self.client.get("/api/v1/perm/role-permissions/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["role"], user.role)
        return set(response.data["permissions"])

    def test_the_catalogue_is_not_empty(self):
        """Guards the guard. Every assertion below iterates CATALOGUE; an empty
        one would make all of them pass without comparing anything."""
        self.assertGreaterEqual(len(CATALOGUE), 30)
        self.assertEqual(len(CATALOGUE), len(set(CATALOGUE)), "duplicate codename in DEFAULT_PERMISSIONS")

    def test_every_role_reports_exactly_the_codenames_the_checker_grants(self):
        """The audit's §2 property, verbatim.

        `codename in login_response.permissions == check_permission(user, codename)`
        for every role and every codename in DEFAULT_PERMISSIONS.
        """
        mismatches = []
        for role, user in self.users.items():
            reported = self._reported(user)
            for codename in CATALOGUE:
                is_reported = codename in reported
                is_granted = check_permission(user, codename)
                if is_reported != is_granted:
                    mismatches.append(
                        f"{role}/{codename}: reported={is_reported} granted={is_granted}"
                    )

        self.assertEqual(
            mismatches, [],
            "the UI's permission list and the server's answer disagree. Each line "
            "is either a control the UI hides that the server allows, or one it "
            "offers that the server refuses:\n  " + "\n  ".join(mismatches),
        )

    def test_nothing_outside_the_catalogue_is_reported_without_being_granted(self):
        """The other half of the biconditional.

        The property above quantifies over DEFAULT_PERMISSIONS, so a codename
        that is not in the catalogue — one an admin created through
        `POST /perm/permissions/create/` — could be reported freely without
        failing it. Reporting is a claim about access either way.
        """
        for role, user in self.users.items():
            for codename in sorted(self._reported(user)):
                self.assertTrue(
                    check_permission(user, codename),
                    f"{role}: endpoint reports {codename!r} but the checker denies it",
                )

    def test_a_codename_revoked_from_the_admin_role_is_still_reported(self):
        """The divergence this closes, in isolation.

        `check_permission` returns True for ADMIN before it consults either the
        database or the dict, so revoking a grant from the ADMIN role changes
        nothing about what the server allows. The reporting endpoint used to
        answer from the grant tables and drop the codename, which hid a button
        from the one role that could definitely use it.

        `soul.delete` is chosen because it is a destructive action: this is the
        direction where over-hiding is least likely to be noticed and most
        likely to be worked around.
        """
        admin = self.users["ADMIN"]
        perm, _ = Permission.objects.get_or_create(
            codename=DENIED_BY_DICT,
            defaults={"name": DENIED_BY_DICT, "category": "soul"},
        )
        admin_role = Role.objects.get(name="ADMIN")
        RolePermission.objects.filter(role=admin_role, permission=perm).delete()
        invalidate_all_permissions()

        self.assertTrue(
            check_permission(admin, DENIED_BY_DICT),
            "premise: ADMIN short-circuits to True even with the grant gone",
        )
        self.assertIn(
            DENIED_BY_DICT, self._reported(admin),
            "ADMIN's reported list must model the short-circuit; the server will "
            "allow this whatever the grant tables say",
        )

    def test_a_grant_that_contradicts_the_dict_is_reported(self):
        """A non-ADMIN role gains a codename the dict denies it.

        Seeded plus granted, so the checker's DB branch says True while
        ROLE_PERMISSIONS says False. A reporting path that still read the dict
        would omit it.
        """
        viewer = self.users["VIEWER"]
        self.assertNotIn(DENIED_BY_DICT, ROLE_PERMISSIONS["VIEWER"], "premise")

        perm, _ = Permission.objects.get_or_create(
            codename=DENIED_BY_DICT,
            defaults={"name": DENIED_BY_DICT, "category": "soul"},
        )
        RolePermission.objects.get_or_create(role=Role.objects.get(name="VIEWER"), permission=perm)
        invalidate_all_permissions()

        self.assertIn(DENIED_BY_DICT, self._reported(viewer))

    def test_a_revocation_that_contradicts_the_dict_removes_it(self):
        """The mirror image: seeded and ungranted denies, even though the dict allows.

        This is the case that actually hides a button, so it is the one the UI
        has to get right — and the one a dict-reading reporting path gets wrong.
        """
        viewer = self.users["VIEWER"]
        self.assertIn(GRANTED_BY_DICT, ROLE_PERMISSIONS["VIEWER"], "premise")

        perm, _ = Permission.objects.get_or_create(
            codename=GRANTED_BY_DICT,
            defaults={"name": GRANTED_BY_DICT, "category": "soul"},
        )
        RolePermission.objects.filter(role=Role.objects.get(name="VIEWER"), permission=perm).delete()
        invalidate_all_permissions()

        self.assertNotIn(GRANTED_BY_DICT, self._reported(viewer))

    def test_the_admin_role_editor_reads_the_same_list_the_role_itself_gets(self):
        """Two endpoints, one answer.

        `GET /perm/roles/<name>/permissions/` is what an ADMIN sees when editing
        another role; `GET /perm/role-permissions/` is what a holder of that role
        sees for themselves. If they diverge, an admin edits against a picture
        that role's own users never see.
        """
        admin = self.users["ADMIN"]
        for role, user in self.users.items():
            own = self._reported(user)

            self.client.force_authenticate(user=admin)
            response = self.client.get(f"/api/v1/perm/roles/{role}/permissions/")
            self.assertEqual(response.status_code, 200, response.data)

            self.assertEqual(
                sorted(response.data["permissions"]), sorted(own),
                f"{role}: the admin role editor and the role's own list disagree",
            )


class LoginResponsePermissionsMatchTheCheckerTest(TestCase):
    """The same property, on the path every user hits first.

    `POST /auth/login/` does not go through the endpoint above. It serialises
    with `UserWithTenantSerializer`, which had its own third implementation of
    the resolution rule — the all-or-nothing one: any RolePermission row at all
    switched the ROLE_PERMISSIONS fallback off for the whole role, so a
    partially-seeded database reported only what happened to be granted. On a
    migrate-only database that was ADMIN 7 against the checker's 40, MODERATOR
    6 against 34, JUDGE 4 against 20, GUARDIAN 1 against 14, VIEWER 1 against 8.

    This is the audit's §2 finding itself — its "login list" column is this
    serializer — not the sibling defect fixed alongside it. The rehydrate
    refetch in TenantContext overwrites the list on the next page load, so the
    damage was bounded to the first render after login. That bound is a
    frontend behaviour, not a property of the permission layer: anyone who
    later "simplifies" TenantContext to trust the login payload restores the
    divergence at full size. Hence this test rather than a comment.
    """

    PASSWORD = "login-pw-12345"

    def setUp(self):
        self.client = APIClient()
        invalidate_all_permissions()
        self.addCleanup(invalidate_all_permissions)
        self.users = {}
        for role in ROLE_PERMISSIONS:
            user = User.objects.create_user(
                username=f"login_{role}", password=self.PASSWORD, role=role
            )
            self.users[role] = user

    def _login(self, user):
        response = self.client.post("/api/v1/auth/login/", {
            "username": user.username,
            "password": self.PASSWORD,
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return set(response.data["user"]["permissions"])

    def test_the_login_response_reports_exactly_what_the_checker_grants(self):
        mismatches = []
        for role, user in self.users.items():
            reported = self._login(user)
            for codename in CATALOGUE:
                is_reported = codename in reported
                is_granted = check_permission(user, codename)
                if is_reported != is_granted:
                    mismatches.append(
                        f"{role}/{codename}: login={is_reported} granted={is_granted}"
                    )

        self.assertEqual(
            mismatches, [],
            "the login response and the server's answer disagree:\n  " + "\n  ".join(mismatches),
        )

    def test_the_login_response_agrees_with_the_permissions_endpoint(self):
        """One list, two deliveries. The frontend takes whichever arrives first.

        A user who logs in and a user who refreshes the page must be offered
        the same controls, or the interface changes shape for no reason the
        user can see.
        """
        for role, user in self.users.items():
            from_login = self._login(user)

            self.client.force_authenticate(user=user)
            response = self.client.get("/api/v1/perm/role-permissions/")
            self.assertEqual(response.status_code, 200, response.data)
            self.client.force_authenticate(user=None)

            self.assertEqual(
                sorted(from_login), sorted(response.data["permissions"]),
                f"{role}: the login payload and the rehydrate fetch disagree",
            )

    def test_the_rbac_role_fk_does_not_change_the_answer(self):
        """A user whose `rbac_role` FK is set must be reported the same way.

        The old implementation preferred `rbac_role` over the `role` string and
        read its grants directly. `check_permission` never looks at
        `rbac_role` at all — it resolves off `user.role` — so honouring the FK
        here was itself a divergence, and it is the one that would have made a
        user's reported list depend on which of two role fields was populated.
        """
        for role, user in self.users.items():
            user.rbac_role = Role.objects.get(name=role)
            user.save(update_fields=["rbac_role"])

            reported = self._login(user)
            granted = {c for c in CATALOGUE if check_permission(user, c)}

            self.assertEqual(
                sorted(reported & set(CATALOGUE)), sorted(granted),
                f"{role}: setting rbac_role changed what login reports",
            )


class ReportedPermissionsStayFreshTest(TestCase):
    """A write through this app's own endpoints must show up in the next read.

    `_get_role_permissions_from_db` reads through `check_permission`, which
    caches per (role, codename) for 300s. `assign_role_permissions` writes its
    grants with `bulk_create`, which sends no `post_save`, so the invalidation
    receiver in `apps/audit/signals.py` never fires for those rows. The
    `.delete()` that precedes it covers the case where the role already had
    grants — by accident — and not the case where it had none.

    Reading the database directly, as this endpoint used to, made that
    invisible. Reading through the checker makes an admin's role editor show
    the stale answer back to the admin who just wrote it.
    """

    def setUp(self):
        self.client = APIClient()
        invalidate_all_permissions()
        self.addCleanup(invalidate_all_permissions)
        self.admin = User.objects.create_user(username="fresh_admin", password="x", role="ADMIN")
        self.viewer = User.objects.create_user(username="fresh_viewer", password="x", role="VIEWER")

    def test_a_grant_assigned_to_a_role_with_no_grants_is_visible_immediately(self):
        role = Role.objects.get(name="VIEWER")
        RolePermission.objects.filter(role=role).delete()
        perm, _ = Permission.objects.get_or_create(
            codename=DENIED_BY_DICT,
            defaults={"name": DENIED_BY_DICT, "category": "soul"},
        )
        invalidate_all_permissions()

        # Warm the cache with the pre-assignment answer, the way a page load would.
        self.client.force_authenticate(user=self.viewer)
        self.assertNotIn(
            DENIED_BY_DICT,
            self.client.get("/api/v1/perm/role-permissions/").data["permissions"],
        )

        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/role-permissions/assign/", {
            "role": "VIEWER",
            "permission_ids": [perm.id],
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)

        self.client.force_authenticate(user=self.viewer)
        self.assertIn(
            DENIED_BY_DICT,
            self.client.get("/api/v1/perm/role-permissions/").data["permissions"],
            "the grant was written but the cached denial answered anyway — "
            "bulk_create sends no signal, so assign_role_permissions has to "
            "invalidate on its own",
        )


class ReportedPermissionsQueryCostTest(TestCase):
    """Asking the checker per codename is an N+1 by construction — bound it.

    Measured on a migrate-only database (40 catalogue codenames, 8 of them with
    a Permission row): 49 queries cold, 1 warm, and 1 for ADMIN either way
    because the short-circuit never reaches the database. The alternative to
    the N+1 is a second copy of the resolution rule, which is the defect this
    endpoint has now been rewritten twice to remove — so the cost is accepted
    and pinned here instead, loosely enough to survive new codenames and
    tightly enough to catch a per-codename join appearing inside the loop.
    """

    def setUp(self):
        self.client = APIClient()
        invalidate_all_permissions()
        self.addCleanup(invalidate_all_permissions)

    def _get_as(self, role):
        user, _ = User.objects.get_or_create(username=f"q_{role}", defaults={"role": role})
        self.client.force_authenticate(user=user)
        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get("/api/v1/perm/role-permissions/")
        self.assertEqual(response.status_code, 200)
        return len(ctx.captured_queries)

    def test_a_cold_read_stays_within_two_queries_per_codename(self):
        ceiling = 2 * len(CATALOGUE) + 10
        cold = self._get_as("VIEWER")
        self.assertLessEqual(
            cold, ceiling,
            f"{cold} queries for {len(CATALOGUE)} codenames (ceiling {ceiling}). "
            "check_permission costs one lookup for the Permission row plus one "
            "for the grant; anything above this means something else joined the "
            "per-codename loop",
        )

    def test_a_warm_read_does_not_touch_the_database_per_codename(self):
        self._get_as("VIEWER")  # warms the (role, codename) cache
        warm = self._get_as("VIEWER")
        self.assertLess(
            warm, len(CATALOGUE),
            f"{warm} queries on a warm cache — the per-(role, codename) cache is "
            "not being hit, so every page load pays the cold cost",
        )

    def test_the_admin_role_does_not_pay_per_codename_at_all(self):
        """The short-circuit returns before the cache and before the database."""
        self.assertLess(self._get_as("ADMIN"), 10)
