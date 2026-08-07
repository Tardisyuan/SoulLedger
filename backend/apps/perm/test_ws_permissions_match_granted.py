"""Does the WebSocket permission set match what the server will allow?

The fourth answer to "what may this user do?", and until now the one nobody
had reconciled. Three other components already agree because they all ask
`apps/perm/checker.py::check_permission` (directly, or through
`apps/perm/services.py::get_role_permission_codenames`, which is
`check_permission` asked once per candidate codename):

- `apps/perm/checker.py::check_permission` decides what the server does.
- `apps/perm/views.py`'s role-permissions endpoint (`GET /perm/role-permissions/`)
  decides what the UI offers, and is pinned against the checker by
  `apps/perm/test_reported_matches_granted.py`.
- `apps/authentication/serializers.py::UserWithTenantSerializer.get_permissions`
  (the login response) is pinned by the same file.

`apps/core/ws_permissions.py::PermissionMiddleware` and
`apps/notifications/consumers.py::NotificationConsumer` used to be a fifth
and sixth implementation: they resolved off `user.rbac_role` (a separate FK)
via `Role.get_inherited_permissions()`, which walks `Role.parent` and reads
only the `RolePermission` rows attached directly to the role — it never
consulted the `ROLE_PERMISSIONS` dict fallback the checker uses for
unseeded codenames. ADMIN happened to agree because both paths special-cased
it to the full `DEFAULT_PERMISSIONS` catalogue. Every other role did not,
and any user with `rbac_role IS NULL` — unpopulated for anyone created
before migration 0010, and never set at all outside that one backfill —
got an empty permission set regardless of what their `role` actually
granted. Since `consumers.py::realtime_event` drops any event carrying a
`_permission` gate the connected user's set doesn't contain, and it drops
it silently (no error, no log), that under-reporting was invisible: events
simply never arrived.

Both middleware and consumer now delegate to
`get_role_permission_codenames(user.role)`, the same function the reporting
endpoint and the login serializer call — so the property below is the same
one `test_reported_matches_granted.py` states, asked of the WebSocket path
instead of HTTP. `Role.parent` inheritance is deliberately not reproduced:
nothing in migrations, fixtures, `apps/perm/export.py` import/export, or
any management command ever sets a non-NULL `parent` on a `Role` row in
practice, so flattening to the checker's per-codename answer does not
change behaviour any seeded deployment exercises. See the docstrings on
`PermissionMiddleware._resolve_permissions` and
`NotificationConsumer._resolve_permissions` for the full account.
"""
from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase

from apps.core.ws_permissions import PermissionMiddleware
from apps.notifications.consumers import NotificationConsumer
from apps.perm.cache import invalidate_all_permissions
from apps.perm.checker import check_permission
from apps.perm.models import DEFAULT_PERMISSIONS, ROLE_PERMISSIONS, Role

User = get_user_model()

CATALOGUE = [codename for codename, _, _ in DEFAULT_PERMISSIONS]


def _middleware_permissions(user):
    """Resolve permissions the way `PermissionMiddleware` does, synchronously."""
    middleware = PermissionMiddleware(inner=None)
    return async_to_sync(middleware._resolve_permissions)(user)


def _consumer_permissions(user):
    """Resolve permissions the way `NotificationConsumer` does, synchronously."""
    consumer = NotificationConsumer()
    consumer.user = user
    return async_to_sync(consumer._resolve_permissions)()


class WebSocketPermissionsMatchTheCheckerTest(TransactionTestCase):
    """Every role, every declared codename: the WS-resolved set == what check_permission grants.

    TransactionTestCase, not TestCase: every test method here calls
    ``async_to_sync(...)`` around a ``channels.db.database_sync_to_async``
    function, which runs in its own thread and calls Django's
    ``close_old_connections()`` before and after. TestCase wraps the whole
    test in one outer transaction on a single shared connection — a
    worker thread closing "old" connections from underneath that setup
    reliably poisons it (`django.db.utils.InterfaceError: connection
    already closed`, both for the rest of that test and every subsequent
    test in the class). This reproduces deterministically against a real
    Postgres connection; SQLite's far more forgiving connection semantics
    let it slide, which is why this stayed invisible outside CI.
    TransactionTestCase gives each test its own real
    commit/truncate-based lifecycle instead of a shared savepoint, which
    is what this cross-thread pattern actually needs.

    ``serialized_rollback = True`` because the ``Role`` catalogue
    (ADMIN/JUDGE/GUARDIAN/VIEWER/...) is seeded by a data migration
    (``apps/perm/migrations/0017_seed_roles_and_grants.py``), not by this
    class's own ``setUp``. Plain ``TransactionTestCase`` truncates every
    table after each test method and does not re-run migrations, so
    without this flag the second test method onward finds an empty
    ``Role`` table — Django serializes DB state right after migrations
    apply and restores it before each test method specifically to cover
    this case.
    """
    serialized_rollback = True

    def setUp(self):
        invalidate_all_permissions()
        self.addCleanup(invalidate_all_permissions)
        self.users = {
            role: User.objects.create_user(username=f"ws_{role}", password="x", role=role)
            for role in ROLE_PERMISSIONS
        }

    def test_the_catalogue_is_not_empty(self):
        """Guards the guard, same as test_reported_matches_granted.py."""
        self.assertGreaterEqual(len(CATALOGUE), 30)

    def test_middleware_resolves_exactly_what_the_checker_grants(self):
        mismatches = []
        for role, user in self.users.items():
            resolved = _middleware_permissions(user)
            for codename in CATALOGUE:
                is_resolved = codename in resolved
                is_granted = check_permission(user, codename)
                if is_resolved != is_granted:
                    mismatches.append(
                        f"{role}/{codename}: ws_middleware={is_resolved} granted={is_granted}"
                    )

        self.assertEqual(
            mismatches, [],
            "PermissionMiddleware's scope[\"permissions\"] disagrees with "
            "check_permission. Each line is either a permission-gated event "
            "the WebSocket path withholds that the server would allow, or one "
            "it delivers that the server would refuse:\n  " + "\n  ".join(mismatches),
        )

    def test_consumer_resolves_exactly_what_the_checker_grants(self):
        mismatches = []
        for role, user in self.users.items():
            resolved = _consumer_permissions(user)
            for codename in CATALOGUE:
                is_resolved = codename in resolved
                is_granted = check_permission(user, codename)
                if is_resolved != is_granted:
                    mismatches.append(
                        f"{role}/{codename}: ws_consumer={is_resolved} granted={is_granted}"
                    )

        self.assertEqual(
            mismatches, [],
            "NotificationConsumer._resolve_permissions disagrees with "
            "check_permission:\n  " + "\n  ".join(mismatches),
        )

    def test_middleware_and_consumer_agree_with_each_other(self):
        """Both call sites resolve permissions the same way — one rule, two callers."""
        for role, user in self.users.items():
            self.assertEqual(
                sorted(_middleware_permissions(user)),
                sorted(_consumer_permissions(user)),
                f"{role}: PermissionMiddleware and NotificationConsumer disagree",
            )

    def test_a_null_rbac_role_no_longer_empties_the_permission_set(self):
        """The concrete dev-environment bug this change fixes.

        A user with `rbac_role IS NULL` (unpopulated on this branch for
        anyone predating migration 0010, or never set at all) used to
        resolve to an empty WebSocket permission set no matter what `role`
        they held — silently withholding every permission-gated event. It
        must now resolve to exactly what `role` grants.
        """
        for role, user in self.users.items():
            self.assertIsNone(user.rbac_role, "premise: rbac_role is unset by default")
            expected = {c for c in CATALOGUE if check_permission(user, c)}

            self.assertEqual(
                _middleware_permissions(user) & set(CATALOGUE), expected,
                f"{role}: null rbac_role still empties the middleware's permission set",
            )
            self.assertEqual(
                _consumer_permissions(user) & set(CATALOGUE), expected,
                f"{role}: null rbac_role still empties the consumer's permission set",
            )
            if role != "ADMIN":
                self.assertTrue(expected, f"{role}: expected a non-empty grant to prove this")

    def test_the_rbac_role_fk_does_not_change_the_answer(self):
        """Setting `rbac_role` must not change what the WebSocket path resolves.

        Mirrors `apps/perm/test_reported_matches_granted.py
        ::LoginResponsePermissionsMatchTheCheckerTest
        .test_the_rbac_role_fk_does_not_change_the_answer` for the login
        response: `check_permission` resolves off `user.role` and never
        reads the FK, so the WebSocket path must not either.
        """
        for role, user in self.users.items():
            user.rbac_role = Role.objects.get(name=role)
            user.save(update_fields=["rbac_role"])

            expected = {c for c in CATALOGUE if check_permission(user, c)}
            self.assertEqual(_middleware_permissions(user) & set(CATALOGUE), expected)
            self.assertEqual(_consumer_permissions(user) & set(CATALOGUE), expected)

    def test_unauthenticated_user_gets_no_permissions(self):
        from django.contrib.auth.models import AnonymousUser

        anon = AnonymousUser()
        self.assertEqual(_middleware_permissions(anon), set())

        consumer = NotificationConsumer()
        consumer.user = anon
        self.assertEqual(async_to_sync(consumer._resolve_permissions)(), set())
