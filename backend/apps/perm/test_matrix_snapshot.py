"""SNAPSHOT OF THE DEFECT — do not read this file as a specification.

Every expectation below records what SoulLedger's permission layer *actually
does today*. It is deliberately not, for the most part, what the system is
supposed to do. Several assertions in here are statements of a live
authorization hole: they assert that a VIEWER can open a judgment against a
soul, and create or destroy the approval workflow that judges it — because
that is what a real JWT through the real URLconf produces right now.

**Two apps are no longer a snapshot of the defect: `souls` and `ledger`.**
Step 4 of the staged plan moved enforcement out of ``PermissionMiddleware``
and into a DRF permission class (``apps.core.permissions.CodenamePermission``,
attached to ``SoulViewSet`` and the six ledger ``APIView``s), and those two
apps are the first rollout. Their rows below are now *policy*: each expected
code is derived from whether the role holds the codename the view declares,
and each departure from the old snapshot carries the grant that justifies it.
Every other app in this file is still frozen defect and still reads as such —
which is the point of rolling out per app rather than flipping a flag.

Provenance
----------
The matrix comes from §3 ("Role × capability matrix — measured, not inferred")
of the permission-layer audit, cross-checked against §5 "Step 0 — freeze the
current behaviour in a test", which is the step this file *is*. The audit's
finding, in one line: of the 403s in §3, not one was produced by the codename
permission system. Every single one came from a hardcoded ``role == 'ADMIN'``
branch in a view body, from DRF's ``IsAdminPermission``, or from
``IsAdminUser`` (Django ``is_staff``). The declared ``permission_codename`` /
``get_required_permissions()`` machinery gated nothing — ``PermissionMiddleware``
runs before URL resolution, so it never sees ``view.action``, and
``checker.py``'s DB branch filtered ``RolePermission.objects.filter(role=<str>)``
against a FK, raising ``ValueError`` into a bare ``except`` that fell back to
the dict every time.

That paragraph is now history for two apps and current for the rest. The
checker's lookup was repaired in step 2, and the ledger and souls 403s below
are the first in this file's life to come from a codename rather than from a
hardcoded role string.

Why freeze it
-------------
Steps 2 (fix ``apps/perm/checker.py``'s role lookup) and 3 (reconcile the 71
orphaned codenames) change some of these numbers, and step 4 changes many of
them. Pinning the current answers means each of those steps arrives as a
reviewed diff to this file — someone has to look at a 201 becoming a 403 and
say "yes, that one" — instead of a behaviour change nobody noticed. A failure
here is not automatically a regression; it is a question.

Two rows are load-bearing history rather than plain measurement:

* ``GET /api/v1/organizations/`` is asserted at 200 for every role. The audit
  measured **500** for non-ADMIN (``TenantQuerySetMixin`` filtering
  ``tenant=`` on ``Organization``, which has no such field → ``FieldError``).
  That bug was fixed in ``apps/core/mixins.py`` by a ``hasattr(qs.model,
  "tenant")`` guard between the audit and this snapshot. 200 is the truth now.
* ``GET /api/v1/death-sync/api-keys/`` is 403 for **ADMIN** too. That endpoint
  uses ``IsAdminUser``, which tests Django's ``is_staff`` flag — not
  ``role == 'ADMIN'``. The two admin concepts are unrelated here.

Scope
-----
42 endpoints × 5 roles = 210 (role, endpoint) cases. Real ``RefreshToken``
JWTs carrying a ``tenant_code`` claim, driven through ``config.urls`` with
DRF's ``APIClient``. Nothing is mocked and no middleware is patched: the
audit's §6 finding was that the existing "enforcement" tests either mock the
middleware or assert a 403 that a hardcoded ADMIN check produced, so a test
that mocks anything here would inherit exactly the blindness it exists to
cover.
"""
import uuid

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

ROLES = ["ADMIN", "MODERATOR", "JUDGE", "GUARDIAN", "VIEWER"]

# Shorthands for the two shapes that dominate the matrix. `OPEN_TO_ALL` is the
# defect in its purest form: the endpoint declares a codename, no role-based
# gate runs, everyone gets in. `ADMIN_ONLY` is the opposite — and every one of
# those 403s is a hardcoded role string, never the codename system.
OPEN_TO_ALL = dict.fromkeys(ROLES, 200)
ADMIN_ONLY = {"ADMIN": 200, "MODERATOR": 403, "JUDGE": 403, "GUARDIAN": 403, "VIEWER": 403}


# ---------------------------------------------------------------------------
# §3, the read half. `{soul}` is substituted with a real Soul UUID at runtime.
# ---------------------------------------------------------------------------
READ_MATRIX = {
    # ENFORCED (step 4). All three declare `ledger.read`, and all five roles
    # hold `ledger.read` in ROLE_PERMISSIONS — ADMIN, MODERATOR, JUDGE,
    # GUARDIAN and VIEWER alike. So enforcement changes nothing here, and that
    # is the useful part: these rows prove CodenamePermission grants as well as
    # it denies. A codename layer that only ever produced 403s would be
    # indistinguishable from an outage.
    "/api/v1/ledger/balance/{soul}/": OPEN_TO_ALL,
    "/api/v1/ledger/effective/{soul}/": OPEN_TO_ALL,
    "/api/v1/ledger/inheritance/{soul}/": OPEN_TO_ALL,
    # Same declared codename as the three above, and CodenamePermission lets
    # all five roles through it for the same reason. These two are ADMIN_ONLY
    # purely because the view bodies spell `role != 'ADMIN'` by hand. Retiring
    # that hardcoded check is step 5 and needs an export codename first: on
    # `ledger.read` alone a VIEWER would get the full CSV of every soul.
    "/api/v1/ledger/stats/overview/": ADMIN_ONLY,
    "/api/v1/ledger/stats/export/": ADMIN_ONLY,
    # ENFORCED (step 4): declares `soul.read`, held by all five roles.
    "/api/v1/souls/": OPEN_TO_ALL,
    "/api/v1/judgment/": OPEN_TO_ALL,
    "/api/v1/disposition/": OPEN_TO_ALL,
    "/api/v1/reincarnation/": OPEN_TO_ALL,
    "/api/v1/dispatch/records/": OPEN_TO_ALL,
    "/api/v1/dispatch/cross-tenant-judgments/": OPEN_TO_ALL,
    "/api/v1/workflows/": OPEN_TO_ALL,
    "/api/v1/nodes/": OPEN_TO_ALL,
    # realm.read / actor.read / tenant.read / event.read / menu.read are four
    # of the 71 codenames no role holds. They are open anyway, because nothing
    # consults them.
    "/api/v1/realms/": OPEN_TO_ALL,
    "/api/v1/actors/": OPEN_TO_ALL,
    # 200 for everyone, but NOT a cross-tenant leak: TenantViewSet.get_queryset
    # scopes non-ADMIN to their own tenant row.
    "/api/v1/tenants/": OPEN_TO_ALL,
    "/api/v1/events/": OPEN_TO_ALL,
    # likewise tenant-filtered in get_queryset
    "/api/v1/audit-logs/": OPEN_TO_ALL,
    # apps/audit/views.py:136, hardcoded
    "/api/v1/audit-logs/stats/": ADMIN_ONLY,
    "/api/v1/notifications/": OPEN_TO_ALL,
    "/api/v1/menus/": OPEN_TO_ALL,
    "/api/v1/social/posts/": OPEN_TO_ALL,
    # IsAdminPermission — a real gate, just not a codename one
    "/api/v1/users/": ADMIN_ONLY,
    "/api/v1/auth/login-logs/": ADMIN_ONLY,
    # IsAuthenticated only: every logged-in user can read the permission model
    # itself. Information disclosure, not privilege escalation.
    "/api/v1/perm/permissions/": OPEN_TO_ALL,
    "/api/v1/perm/roles/": OPEN_TO_ALL,
    # see the module docstring: audit measured 500, the FieldError is now fixed
    "/api/v1/organizations/": OPEN_TO_ALL,
    # IsAdminUser == Django is_staff, so ADMIN is refused too
    "/api/v1/death-sync/api-keys/": dict.fromkeys(ROLES, 403),
}

# ---------------------------------------------------------------------------
# §3, the write half — "The dangerous ones", side effects verified in the audit
# as VIEWER. Each expectation below is a hole, not a policy — EXCEPT the ledger
# and soul entries, which step 4 turned into policy. Those five carry their
# justification inline: the codename the view declares, and which roles hold it
# in ROLE_PERMISSIONS. A code here changed only because a role does not hold
# the codename; not one grant was added to make any of this line up.
# ---------------------------------------------------------------------------

# ENFORCED. POST /ledger/calculate/ declares `ledger.manage` (LedgerRecalculateView).
# `ledger.manage` is held by ADMIN and MODERATOR only. JUDGE, GUARDIAN and
# VIEWER hold `ledger.read` and stop there — reading a soul's ledger and
# rewriting it are different powers, and only these two roles hold the second.
# Was OPEN_TO_ALL, i.e. any authenticated role could recalculate and persist a
# soul's scores. That was the defect.
LEDGER_CALCULATE = {"ADMIN": 200, "MODERATOR": 200, "JUDGE": 403, "GUARDIAN": 403, "VIEWER": 403}

# ENFORCED. POST /souls/ declares `soul.create`.
# Held by ADMIN and MODERATOR. JUDGE, GUARDIAN and VIEWER do not hold it —
# a judge rules on souls that exist, a guardian maintains them, a viewer reads.
# Was 201 for all five.
SOUL_CREATE = {"ADMIN": 201, "MODERATOR": 201, "JUDGE": 403, "GUARDIAN": 403, "VIEWER": 403}

# ENFORCED. PATCH /souls/{id}/ declares `soul.update`.
# Held by ADMIN, MODERATOR and GUARDIAN. GUARDIAN keeping this while losing
# `soul.die` below is the declared policy, not an oversight: custody of a soul's
# record is the guardian's job; ending its life is not.
# JUDGE and VIEWER hold neither. Was 200 for all five — the audit measured a
# VIEWER renaming a soul to 'RENAMED_BY_VIEWER' and the row keeping the name.
SOUL_PATCH = {"ADMIN": 200, "MODERATOR": 200, "JUDGE": 403, "GUARDIAN": 200, "VIEWER": 403}

# ENFORCED. POST /souls/{id}/die/ declares `soul.die` (via extra_permissions).
# Held by ADMIN, MODERATOR and JUDGE. GUARDIAN and VIEWER do not hold it, so
# the mirror of SOUL_PATCH: the guardian may edit but not kill, the judge may
# kill but not edit. Was 200 for all five, moving ALIVE -> JUDGING for anyone.
SOUL_DIE = {"ADMIN": 200, "MODERATOR": 200, "JUDGE": 200, "GUARDIAN": 403, "VIEWER": 403}

# ENFORCED. DELETE /souls/{id}/ declares `soul.delete`. ADMIN alone holds it.
# MODERATOR's exclusion is deliberate and documented at the ROLE_PERMISSIONS
# entry itself — "no soul.delete while deletion semantics are still unsettled"
# — so a realm lead who may create, edit and kill souls still may not erase
# one. JUDGE, GUARDIAN and VIEWER never held it either.
# Was 204 for all five. This is the sharpest line in the audit: a read-only
# role deleted a soul and the row went soft_deleted=1.
SOUL_DELETE = {"ADMIN": 204, "MODERATOR": 403, "JUDGE": 403, "GUARDIAN": 403, "VIEWER": 403}

# a VIEWER opens a judgment proceeding against a soul
JUDGMENT_CREATE = dict.fromkeys(ROLES, 201)
DISPOSITION_CREATE = dict.fromkeys(ROLES, 201)
# a VIEWER designs, then destroys, the approval workflow that judges souls
WORKFLOW_TEMPLATE_CREATE = dict.fromkeys(ROLES, 201)
WORKFLOW_TEMPLATE_DELETE = dict.fromkeys(ROLES, 204)
POST_CREATE = dict.fromkeys(ROLES, 201)
# the three that do hold, all by hardcoded role string
MENU_CREATE = {"ADMIN": 201, "MODERATOR": 403, "JUDGE": 403, "GUARDIAN": 403, "VIEWER": 403}
USER_CREATE = {"ADMIN": 201, "MODERATOR": 403, "JUDGE": 403, "GUARDIAN": 403, "VIEWER": 403}
PERM_CREATE = {"ADMIN": 201, "MODERATOR": 403, "JUDGE": 403, "GUARDIAN": 403, "VIEWER": 403}
# ADMIN clears IsAdminPermission; the other four never get that far. That split
# across two layers is the finding, and it is unchanged.
#
# ADMIN's own code moved 404 -> 200 when perm migration 0017 started seeding the
# Role rows. It is not an access change: ADMIN always got past the gate, it just
# used to land on a VIEWER row no migration had created. Now the row exists and
# the call completes — and completing it means what the endpoint's docstring
# says, "替换该角色的所有权限": posting permission_ids=[] wipes every grant VIEWER
# has. The test is transactional so it rolls back, but read that 200 as "ADMIN
# just cleared a role's entire permission set with an empty list and got no
# confirmation step", which is the more interesting version of the finding.
PERM_ASSIGN = {"ADMIN": 200, "MODERATOR": 403, "JUDGE": 403, "GUARDIAN": 403, "VIEWER": 403}


# Every enforced write endpoint from the two step-4 apps, paired with the
# expectation frozen above. Used twice: once implicitly by the per-endpoint
# tests below (dict resolution path) and once by
# test_enforced_writes_agree_through_the_db_path (DB resolution path).
ENFORCED_WRITE_PROBES = {
    "POST /ledger/calculate/{soul}/": (
        lambda client, soul: client.post(f"/api/v1/ledger/calculate/{soul.id}/", {}, format="json"),
        LEDGER_CALCULATE,
    ),
    "POST /souls/": (
        lambda client, soul: client.post(
            "/api/v1/souls/", {"name": "dbpath-probe"}, format="json"
        ),
        SOUL_CREATE,
    ),
    "PATCH /souls/{soul}/": (
        lambda client, soul: client.patch(
            f"/api/v1/souls/{soul.id}/", {"name": "dbpath-renamed"}, format="json"
        ),
        SOUL_PATCH,
    ),
    "POST /souls/{soul}/die/": (
        lambda client, soul: client.post(f"/api/v1/souls/{soul.id}/die/", {}, format="json"),
        SOUL_DIE,
    ),
    "DELETE /souls/{soul}/": (
        lambda client, soul: client.delete(f"/api/v1/souls/{soul.id}/"),
        SOUL_DELETE,
    ),
}


@pytest.fixture
def snapshot_tenant(db):
    """Single tenant; every role's user and every fixture row lives in it."""
    from apps.tenants.managers import clear_current_tenant
    from apps.tenants.models import Tenant

    clear_current_tenant()
    tenant, _ = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "Chinese Diyu"}
    )
    yield tenant
    clear_current_tenant()


@pytest.fixture
def role_clients(db, django_user_model, snapshot_tenant):
    """One authenticated APIClient per role, keyed by role name.

    Real JWTs via RefreshToken.for_user, with the `tenant_code` claim
    TenantMiddleware reads. No mocking, no forced authentication.
    """
    clients = {}
    for role in ROLES:
        user, _ = django_user_model.objects.get_or_create(
            username=f"snapshot_{role.lower()}",
            defaults={"role": role, "tenant": snapshot_tenant},
        )
        token = RefreshToken.for_user(user)
        token["tenant_code"] = snapshot_tenant.code
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        clients[role] = client
    return clients


def _soul(tenant, name):
    from apps.souls.models import Soul

    return Soul.objects.create(name=name, tenant=tenant)


def _template(tenant, name):
    from apps.souls.models import Civilization
    from apps.workflow.models import CaseType, WorkflowTemplate

    return WorkflowTemplate.objects.create(
        name=name,
        civilization=Civilization.CHINESE,
        case_type=CaseType.ROUTINE,
        tenant=tenant,
    )


# Flattened so pytest reports one case per (role, endpoint) pair — 140 read
# cases here, 70 write cases below, 210 in total.
READ_CASES = [
    (path, role, expected[role])
    for path, expected in READ_MATRIX.items()
    for role in ROLES
]


@pytest.mark.django_db
@pytest.mark.parametrize("path,role,expected", READ_CASES, ids=lambda v: str(v))
def test_read_matrix_snapshot(role_clients, snapshot_tenant, path, role, expected):
    """GET every §3 read endpoint as every role. Codes are today's, not tomorrow's."""
    soul = _soul(snapshot_tenant, "snapshot-read-fixture")
    response = role_clients[role].get(path.format(soul=soul.id))
    assert response.status_code == expected, (
        f"{role} GET {path} returned {response.status_code}, snapshot says {expected}. "
        f"If a permission fix caused this, update the snapshot deliberately."
    )


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_ledger_calculate_snapshot(role_clients, snapshot_tenant, role):
    """ENFORCED: ledger.manage. ADMIN and MODERATOR hold it; the other three read only."""
    soul = _soul(snapshot_tenant, f"snapshot-calc-{role}")
    response = role_clients[role].post(f"/api/v1/ledger/calculate/{soul.id}/", {}, format="json")
    assert response.status_code == LEDGER_CALCULATE[role]


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_soul_create_snapshot(role_clients, snapshot_tenant, role):
    """ENFORCED: soul.create. Held by neither VIEWER nor GUARDIAN — and now they cannot."""
    from apps.souls.models import Soul

    name = f"snapshot-created-by-{role}"
    response = role_clients[role].post("/api/v1/souls/", {"name": name}, format="json")
    assert response.status_code == SOUL_CREATE[role]
    # A 403 that still wrote the row would be the worst of both worlds, so the
    # denial is asserted on the table, not just on the status line.
    assert Soul.objects.filter(name=name).exists() == (SOUL_CREATE[role] == 201)


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_soul_update_snapshot(role_clients, snapshot_tenant, role):
    """ENFORCED: soul.update. GUARDIAN may rename a soul; JUDGE and VIEWER may not."""
    from apps.souls.models import Soul

    original = f"snapshot-patch-{role}"
    soul = _soul(snapshot_tenant, original)
    response = role_clients[role].patch(
        f"/api/v1/souls/{soul.id}/", {"name": f"RENAMED_BY_{role}"}, format="json"
    )
    assert response.status_code == SOUL_PATCH[role]
    # The status code alone proves neither that the write landed nor that the
    # denial prevented it. Assert the row both ways.
    expected_name = f"RENAMED_BY_{role}" if SOUL_PATCH[role] == 200 else original
    assert Soul.objects.get(pk=soul.pk).name == expected_name


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_soul_die_snapshot(role_clients, snapshot_tenant, role):
    """ENFORCED: soul.die. JUDGE may end a life; GUARDIAN, who may edit the record, may not."""
    from apps.souls.models import Soul, SoulState

    soul = _soul(snapshot_tenant, f"snapshot-die-{role}")
    assert soul.current_state == SoulState.ALIVE
    response = role_clients[role].post(f"/api/v1/souls/{soul.id}/die/", {}, format="json")
    assert response.status_code == SOUL_DIE[role]
    expected_state = SoulState.JUDGING if SOUL_DIE[role] == 200 else SoulState.ALIVE
    assert Soul.objects.get(pk=soul.pk).current_state == expected_state


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_soul_delete_snapshot(role_clients, snapshot_tenant, role):
    """ENFORCED: soul.delete, ADMIN only. The sharpest edge in §3, now closed."""
    from apps.souls.models import Soul

    soul = _soul(snapshot_tenant, f"snapshot-delete-{role}")
    response = role_clients[role].delete(f"/api/v1/souls/{soul.id}/")
    assert response.status_code == SOUL_DELETE[role]
    # Deletion is soft, so Soul.objects (which excludes soft-deleted rows) is
    # what "gone" means here — the audit measured soft_deleted=1 after a VIEWER
    # called this. The four denied roles must leave the soul visible.
    assert Soul.objects.filter(pk=soul.pk).exists() == (SOUL_DELETE[role] == 403)


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_judgment_create_snapshot(role_clients, snapshot_tenant, role):
    """judgment.create — a VIEWER opens a judgment proceeding against a soul."""
    from apps.souls.models import Civilization

    soul = _soul(snapshot_tenant, f"snapshot-judgment-{role}")
    response = role_clients[role].post(
        "/api/v1/judgment/",
        {"soul": str(soul.id), "civilization": Civilization.CHINESE, "court": "第一殿"},
        format="json",
    )
    assert response.status_code == JUDGMENT_CREATE[role]


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_disposition_create_snapshot(role_clients, snapshot_tenant, role):
    """disposition.create is one of the 71 codenames no role holds. Open to all five."""
    soul = _soul(snapshot_tenant, f"snapshot-disposition-{role}")
    response = role_clients[role].post(
        "/api/v1/disposition/", {"soul": str(soul.id)}, format="json"
    )
    assert response.status_code == DISPOSITION_CREATE[role]


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_workflow_template_create_snapshot(role_clients, snapshot_tenant, role):
    """workflow.create — a VIEWER designs the approval flow that judges souls."""
    from apps.souls.models import Civilization
    from apps.workflow.models import CaseType

    response = role_clients[role].post(
        "/api/v1/workflow/templates/",
        {
            "name": f"snapshot-tpl-{role}-{uuid.uuid4().hex[:8]}",
            "civilization": Civilization.CHINESE,
            "case_type": CaseType.ROUTINE,
        },
        format="json",
    )
    assert response.status_code == WORKFLOW_TEMPLATE_CREATE[role]


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_workflow_template_delete_snapshot(role_clients, snapshot_tenant, role):
    """workflow.delete — and the same VIEWER destroys it again."""
    from apps.workflow.models import WorkflowTemplate

    template = _template(snapshot_tenant, f"snapshot-del-tpl-{role}")
    response = role_clients[role].delete(f"/api/v1/workflow/templates/{template.id}/")
    assert response.status_code == WORKFLOW_TEMPLATE_DELETE[role]
    assert not WorkflowTemplate.objects.filter(pk=template.pk).exists()


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_social_post_create_snapshot(role_clients, snapshot_tenant, role):
    """The whole social module has codenames but no role holds any of them."""
    response = role_clients[role].post(
        "/api/v1/social/posts/", {"content": f"snapshot post from {role}"}, format="json"
    )
    assert response.status_code == POST_CREATE[role]


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_menu_create_snapshot(role_clients, snapshot_tenant, role):
    """403 here is real — but it comes from `role != "ADMIN"` in perform_create, not menu.create."""
    response = role_clients[role].post(
        "/api/v1/menus/", {"name": f"snapshot-menu-{role}", "path": f"/snapshot-{role}"}, format="json"
    )
    assert response.status_code == MENU_CREATE[role]


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_user_create_snapshot(role_clients, snapshot_tenant, role):
    """403 from IsAdminPermission. UserViewSet's user.* codenames are held by no role."""
    response = role_clients[role].post(
        "/api/v1/users/",
        {"username": f"snapshot-new-{role}-{uuid.uuid4().hex[:6]}", "password": "Sn4pSh0t!pass"},
        format="json",
    )
    assert response.status_code == USER_CREATE[role]


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_perm_permission_create_snapshot(role_clients, snapshot_tenant, role):
    """403 from IsAdminPermission on the permission model's own write endpoint."""
    response = role_clients[role].post(
        "/api/v1/perm/permissions/create/",
        {"codename": f"snapshot.{role.lower()}", "name": "snapshot probe", "category": "snapshot"},
        format="json",
    )
    assert response.status_code == PERM_CREATE[role]


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_perm_assign_snapshot(role_clients, snapshot_tenant, role):
    """ADMIN's outcome and the others' 403 come from two different layers — that is the finding."""
    response = role_clients[role].post(
        "/api/v1/perm/role-permissions/assign/",
        {"role": "VIEWER", "permission_ids": []},
        format="json",
    )
    assert response.status_code == PERM_ASSIGN[role]


# ---------------------------------------------------------------------------
# The second resolution path.
#
# check_permission() answers a codename from the DB when a Permission row for
# it exists, and from the ROLE_PERMISSIONS dict when it does not. On a
# migrate-only database — which is the only kind CI ever builds — the seeded
# codenames are exactly `workflow.*` and `menu.read`. Nothing seeds `soul.*` or
# `ledger.*`, so every expectation above is measuring the DICT path.
#
# A deployed database is not migrate-only. Dev has Permission rows for soul.*
# and ledger.* (created by apps/perm/views.py's init endpoint, which no
# migration owns) and 49 RolePermission rows, so there the DB decides and the
# dict is never consulted. The matrix frozen above therefore pins the path CI
# happens to exercise and says nothing about the path production runs on.
#
# These cases close that gap: seed the codenames, grant them from
# ROLE_PERMISSIONS, and drive the same five endpoints again. Identical codes
# mean the two paths agree and CodenamePermission gets the same answer either
# way — in particular that checker.py's `role__name=` join really does resolve
# through the RolePermission table, end to end over HTTP, rather than falling
# back to the dict without anyone noticing.
#
# WHAT THIS CANNOT DO, stated plainly so nobody reads more into a green run:
# the grants below are built FROM ROLE_PERMISSIONS, so the two sources agree by
# construction. This proves the DB path is wired correctly. It cannot prove
# that any particular deployed database's grant table matches the dict — dev's
# real grants have never been compared against it (the audit measured dev at
# perm migration 0012, four behind). That comparison needs to run against the
# actual database; it is not a thing a test on a fresh test DB can stand in for.
# ---------------------------------------------------------------------------


@pytest.fixture
def soul_and_ledger_seeded_in_db(db):
    """Make the DB authoritative for soul.* and ledger.*, then hand it back.

    The permission cache is a process-global singleton with a 300s TTL and no
    per-test reset, so a dict-path answer computed by an earlier test in the
    same process would otherwise be served to these ones. Invalidated on the
    way in AND on the way out — leaving DB-derived answers cached would corrupt
    every dict-path test that runs after this fixture.
    """
    from apps.perm.cache import invalidate_all_permissions
    from apps.perm.models import DEFAULT_PERMISSIONS, ROLE_PERMISSIONS, Permission, Role, RolePermission

    invalidate_all_permissions()

    codenames = {
        codename: (name, category)
        for codename, name, category in DEFAULT_PERMISSIONS
        if codename.startswith(("soul.", "ledger."))
    }
    perms = {}
    for codename, (name, category) in codenames.items():
        perms[codename], _ = Permission.objects.get_or_create(
            codename=codename, defaults={"name": name, "category": category}
        )

    for role_name, granted in ROLE_PERMISSIONS.items():
        role, _ = Role.objects.get_or_create(
            name=role_name, defaults={"display_name": role_name.title()}
        )
        for codename in granted:
            if codename in perms:
                RolePermission.objects.get_or_create(role=role, permission=perms[codename])

    yield codenames
    invalidate_all_permissions()


@pytest.mark.django_db
@pytest.mark.parametrize("probe_name", list(ENFORCED_WRITE_PROBES), ids=lambda v: str(v))
@pytest.mark.parametrize("role", ROLES)
def test_enforced_writes_agree_through_the_db_path(
    role_clients, snapshot_tenant, soul_and_ledger_seeded_in_db, role, probe_name
):
    """Same five endpoints, same expected codes, resolved from RolePermission rows."""
    probe, expected = ENFORCED_WRITE_PROBES[probe_name]
    soul = _soul(snapshot_tenant, f"dbpath-{role}-{uuid.uuid4().hex[:8]}")
    response = probe(role_clients[role], soul)
    assert response.status_code == expected[role], (
        f"{role} {probe_name} returned {response.status_code} with soul.*/ledger.* "
        f"seeded in the Permission table, but {expected[role]} when the same check "
        f"resolves through the ROLE_PERMISSIONS dict. The two paths have diverged: "
        f"CI builds the dict path, deployments run the DB one."
    )


@pytest.mark.django_db
def test_seeding_actually_moved_those_codenames_onto_the_db_path(soul_and_ledger_seeded_in_db):
    """Guard the fixture above: if it seeds nothing, the DB-path cases are dict cases.

    Without this, a rename of the soul/ledger codenames would empty the fixture
    and all 25 cases above would silently go on measuring the dict a second
    time — passing, and testing nothing they claim to test.
    """
    from apps.perm.models import Permission

    assert len(soul_and_ledger_seeded_in_db) == 8, soul_and_ledger_seeded_in_db
    for codename in soul_and_ledger_seeded_in_db:
        assert Permission.objects.filter(codename=codename).exists(), codename


@pytest.mark.django_db
def test_snapshot_covers_the_whole_section_3_matrix():
    """Guard the snapshot's own shape: 42 endpoints × 5 roles = 210 cases.

    Deleting a row to make a fix "pass" is a thing that happens. This makes it
    show up as a failure rather than a smaller, quieter test run.

    Step 4 changed 14 of the 210 codes and deleted none of them, which is the
    property this assertion exists to keep checkable.
    """
    write_endpoints = 14  # calculate, souls×4, judgment, disposition, workflow×2, post, menu, user, perm×2
    assert len(READ_MATRIX) == 28
    assert len(READ_CASES) == 140
    assert (len(READ_MATRIX) + write_endpoints) * len(ROLES) == 210
    # The five enforced write endpoints are additionally driven through the DB
    # resolution path — 25 more cases. Pinned here for the same reason as the
    # 210: dropping a probe would shrink the run without failing it.
    assert len(ENFORCED_WRITE_PROBES) == 5
    assert len(ENFORCED_WRITE_PROBES) * len(ROLES) == 25
