"""
Whole-project codename coverage.

Every codename a view can require must (a) be defined in DEFAULT_PERMISSIONS
and (b) be held by at least one role in ROLE_PERMISSIONS. A codename that
fails either test is an orphan: it can only ever resolve to False for every
non-ADMIN role, so declaring it means "ADMIN only" while reading like policy.

There is already a test with almost this name — `apps.perm.tests`'s
`test_default_permissions_defines_every_codename_the_views_require`. It
iterates `apps.ledger.views` and nothing else, so it checks six codenames.
That is why seventy-odd orphans accumulated across the other seventeen apps
without anything going red. This module is the whole-project version; the
narrower one is left in place deliberately.

Two things make the enumeration below trustworthy, and both were mistakes made
while writing it:

1. It walks the real URLconf, not `apps.*.views` modules. `apps/authentication`,
   `apps/core` and `apps/death_sync` have no `__init__.py` — they are namespace
   packages, so `pkgutil.iter_modules(apps.__path__)` skips them silently. A
   module walk therefore misses UserViewSet and LoginLogViewSet entirely, and
   misses them without any error. Routing is also the honest definition of
   "every view in the project": a view nothing routes to cannot be reached.

2. It enumerates every action a view can dispatch, not just the ones named in
   `extra_permissions`. Codenames like `audit.by_trace` and `menu.list_public`
   exist precisely because an @action was added without an extra_permissions
   entry, so the mixin fell through to `f"{codename}.{action}"` and invented a
   codename nobody ever seeded. Only enumerating declared keys would look at
   the map and never at the territory.

`_assert_not_vacuous` guards the guard: an enumeration bug that finds nothing
would otherwise report a clean sweep, which is exactly the failure mode of the
test this one replaces.
"""
from django.test import SimpleTestCase
from django.urls import URLPattern, URLResolver, get_resolver

from apps.core.viewsets import ACTION_PERM_MAP, CodenameViewSetMixin
from apps.perm.models import DEFAULT_PERMISSIONS, ROLE_PERMISSIONS

# The six actions a DRF router maps to a URL. A ReadOnlyModelViewSet defines
# only list/retrieve, so hasattr() is what distinguishes read-only viewsets
# from full ones — the audit report's orphan list got this wrong and credited
# realm/actor/tenant/event/login_log with create/update/delete codenames they
# cannot generate.
ROUTER_ACTIONS = ("list", "retrieve", "create", "update", "partial_update", "destroy")

# Views that deliberately declare no codename, each with the reason. Frozen
# here so an exemption stays a reviewed decision: `permission_codename = None`
# passes the coverage assertions trivially, so without this list a module
# could be quietly exempted to make a failure go away and nothing would
# notice. Adding an entry should mean adding a follow-up.
EXEMPT_VIEWS = {
    # No `tenant.*` / `event.*` codename exists anywhere. Both viewsets stay
    # scoped by tenant through their querysets.
    "apps.tenants.views.TenantViewSet": "no tenant.* codename exists; queryset-scoped",
    "apps.events.views.SoulEventViewSet": "no event.* codename exists",
    # `menu.manage` is ADMIN-only but these serve navigation reads to every
    # role. Needs a seeded `menu.read`; blocking for Step 4.
    "apps.menus.views.MenuViewSet": "menu.read missing; menu.manage is ADMIN-only",
    "apps.menus.views.MenuButtonViewSet": "menu.read missing; menu.manage is ADMIN-only",
    # No `login_log.*` codename, and no adjacent one it could honestly borrow.
    "apps.authentication.views.LoginLogViewSet": "no login_log.* codename exists",
    # Whole social module: five viewsets, ~23 codenames, none defined or held.
    "apps.social.views.PostViewSet": "social has no codename family",
    "apps.social.views.CommentViewSet": "social has no codename family",
    "apps.social.views.ReactionViewSet": "social has no codename family",
    "apps.social.views.FollowViewSet": "social has no codename family",
    "apps.social.views.UserProfileViewSet": "social has no codename family",
}

DEFINED_CODENAMES = {codename for codename, _, _ in DEFAULT_PERMISSIONS}
HELD_CODENAMES = {c for codenames in ROLE_PERMISSIONS.values() for c in codenames}


def _view_path(view):
    return f"{view.__module__}.{view.__name__}"


def _routed_views():
    """Every view class reachable through the project URLconf."""
    found = {}

    def walk(resolver):
        for pattern in resolver.url_patterns:
            if isinstance(pattern, URLResolver):
                walk(pattern)
            elif isinstance(pattern, URLPattern):
                callback = pattern.callback
                # DRF viewsets expose `.cls`; as_view()-wrapped APIViews expose
                # `.view_class`.
                view = getattr(callback, "cls", None) or getattr(callback, "view_class", None)
                if view is not None and hasattr(view, "get_required_permissions"):
                    found[_view_path(view)] = view

    walk(get_resolver())
    return found


def _dispatchable_actions(view):
    """Every action name `self.action` can take on this viewset."""
    actions = {name for name in ROUTER_ACTIONS if hasattr(view, name)}
    if hasattr(view, "get_extra_actions"):
        actions |= {method.__name__ for method in view.get_extra_actions()}
    # An extra_permissions key for an action that no longer exists is dead,
    # but a codename it names is still a claim about policy, so check it too.
    actions |= set(getattr(view, "extra_permissions", None) or {})
    return actions


def _required_codenames(view):
    """Every codename `view.get_required_permissions()` can return."""
    if view.get_required_permissions is not CodenameViewSetMixin.get_required_permissions:
        # Hand-written implementation (the ledger APIViews). It does not read
        # self.action, so an uninitialised instance answers correctly.
        return set(view().get_required_permissions() or [])

    base = getattr(view, "permission_codename", None)
    if not base:
        return set()

    extra = getattr(view, "extra_permissions", None) or {}
    codenames = set()
    for action in _dispatchable_actions(view):
        if action in extra:
            codenames.update(extra[action])
        else:
            codenames.add(f"{base}.{ACTION_PERM_MAP.get(action, action)}")
    return codenames


class CodenameCoverageTest(SimpleTestCase):
    """No database: DEFAULT_PERMISSIONS and ROLE_PERMISSIONS are the contract,
    and reading them from the DB instead would make this test pass or fail
    depending on which migrations a given environment happens to have run."""

    def setUp(self):
        self.views = _routed_views()
        self.declaring = {
            path: codenames
            for path, view in self.views.items()
            if (codenames := _required_codenames(view))
        }

    def _assert_not_vacuous(self):
        """A silent enumeration failure must not read as a clean result."""
        self.assertGreaterEqual(
            len(self.views), 25,
            f"only found {len(self.views)} routed views — enumeration is broken, "
            "not the codebase",
        )
        apps_covered = {path.split(".")[1] for path in self.declaring}
        self.assertGreaterEqual(
            len(apps_covered), 10,
            f"only {len(apps_covered)} apps declare codenames ({sorted(apps_covered)}) — "
            "this test exists because the old one only ever reached apps.ledger",
        )
        self.assertIn(
            "apps.authentication.views.UserViewSet", self.views,
            "UserViewSet is missing — apps.authentication is a namespace package, so "
            "a module walk skips it silently; the URLconf walk must not",
        )

    def test_every_required_codename_is_defined_and_held(self):
        """The whole point: no view may require an orphan codename."""
        self._assert_not_vacuous()

        undefined = []
        unheld = []
        for path, codenames in sorted(self.declaring.items()):
            for codename in sorted(codenames):
                if codename not in DEFINED_CODENAMES:
                    undefined.append(f"{path} requires {codename}")
                if codename not in HELD_CODENAMES:
                    unheld.append(f"{path} requires {codename}")

        self.assertEqual(
            undefined, [],
            "codenames required by a view but absent from DEFAULT_PERMISSIONS "
            "(they cannot be seeded, granted, or shown in the permission UI):\n  "
            + "\n  ".join(undefined),
        )
        self.assertEqual(
            unheld, [],
            "codenames required by a view but held by no role in ROLE_PERMISSIONS "
            "(they deny every non-ADMIN role, silently):\n  "
            + "\n  ".join(unheld),
        )

    def test_exempt_views_are_exactly_the_declared_ones(self):
        """Exemption is an escape hatch, so it has to stay visible in review."""
        self._assert_not_vacuous()

        actually_exempt = {
            path for path, view in self.views.items() if not _required_codenames(view)
        }
        expected = set(EXEMPT_VIEWS)

        self.assertEqual(
            sorted(actually_exempt - expected), [],
            "view(s) declare no codename but are not in EXEMPT_VIEWS. Exempting a "
            "module silences the coverage test for it — say so and why, and queue "
            "the follow-up",
        )
        self.assertEqual(
            sorted(expected - actually_exempt), [],
            "EXEMPT_VIEWS names view(s) that now declare codenames — drop them from "
            "the exemption list",
        )

    def test_role_permissions_never_grants_an_undefined_codename(self):
        """ROLE_PERMISSIONS must not outrun the DEFAULT_PERMISSIONS catalogue.

        Seventeen codenames — soul.die, judgment.create, every workflow.*,
        dispatch.approve/reject/execute among them — were granted to roles here
        while missing from the catalogue. That is not a documentation gap:
        apps/core/ws_permissions.py and apps/notifications/consumers.py read
        DEFAULT_PERMISSIONS directly as ADMIN's WebSocket permission set, so
        each missing entry was a class of event ADMIN silently never received,
        and apps/perm/views.py only seeds Permission rows from this list, so
        each one was invisible and ungrantable in the permission UI.
        """
        missing = sorted(
            f"{role}: {codename}"
            for role, codenames in ROLE_PERMISSIONS.items()
            for codename in codenames
            if codename not in DEFINED_CODENAMES
        )
        self.assertEqual(
            missing, [],
            "role(s) granted codenames that DEFAULT_PERMISSIONS does not define:\n  "
            + "\n  ".join(missing),
        )
