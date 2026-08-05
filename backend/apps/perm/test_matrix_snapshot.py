"""SNAPSHOT OF THE DEFECT — do not read this file as a specification.

Every expectation below records what SoulLedger's permission layer *actually
does today*, on the tree this file was added to, before any of the repairs
land. It is deliberately not what the system is supposed to do. Several
assertions in here are statements of a live authorization hole: they assert
that a VIEWER can delete a soul, rename it, kill it, open a judgment against
it, and create or destroy the approval workflow that judges it — because that
is what a real JWT through the real URLconf produces right now.

Provenance
----------
The matrix comes from §3 ("Role × capability matrix — measured, not inferred")
of the permission-layer audit, cross-checked against §5 "Step 0 — freeze the
current behaviour in a test", which is the step this file *is*. The audit's
finding, in one line: of the 403s in §3, not one is produced by the codename
permission system. Every single one comes from a hardcoded
``role == 'ADMIN'`` branch in a view body, from DRF's ``IsAdminPermission``,
or from ``IsAdminUser`` (Django ``is_staff``). The declared
``permission_codename`` / ``get_required_permissions()`` machinery gates
nothing — ``PermissionMiddleware`` runs before URL resolution, so it never
sees ``view.action``, and ``checker.py``'s DB branch filters
``RolePermission.objects.filter(role=<str>)`` against a FK, raising
``ValueError`` into a bare ``except`` that falls back to the dict every time.

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
    # declares ledger.read / ledger.manage — enforced by nothing
    "/api/v1/ledger/balance/{soul}/": OPEN_TO_ALL,
    "/api/v1/ledger/effective/{soul}/": OPEN_TO_ALL,
    "/api/v1/ledger/inheritance/{soul}/": OPEN_TO_ALL,
    # same declared codename as the three above; these two 403 only because
    # apps/ledger/views.py:294 spells `role != 'ADMIN'` by hand.
    "/api/v1/ledger/stats/overview/": ADMIN_ONLY,
    "/api/v1/ledger/stats/export/": ADMIN_ONLY,
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
# as VIEWER. Each expectation below is a hole, not a policy.
# ---------------------------------------------------------------------------

# ledger recalculated and persisted, by anyone
LEDGER_CALCULATE = OPEN_TO_ALL
# a read-only role creates, renames, kills and deletes souls
SOUL_CREATE = dict.fromkeys(ROLES, 201)
SOUL_PATCH = OPEN_TO_ALL
SOUL_DIE = OPEN_TO_ALL
SOUL_DELETE = dict.fromkeys(ROLES, 204)
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
# ADMIN clears IsAdminPermission and then 404s on a Role row that no migration
# has seeded into the test database. The 404 is the point: ADMIN got *past* the
# gate that stopped the other four.
PERM_ASSIGN = {"ADMIN": 404, "MODERATOR": 403, "JUDGE": 403, "GUARDIAN": 403, "VIEWER": 403}


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
    """POST /ledger/calculate/ declares ledger.manage. Every role recalculates and persists."""
    soul = _soul(snapshot_tenant, f"snapshot-calc-{role}")
    response = role_clients[role].post(f"/api/v1/ledger/calculate/{soul.id}/", {}, format="json")
    assert response.status_code == LEDGER_CALCULATE[role]


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_soul_create_snapshot(role_clients, snapshot_tenant, role):
    """soul.create is held by neither VIEWER nor GUARDIAN. Both create souls anyway."""
    response = role_clients[role].post(
        "/api/v1/souls/", {"name": f"snapshot-created-by-{role}"}, format="json"
    )
    assert response.status_code == SOUL_CREATE[role]


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_soul_update_snapshot(role_clients, snapshot_tenant, role):
    """soul.update — a VIEWER renames a soul. Side effect confirmed on the row."""
    from apps.souls.models import Soul

    soul = _soul(snapshot_tenant, f"snapshot-patch-{role}")
    response = role_clients[role].patch(
        f"/api/v1/souls/{soul.id}/", {"name": f"RENAMED_BY_{role}"}, format="json"
    )
    assert response.status_code == SOUL_PATCH[role]
    # The status code alone would not prove the write landed.
    assert Soul.objects.get(pk=soul.pk).name == f"RENAMED_BY_{role}"


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_soul_die_snapshot(role_clients, snapshot_tenant, role):
    """soul.die — a VIEWER moves a soul ALIVE -> JUDGING."""
    from apps.souls.models import Soul, SoulState

    soul = _soul(snapshot_tenant, f"snapshot-die-{role}")
    assert soul.current_state == SoulState.ALIVE
    response = role_clients[role].post(f"/api/v1/souls/{soul.id}/die/", {}, format="json")
    assert response.status_code == SOUL_DIE[role]
    assert Soul.objects.get(pk=soul.pk).current_state == SoulState.JUDGING


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_soul_delete_snapshot(role_clients, snapshot_tenant, role):
    """soul.delete — the sharpest edge in §3. A read-only role deletes a soul."""
    soul = _soul(snapshot_tenant, f"snapshot-delete-{role}")
    response = role_clients[role].delete(f"/api/v1/souls/{soul.id}/")
    assert response.status_code == SOUL_DELETE[role]


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
    """ADMIN's 404 and the others' 403 come from two different layers — that is the finding."""
    response = role_clients[role].post(
        "/api/v1/perm/role-permissions/assign/",
        {"role": "VIEWER", "permission_ids": []},
        format="json",
    )
    assert response.status_code == PERM_ASSIGN[role]


@pytest.mark.django_db
def test_snapshot_covers_the_whole_section_3_matrix():
    """Guard the snapshot's own shape: 42 endpoints × 5 roles = 210 cases.

    Deleting a row to make a fix "pass" is a thing that happens. This makes it
    show up as a failure rather than a smaller, quieter test run.
    """
    write_endpoints = 14  # calculate, souls×4, judgment, disposition, workflow×2, post, menu, user, perm×2
    assert len(READ_MATRIX) == 28
    assert len(READ_CASES) == 140
    assert (len(READ_MATRIX) + write_endpoints) * len(ROLES) == 210
