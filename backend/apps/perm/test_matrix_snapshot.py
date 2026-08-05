"""SNAPSHOT OF THE DEFECT — do not read this file as a specification.

Every expectation below records what SoulLedger's permission layer *actually
does today*. It is deliberately not, for the most part, what the system is
supposed to do. Several assertions in here are statements of a live
authorization hole: they assert that a VIEWER can open a judgment against a
soul, and create or destroy the approval workflow that judges it — because
that is what a real JWT through the real URLconf produces right now.

**Five apps are no longer a snapshot of the defect: `ledger`, `souls`,
`judgment`, `disposition` and `workflow`.**
Step 4 of the staged plan moved enforcement out of ``PermissionMiddleware``
and into a DRF permission class (``apps.core.permissions.CodenamePermission``).
Tranche 1 attached it to ``SoulViewSet`` and the six ledger ``APIView``s;
tranche 2 attached it to ``JudgmentViewSet``, ``DispositionViewSet``,
``WorkflowTemplateViewSet``, ``ApprovalWorkflowViewSet`` and
``ApprovalNodeViewSet``. Their rows below are now *policy*: each expected
code is derived from whether the role holds the codename the view declares,
and each departure from the old snapshot carries the grant that justifies it.
Every other app in this file is still frozen defect and still reads as such —
which is the point of rolling out per app rather than flipping a flag.

Tranche 2 stops there, and the reason is this file. `social`, `menus` and the
ten apps with no non-ADMIN HTTP-write coverage at all come after, but nothing
in the suite would react to them: the snapshot is the only instrument the
rollout has, and these are the last three apps it can see.

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
45 endpoints × 5 roles = 225 (role, endpoint) cases. Real ``RefreshToken``
JWTs carrying a ``tenant_code`` claim, driven through ``config.urls`` with
DRF's ``APIClient``. Nothing is mocked and no middleware is patched: the
audit's §6 finding was that the existing "enforcement" tests either mock the
middleware or assert a 403 that a hardcoded ADMIN check produced, so a test
that mocks anything here would inherit exactly the blindness it exists to
cover.

It was 42 × 5 = 210 until tranche 2. Tranche 1 landed 19 role × action denials
on ``souls`` but only 14 of them crossed an endpoint this file drives:
``transition``, ``add_record`` and ``PUT /souls/{id}/`` were newly denied with
nothing watching. Widening a frozen scope is a reviewed decision and tranche 1
declined to take it alone; it has since been taken, and the three endpoints are
in the matrix below. Tranche 2 itself adds no endpoints — it moves 18 codes
across rows that were already here, which is what makes the shape guard at the
bottom of this file worth reading: the count changed once, deliberately, and
nothing after that may shrink it.
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

# The three read shapes tranche 2 introduces. Each is named for the codename
# that produces it, not for the roles it happens to admit, because the roles
# are a consequence: ROLE_PERMISSIONS is the input and these dicts are the
# output. Read them alongside apps/perm/models.py::ROLE_PERMISSIONS.
#
# `judgment.read` — ADMIN, MODERATOR, JUDGE. Not GUARDIAN, not VIEWER.
JUDGMENT_READ = {"ADMIN": 200, "MODERATOR": 200, "JUDGE": 200, "GUARDIAN": 403, "VIEWER": 403}
# `disposition.read` — ADMIN, MODERATOR, JUDGE, GUARDIAN. Not VIEWER.
DISPOSITION_READ = {"ADMIN": 200, "MODERATOR": 200, "JUDGE": 200, "GUARDIAN": 200, "VIEWER": 403}
# `workflow.read` — ADMIN, MODERATOR, JUDGE. Not GUARDIAN, not VIEWER.
WORKFLOW_READ = {"ADMIN": 200, "MODERATOR": 200, "JUDGE": 200, "GUARDIAN": 403, "VIEWER": 403}
# The one tranche 3 introduces.
#
# `dispatch.read` — ADMIN, MODERATOR, GUARDIAN. Not JUDGE, not VIEWER, and the
# JUDGE half is worth pausing on: it is the only read shape in this file where
# JUDGE is refused and GUARDIAN admitted. That is not an oversight to be tidied
# up. JUDGE holds no `dispatch.*` codename whatsoever, while the unused
# `cross_judgment.read` family — held by ADMIN, JUDGE and MODERATOR — looks
# written for exactly the cross-tenant-judgments route below. Adopting it would
# flip these two rows: JUDGE would gain the read and GUARDIAN would lose it.
# That is a policy change and belongs to the lead; apps/dispatch/views.py flags
# it as an open decision and this pass keeps the family the view declares.
DISPATCH_READ = {"ADMIN": 200, "MODERATOR": 200, "JUDGE": 403, "GUARDIAN": 200, "VIEWER": 403}


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
    # ENFORCED (tranche 2): declares `judgment.read`. Held by ADMIN, MODERATOR
    # and JUDGE. GUARDIAN and VIEWER hold no `judgment.*` codename at all — the
    # guardian's business is the soul's record, not the case against it. Was
    # OPEN_TO_ALL.
    "/api/v1/judgment/": JUDGMENT_READ,
    # ENFORCED (tranche 2): declares `disposition.read`. Held by ADMIN,
    # MODERATOR, JUDGE and GUARDIAN — four of five. VIEWER is the only role
    # without it, and the only code that moves here. Was OPEN_TO_ALL.
    "/api/v1/disposition/": DISPOSITION_READ,
    # ENFORCED (tranche 3): declares `reincarnation.read`, held by all five
    # roles, so this row does not move. Kept as OPEN_TO_ALL deliberately rather
    # than left uncommented — after enforcement a 200 here is the codename
    # system granting, not the absence of a check, and those look identical
    # from the outside.
    "/api/v1/reincarnation/": OPEN_TO_ALL,
    # ENFORCED (tranche 3): both declare `dispatch.read`. Held by ADMIN,
    # MODERATOR and GUARDIAN; JUDGE and VIEWER hold no `dispatch.*` codename at
    # all. Both were OPEN_TO_ALL — these four codes are the only READ moves in
    # tranche 3, and they are the four the write-side instrument could not
    # predict because it enumerates write endpoints only. See DISPATCH_READ.
    "/api/v1/dispatch/records/": DISPATCH_READ,
    "/api/v1/dispatch/cross-tenant-judgments/": DISPATCH_READ,
    # ENFORCED (tranche 2): both declare `workflow.read`, held by ADMIN,
    # MODERATOR and JUDGE. GUARDIAN and VIEWER hold nothing in the `workflow.*`
    # family. Was OPEN_TO_ALL for both.
    "/api/v1/workflows/": WORKFLOW_READ,
    "/api/v1/nodes/": WORKFLOW_READ,
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
    # ENFORCED (tranche 3): declares `notification.read`, held by all five
    # roles and the only codename NotificationViewSet resolves to. Does not
    # move, and proving it does not move is the reason the app was enforced
    # rather than skipped.
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
# as VIEWER. Each expectation below is a hole, not a policy — EXCEPT the ledger,
# soul, judgment, disposition and workflow entries, which step 4 turned into
# policy across two tranches. Those twelve carry their justification inline: the
# codename the view declares, and which roles hold it in ROLE_PERMISSIONS. A
# code here changed only because a role does not hold the codename; not one
# grant was added to make any of this line up, in either tranche.
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

# ENFORCED. PUT /souls/{id}/ declares `soul.update` — the same codename as the
# PATCH above, because ACTION_PERM_MAP sends both `update` and `partial_update`
# to the `.update` suffix. A distinct route with the same policy is still a
# distinct route: nothing in this file would have noticed if only one of the two
# had been wired to CodenamePermission, which is exactly the sort of half-applied
# enforcement a per-app rollout can produce.
# Held by ADMIN, MODERATOR and GUARDIAN; JUDGE and VIEWER hold neither. Was 200
# for all five, and tranche 1 denied JUDGE and VIEWER here without a witness.
SOUL_PUT = {"ADMIN": 200, "MODERATOR": 200, "JUDGE": 403, "GUARDIAN": 200, "VIEWER": 403}

# ENFORCED. POST /souls/{id}/add_record/ declares `soul.update` (via
# extra_permissions), so the same three roles hold it: ADMIN, MODERATOR,
# GUARDIAN. Appending a merit or demerit record to a soul's ledger is an edit to
# that soul's record and is priced as one. JUDGE not holding it is worth a
# second look and is policy as declared, not an oversight of this change: a
# judge rules from the record and does not write it. Was 201 for all five —
# tranche 1's second unwitnessed denial.
SOUL_ADD_RECORD = {"ADMIN": 201, "MODERATOR": 201, "JUDGE": 403, "GUARDIAN": 201, "VIEWER": 403}

# ENFORCED. POST /souls/{id}/transition/ declares `soul.transition` (via
# extra_permissions). Held by ADMIN, MODERATOR, JUDGE and GUARDIAN — four of
# five. VIEWER alone is denied, which is the whole of the change here and the
# thinnest of tranche 1's three blind spots. Note it is a strictly wider grant
# than `soul.die`: GUARDIAN cannot POST /die/ but can drive ALIVE -> JUDGING
# through this endpoint, so the two are not interchangeable gates on the same
# act and `soul.die` is not the belt-and-braces it looks like. Flagged, not
# fixed — narrowing `soul.transition` is an authorization decision.
SOUL_TRANSITION = {"ADMIN": 200, "MODERATOR": 200, "JUDGE": 200, "GUARDIAN": 200, "VIEWER": 403}

# ENFORCED. DELETE /souls/{id}/ declares `soul.delete`. ADMIN alone holds it.
# MODERATOR's exclusion is deliberate and documented at the ROLE_PERMISSIONS
# entry itself — "no soul.delete while deletion semantics are still unsettled"
# — so a realm lead who may create, edit and kill souls still may not erase
# one. JUDGE, GUARDIAN and VIEWER never held it either.
# Was 204 for all five. This is the sharpest line in the audit: a read-only
# role deleted a soul and the row went soft_deleted=1.
SOUL_DELETE = {"ADMIN": 204, "MODERATOR": 403, "JUDGE": 403, "GUARDIAN": 403, "VIEWER": 403}

# ENFORCED (tranche 2). POST /judgment/ declares `judgment.create`.
# Held by ADMIN, MODERATOR and JUDGE. GUARDIAN and VIEWER hold no `judgment.*`
# codename whatsoever, so they cannot open a proceeding — nor, per
# JUDGMENT_READ above, read one. Was 201 for all five: the audit measured a
# VIEWER filing a judgment against a soul, and `perform_create` then walks that
# soul ALIVE -> JUDGING, so the 201 was also a state change on a second row.
JUDGMENT_CREATE = {"ADMIN": 201, "MODERATOR": 201, "JUDGE": 201, "GUARDIAN": 403, "VIEWER": 403}

# ENFORCED (tranche 2). POST /disposition/ maps to `disposition.execute`, not to
# a `disposition.create` — that codename exists nowhere, and the viewset's
# extra_permissions routes create/update/partial_update/destroy to `.execute`,
# this module's only write verb. Held by ADMIN and MODERATOR alone.
# JUDGE and GUARDIAN hold `disposition.read` and stop there: a judge decides
# where a soul goes and records that as a judgment; carrying it out is a
# different power. VIEWER holds neither. Was 201 for all five.
DISPOSITION_CREATE = {"ADMIN": 201, "MODERATOR": 201, "JUDGE": 403, "GUARDIAN": 403, "VIEWER": 403}

# ENFORCED (tranche 2). POST /workflow/templates/ declares `workflow.create`,
# DELETE /workflow/templates/{id}/ declares `workflow.delete`. Both are held by
# ADMIN and MODERATOR only — designing the approval flow for a civilization is
# precisely what the realm lead exists to do (see the ROLE_PERMISSIONS comment
# on MODERATOR). JUDGE holds `workflow.read/approve/advance` and none of the
# four CRUD writes: the judge acts inside a flow they cannot redraw, which is
# the separation of duties that role comment describes. GUARDIAN and VIEWER hold
# no `workflow.*` at all.
# Was 201/204 for all five — the audit's headline, a read-only role designing
# and then destroying the approval workflow that judges souls.
WORKFLOW_TEMPLATE_CREATE = {"ADMIN": 201, "MODERATOR": 201, "JUDGE": 403, "GUARDIAN": 403, "VIEWER": 403}
WORKFLOW_TEMPLATE_DELETE = {"ADMIN": 204, "MODERATOR": 204, "JUDGE": 403, "GUARDIAN": 403, "VIEWER": 403}
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


# Every enforced write endpoint whose codenames are UNSEEDED on a migrate-only
# database — ledger.*, soul.*, judgment.* and disposition.* — paired with the
# expectation frozen above. Used twice: once implicitly by the per-endpoint
# tests below (dict resolution path, which is what CI measures by default) and
# once by test_enforced_writes_agree_through_the_db_path (DB resolution path).
#
# workflow.* is deliberately NOT here. It is the one enforced family that a
# migrate-only database DOES seed — migrations 0013/0015 create the seven
# Permission rows and 0017 grants them — so the workflow rows above already
# measure the DB path, and re-running them under a seeding fixture would prove
# nothing. Its missing half is the mirror image, and is covered by
# WORKFLOW_PROBES / test_enforced_workflow_agrees_through_the_dict_path.
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
    "PUT /souls/{soul}/": (
        lambda client, soul: client.put(
            f"/api/v1/souls/{soul.id}/", {"name": "dbpath-replaced"}, format="json"
        ),
        SOUL_PUT,
    ),
    "POST /souls/{soul}/die/": (
        lambda client, soul: client.post(f"/api/v1/souls/{soul.id}/die/", {}, format="json"),
        SOUL_DIE,
    ),
    "POST /souls/{soul}/transition/": (
        lambda client, soul: client.post(
            f"/api/v1/souls/{soul.id}/transition/",
            {"new_state": "JUDGING", "reason": "dbpath probe"},
            format="json",
        ),
        SOUL_TRANSITION,
    ),
    "POST /souls/{soul}/add_record/": (
        lambda client, soul: client.post(
            f"/api/v1/souls/{soul.id}/add_record/",
            {"record_type": "MERIT", "description": "dbpath probe", "weight": 1},
            format="json",
        ),
        SOUL_ADD_RECORD,
    ),
    "DELETE /souls/{soul}/": (
        lambda client, soul: client.delete(f"/api/v1/souls/{soul.id}/"),
        SOUL_DELETE,
    ),
    "POST /judgment/": (
        lambda client, soul: client.post(
            "/api/v1/judgment/",
            {"soul": str(soul.id), "civilization": "CHINESE", "court": "第一殿"},
            format="json",
        ),
        JUDGMENT_CREATE,
    ),
    "POST /disposition/": (
        lambda client, soul: client.post(
            "/api/v1/disposition/", {"soul": str(soul.id)}, format="json"
        ),
        DISPOSITION_CREATE,
    ),
}

# The workflow half of the same argument, run the other way round. These four
# endpoints are driven with the workflow.* Permission rows REMOVED, so
# check_permission falls through to ROLE_PERMISSIONS. Same expectations: a
# deployment whose grant table has drifted from the dict, or a dev database
# still behind migration 0013 (the audit measured exactly that), resolves these
# through the dict, and this is the only thing that would notice the two
# disagreeing.
WORKFLOW_PROBES = {
    "GET /workflows/": (
        lambda client, tenant: client.get("/api/v1/workflows/"),
        WORKFLOW_READ,
    ),
    "GET /nodes/": (
        lambda client, tenant: client.get("/api/v1/nodes/"),
        WORKFLOW_READ,
    ),
    "POST /workflow/templates/": (
        lambda client, tenant: client.post(
            "/api/v1/workflow/templates/",
            {
                "name": f"dictpath-tpl-{uuid.uuid4().hex[:8]}",
                "civilization": "CHINESE",
                "case_type": "ROUTINE",
            },
            format="json",
        ),
        WORKFLOW_TEMPLATE_CREATE,
    ),
    "DELETE /workflow/templates/{id}/": (
        lambda client, tenant: client.delete(
            f"/api/v1/workflow/templates/{_template(tenant, f'dictpath-del-{uuid.uuid4().hex[:8]}').id}/"
        ),
        WORKFLOW_TEMPLATE_DELETE,
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
def test_soul_put_snapshot(role_clients, snapshot_tenant, role):
    """ENFORCED: soul.update over PUT — the same codename as PATCH, a different route.

    Added in tranche 2. Tranche 1 denied JUDGE and VIEWER here and no test in
    the project said so; a rollout that had wired `partial_update` and missed
    `update` would have looked identical from this file.
    """
    from apps.souls.models import Soul

    original = f"snapshot-put-{role}"
    soul = _soul(snapshot_tenant, original)
    response = role_clients[role].put(
        f"/api/v1/souls/{soul.id}/", {"name": f"REPLACED_BY_{role}"}, format="json"
    )
    assert response.status_code == SOUL_PUT[role]
    expected_name = f"REPLACED_BY_{role}" if SOUL_PUT[role] == 200 else original
    assert Soul.objects.get(pk=soul.pk).name == expected_name


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_soul_add_record_snapshot(role_clients, snapshot_tenant, role):
    """ENFORCED: soul.update via add_record. GUARDIAN may append to the record; JUDGE may not."""
    from apps.souls.record_models import SoulRecord

    soul = _soul(snapshot_tenant, f"snapshot-addrec-{role}")
    description = f"record added by {role}"
    response = role_clients[role].post(
        f"/api/v1/souls/{soul.id}/add_record/",
        {"record_type": "MERIT", "description": description, "weight": 1},
        format="json",
    )
    assert response.status_code == SOUL_ADD_RECORD[role]
    # These rows feed LedgerService, so a 403 that still wrote one would move a
    # soul's karmic balance from a role that cannot edit the soul at all.
    assert SoulRecord.all_objects.filter(
        soul=soul, description=description
    ).exists() == (SOUL_ADD_RECORD[role] == 201)


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_soul_transition_snapshot(role_clients, snapshot_tenant, role):
    """ENFORCED: soul.transition. Four roles hold it; VIEWER alone does not."""
    from apps.souls.models import Soul, SoulState

    soul = _soul(snapshot_tenant, f"snapshot-transition-{role}")
    assert soul.current_state == SoulState.ALIVE
    response = role_clients[role].post(
        f"/api/v1/souls/{soul.id}/transition/",
        {"new_state": SoulState.JUDGING, "reason": f"snapshot probe by {role}"},
        format="json",
    )
    assert response.status_code == SOUL_TRANSITION[role]
    expected_state = SoulState.JUDGING if SOUL_TRANSITION[role] == 200 else SoulState.ALIVE
    assert Soul.objects.get(pk=soul.pk).current_state == expected_state


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
    """ENFORCED: judgment.create. GUARDIAN and VIEWER hold no judgment codename at all."""
    from apps.judgment.models import Judgment
    from apps.souls.models import Civilization, SoulState

    soul = _soul(snapshot_tenant, f"snapshot-judgment-{role}")
    response = role_clients[role].post(
        "/api/v1/judgment/",
        {"soul": str(soul.id), "civilization": Civilization.CHINESE, "court": "第一殿"},
        format="json",
    )
    assert response.status_code == JUDGMENT_CREATE[role]
    created = JUDGMENT_CREATE[role] == 201
    assert Judgment.all_objects.filter(soul=soul).exists() == created
    # perform_create walks the soul ALIVE -> JUDGING, so a denied POST that
    # still landed would show up on a second table. Assert there too.
    from apps.souls.models import Soul
    assert Soul.objects.get(pk=soul.pk).current_state == (
        SoulState.JUDGING if created else SoulState.ALIVE
    )


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_disposition_create_snapshot(role_clients, snapshot_tenant, role):
    """ENFORCED: disposition.execute — there is no disposition.create, so writes map here."""
    from apps.disposition.models import Disposition

    soul = _soul(snapshot_tenant, f"snapshot-disposition-{role}")
    response = role_clients[role].post(
        "/api/v1/disposition/", {"soul": str(soul.id)}, format="json"
    )
    assert response.status_code == DISPOSITION_CREATE[role]
    assert Disposition.all_objects.filter(soul=soul).exists() == (
        DISPOSITION_CREATE[role] == 201
    )


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_workflow_template_create_snapshot(role_clients, snapshot_tenant, role):
    """ENFORCED: workflow.create. The realm lead designs the flow; the judge works inside it."""
    from apps.souls.models import Civilization
    from apps.workflow.models import CaseType, WorkflowTemplate

    name = f"snapshot-tpl-{role}-{uuid.uuid4().hex[:8]}"
    response = role_clients[role].post(
        "/api/v1/workflow/templates/",
        {
            "name": name,
            "civilization": Civilization.CHINESE,
            "case_type": CaseType.ROUTINE,
        },
        format="json",
    )
    assert response.status_code == WORKFLOW_TEMPLATE_CREATE[role]
    assert WorkflowTemplate.all_objects.filter(name=name).exists() == (
        WORKFLOW_TEMPLATE_CREATE[role] == 201
    )


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_workflow_template_delete_snapshot(role_clients, snapshot_tenant, role):
    """ENFORCED: workflow.delete. Was 204 for a VIEWER, deletion included."""
    from apps.workflow.models import WorkflowTemplate

    template = _template(snapshot_tenant, f"snapshot-del-tpl-{role}")
    response = role_clients[role].delete(f"/api/v1/workflow/templates/{template.id}/")
    assert response.status_code == WORKFLOW_TEMPLATE_DELETE[role]
    # Deletion is soft here too, so `objects` (which filters is_deleted) is what
    # "gone" means. The three denied roles must leave the template standing —
    # asserting only the status code would have accepted a 403 that still
    # deleted, and this endpoint is where the audit measured a VIEWER destroying
    # the approval flow.
    assert WorkflowTemplate.objects.filter(pk=template.pk).exists() == (
        WORKFLOW_TEMPLATE_DELETE[role] == 403
    )


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
# codenames are exactly `workflow.*` and `menu.read`. Nothing seeds `soul.*`,
# `ledger.*`, `judgment.*` or `disposition.*`, so every expectation above is
# measuring the DICT path — except the workflow rows, which measure the DB one.
# The rollout therefore straddles both paths, and neither is the "normal" one.
#
# A deployed database is not migrate-only. Dev has Permission rows for soul.*
# and ledger.* (created by apps/perm/views.py's init endpoint, which no
# migration owns) and 49 RolePermission rows, so there the DB decides and the
# dict is never consulted. The matrix frozen above therefore pins the path CI
# happens to exercise and says nothing about the path production runs on.
#
# These cases close that gap: seed the codenames, grant them from
# ROLE_PERMISSIONS, and drive the same ten endpoints again. Identical codes
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
def unseeded_families_seeded_in_db(db):
    """Make the DB authoritative for the four unseeded enforced families.

    soul.*, ledger.*, judgment.* and disposition.* — every enforced codename
    that a migrate-only database leaves to the dict. workflow.* is excluded
    because migrations already seed it; see the block comment above.

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
        if codename.startswith(("soul.", "ledger.", "judgment.", "disposition."))
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
    role_clients, snapshot_tenant, unseeded_families_seeded_in_db, role, probe_name
):
    """Same ten endpoints, same expected codes, resolved from RolePermission rows."""
    probe, expected = ENFORCED_WRITE_PROBES[probe_name]
    soul = _soul(snapshot_tenant, f"dbpath-{role}-{uuid.uuid4().hex[:8]}")
    response = probe(role_clients[role], soul)
    assert response.status_code == expected[role], (
        f"{role} {probe_name} returned {response.status_code} with soul.*/ledger.*/"
        f"judgment.*/disposition.* seeded in the Permission table, but "
        f"{expected[role]} when the same check resolves through the "
        f"ROLE_PERMISSIONS dict. The two paths have diverged: CI builds the dict "
        f"path, deployments run the DB one."
    )


@pytest.mark.django_db
def test_seeding_actually_moved_those_codenames_onto_the_db_path(unseeded_families_seeded_in_db):
    """Guard the fixture above: if it seeds nothing, the DB-path cases are dict cases.

    Without this, a rename of the soul/ledger/judgment/disposition codenames
    would empty the fixture and all 50 cases above would silently go on
    measuring the dict a second time — passing, and testing nothing they claim
    to test.
    """
    from apps.perm.models import Permission

    assert len(unseeded_families_seeded_in_db) == 13, unseeded_families_seeded_in_db
    for codename in unseeded_families_seeded_in_db:
        assert Permission.objects.filter(codename=codename).exists(), codename


@pytest.fixture
def workflow_forced_onto_the_dict_path(db):
    """Remove the workflow.* Permission rows so check_permission consults the dict.

    The exact inverse of the fixture above, and needed for the same reason.
    Migrations 0013/0015 create the seven workflow codenames and 0017 grants
    them, so every workflow row in this file already resolves through the DB —
    which leaves the dict path for that family untested, on a system whose dev
    database the audit measured at perm migration 0012, i.e. with no workflow
    Permission rows at all. That deployment answers workflow.* from the dict.

    Hard delete via `all_objects` rather than the soft delete `.delete()`
    performs: checker.py asks `Permission.objects.filter(codename=...)`, whose
    manager already excludes soft-deleted rows, so either would work — but a
    hard delete cannot be confused with a row that is merely hidden, and the
    surrounding transaction rolls it back. RolePermission cascades.
    """
    from apps.perm.cache import invalidate_all_permissions
    from apps.perm.models import Permission

    removed = sorted(
        Permission.all_objects.filter(codename__startswith="workflow.").values_list(
            "codename", flat=True
        )
    )
    Permission.all_objects.filter(codename__startswith="workflow.").delete()
    invalidate_all_permissions()

    yield removed
    invalidate_all_permissions()


@pytest.mark.django_db
@pytest.mark.parametrize("probe_name", list(WORKFLOW_PROBES), ids=lambda v: str(v))
@pytest.mark.parametrize("role", ROLES)
def test_enforced_workflow_agrees_through_the_dict_path(
    role_clients, snapshot_tenant, workflow_forced_onto_the_dict_path, role, probe_name
):
    """Same four workflow endpoints, same expected codes, resolved from the dict."""
    probe, expected = WORKFLOW_PROBES[probe_name]
    response = probe(role_clients[role], snapshot_tenant)
    assert response.status_code == expected[role], (
        f"{role} {probe_name} returned {response.status_code} with the workflow.* "
        f"Permission rows removed, but {expected[role]} when the same check "
        f"resolves through RolePermission rows. The two paths have diverged: a "
        f"database behind migration 0013 answers workflow.* from the dict."
    )


@pytest.mark.django_db
def test_removing_those_rows_actually_moved_workflow_onto_the_dict_path(
    workflow_forced_onto_the_dict_path,
):
    """Guard the fixture above, in both directions.

    If migrations stop seeding workflow.* the fixture removes nothing and the 20
    cases above become a second copy of the default rows — passing, and proving
    nothing. If a rename moves the family out from under the `workflow.` prefix,
    the same thing happens quietly. Assert what was removed, by name.
    """
    from apps.perm.models import Permission

    assert workflow_forced_onto_the_dict_path == [
        "workflow.advance",
        "workflow.approve",
        "workflow.create",
        "workflow.delete",
        "workflow.escalate",
        "workflow.read",
        "workflow.update",
    ], workflow_forced_onto_the_dict_path
    assert not Permission.objects.filter(codename__startswith="workflow.").exists()


# ---------------------------------------------------------------------------
# THE DENIALS THAT CAN BE WALKED AROUND.
#
# Everything above asserts that a role denied a codename gets a 403. None of it
# asserts that the 403 stops anything, because a 403 on one route stops nothing
# if a second route reaches the same write under a codename the role does hold.
# Three such pairs exist across the five enforced apps, and they share one
# shape:
#
#   a narrow codename guards a custom @action, while the SAME fields stay
#   writable through the viewset's own CRUD route under a wider codename.
#
# a9f3556 shipped the first of them describing it as "exact mirrors, both
# declared policy" — GUARDIAN may edit but not kill, JUDGE may kill but not
# edit. Half of that mirror has a way round it.
#
# These tests assert TODAY's behaviour, in the same spirit as the snapshot: they
# record holes. Each one is written to fail loudly when the hole closes, so that
# whoever narrows a codename gets a named test telling them what they fixed,
# rather than a silent pass. Read a failure here as "the bypass is gone, delete
# this test" — not as a regression.
#
# NOT FIXED HERE ON PURPOSE. Every repair is an authorization decision: narrow
# `soul.transition`, or make `current_state` unreachable from it; mark
# ApprovalNodeSerializer's `status`/`verdict`/`approver`/`decided_at` read-only
# so they move only through approve_node; mark ApprovalWorkflowSerializer's
# `current_node`/`status` read-only so they move only through advance/escalate.
# Which of those is right is not a test's call.
#
# THE CATALOGUE CONTINUES ELSEWHERE — three instances live here, a fourth in
# backend/tests/test_perm_write_snapshot_outside_matrix.py, which is where the
# dispatch and reincarnation routes are covered. Recorded here so this comment
# stays the index of the pattern rather than a partial list:
#
#   4. GUARDIAN, denied dispatch.approve/.reject/.execute, reaches all three
#      statuses through PATCH /dispatch/records/{id}/ under dispatch.manage.
#      This is the instance tranche 2 predicted would appear "the moment those
#      are reconciled and given holders", and it is the worst one found so far:
#      it also walks around the target-tenant rule (which is not a codename at
#      all, so no codename change closes it), skips the status state machine,
#      and leaves the row asserting an EXECUTED transfer whose soul never
#      moved. `dispatched_by` is writable too, so the audit attribution is
#      forgeable. Characterized in that file, not fixed.
#
#   5. NOT AN INSTANCE, and worth recording as such: reincarnation has the
#      precondition — reincarnation.complete/.reborn are ADMIN/MODERATOR while
#      reincarnation.manage is strictly wider — and the bypass is still absent.
#      The soul-side effects live entirely in
#      ReincarnationService.complete_rebirth, and Reincarnation has no signals
#      and no save() override, so the CRUD route reaches none of them. Measured
#      and asserted rather than inferred. The gate question this comment poses
#      ("does any custom action's codename have a strictly narrower holder set
#      than the CRUD codename covering the same fields?") needs its second half
#      read as seriously as its first: same FIELDS, not merely same model.
# ---------------------------------------------------------------------------


def _workflow_with_two_nodes(tenant, soul):
    from apps.workflow.models import ApprovalNode, ApprovalWorkflow, CaseType, NodeStatus

    workflow = ApprovalWorkflow.objects.create(
        workflow_name="bypass-probe",
        soul=soul,
        case_type=CaseType.ROUTINE,
        tenant=tenant,
    )
    first = ApprovalNode.objects.create(
        workflow=workflow, node_name="第一殿", node_order=1, status=NodeStatus.PENDING
    )
    second = ApprovalNode.objects.create(
        workflow=workflow, node_name="第二殿", node_order=2, status=NodeStatus.PENDING
    )
    workflow.current_node = first
    workflow.save()
    return workflow, first, second


@pytest.mark.django_db
def test_guardian_denied_soul_die_reaches_the_same_state_through_transition(
    role_clients, snapshot_tenant
):
    """GUARDIAN cannot POST /die/ and does not need to: /transition/ does the same thing.

    `soul.die` is held by ADMIN, MODERATOR and JUDGE; `soul.transition` by those
    three AND GUARDIAN. Both endpoints reach Soul.transition_to(JUDGING), and
    that method sets death_date itself when the soul has none
    (apps/souls/models.py, in transition_to). So the denial on /die/ withholds
    the `location` argument and nothing else: the state moves, the death date
    lands, and a Judgment is the only thing GUARDIAN does not get.
    """
    from apps.souls.models import Soul, SoulState

    soul = _soul(snapshot_tenant, "bypass-die-vs-transition")
    guardian = role_clients["GUARDIAN"]

    denied = guardian.post(f"/api/v1/souls/{soul.id}/die/", {}, format="json")
    assert denied.status_code == 403, "GUARDIAN is supposed to lack soul.die"
    assert Soul.objects.get(pk=soul.pk).current_state == SoulState.ALIVE

    allowed = guardian.post(
        f"/api/v1/souls/{soul.id}/transition/",
        {"new_state": SoulState.JUDGING, "reason": "walked around soul.die"},
        format="json",
    )
    assert allowed.status_code == 200, (
        "If this is now 403, soul.transition has been narrowed and the bypass is "
        "closed. Good — delete this test."
    )
    after = Soul.objects.get(pk=soul.pk)
    assert after.current_state == SoulState.JUDGING
    # The state change is real, not a 200 over a no-op.
    assert after.death_date is not None


@pytest.mark.django_db
def test_moderator_denied_workflow_approve_reaches_the_same_row_through_patch_nodes(
    role_clients, snapshot_tenant
):
    """MODERATOR cannot call approve_node and does not need to: PATCH /nodes/ writes the verdict.

    This is the sharpest of the three, because the denial it walks around is the
    one ROLE_PERMISSIONS argues for at length: MODERATOR is deliberately given
    workflow.create/update/delete and deliberately refused workflow.approve, so
    that "a lead who both designs the flow and approves at any stage of it"
    cannot exist. But ApprovalNodeViewSet maps `partial_update` to
    workflow.update — which MODERATOR holds — and ApprovalNodeSerializer leaves
    `status`, `verdict`, `approver` and `decided_at` writable. The approval is
    recorded on the same row either way.

    What the bypass does NOT get is workflow.complete_node's side effects: the
    workflow does not advance and completed_at is not set. It is a forged node
    decision, not a completed stage — which is arguably worse than either.
    """
    from apps.workflow.models import ApprovalNode, NodeStatus

    soul = _soul(snapshot_tenant, "bypass-approve-vs-patch")
    workflow, first, _second = _workflow_with_two_nodes(snapshot_tenant, soul)
    moderator = role_clients["MODERATOR"]

    denied = moderator.post(
        f"/api/v1/workflows/{workflow.id}/approve_node/",
        {"verdict": "PASSED", "notes": "denied route"},
        format="json",
    )
    assert denied.status_code == 403, "MODERATOR is supposed to lack workflow.approve"
    assert ApprovalNode.objects.get(pk=first.pk).status == NodeStatus.PENDING

    allowed = moderator.patch(
        f"/api/v1/nodes/{first.id}/",
        {"status": NodeStatus.APPROVED, "verdict": "PASSED", "notes": "walked around workflow.approve"},
        format="json",
    )
    assert allowed.status_code == 200, (
        "If this is now 403 — or if status/verdict became read-only and the PATCH "
        "no longer takes — the bypass is closed. Good; delete this test."
    )
    after = ApprovalNode.objects.get(pk=first.pk)
    assert after.status == NodeStatus.APPROVED
    assert after.verdict == "PASSED"


@pytest.mark.django_db
def test_moderator_denied_workflow_advance_reaches_the_same_row_through_patch_workflow(
    role_clients, snapshot_tenant
):
    """MODERATOR cannot call advance and does not need to: PATCH /workflows/ moves current_node.

    workflow.advance is ADMIN and JUDGE. MODERATOR holds workflow.escalate
    instead, and that IS a designed alternative — escalate calls the very same
    advance_to_next(), but demands a written reason and always writes an
    AuditLog naming who overrode which node. The cost of using it is that it is
    visible, and the view's docstring says so.

    That design is undone here. ApprovalWorkflowSerializer leaves `current_node`
    and `status` writable, and `partial_update` maps to workflow.update, which
    MODERATOR holds — so the flow can be moved with no reason, no audit record,
    and no 403. escalate is the visible door standing next to an open window.
    """
    from apps.audit.models import AuditLog
    from apps.workflow.models import ApprovalWorkflow

    soul = _soul(snapshot_tenant, "bypass-advance-vs-patch")
    workflow, first, second = _workflow_with_two_nodes(snapshot_tenant, soul)
    moderator = role_clients["MODERATOR"]

    denied = moderator.post(f"/api/v1/workflows/{workflow.id}/advance/", {}, format="json")
    assert denied.status_code == 403, "MODERATOR is supposed to lack workflow.advance"
    assert ApprovalWorkflow.objects.get(pk=workflow.pk).current_node_id == first.pk

    allowed = moderator.patch(
        f"/api/v1/workflows/{workflow.id}/",
        {"current_node": str(second.id)},
        format="json",
    )
    assert allowed.status_code == 200, (
        "If this is now 403 — or if current_node became read-only — the bypass is "
        "closed. Good; delete this test."
    )
    assert ApprovalWorkflow.objects.get(pk=workflow.pk).current_node_id == second.pk
    # And the thing escalate exists to guarantee did not happen.
    assert not AuditLog.objects.filter(resource="workflow.escalate").exists()


def _write_snapshot_test_names():
    """Every write-half snapshot test defined in this module, by name.

    Read tests are parametrized over (path, role, expected) triples; write
    tests over `role` alone. `path` is therefore what tells them apart, and
    pytest.mark.parametrize returns the same function object it decorates, so
    the signature survives to be inspected here.
    """
    import inspect
    import sys

    module = sys.modules[__name__]
    names = []
    for name, obj in vars(module).items():
        if not (name.startswith("test_") and name.endswith("_snapshot")):
            continue
        if not inspect.isfunction(obj):
            continue
        params = inspect.signature(obj).parameters
        if "role" in params and "path" not in params:
            names.append(name)
    return sorted(names)


@pytest.mark.django_db
def test_snapshot_covers_the_whole_section_3_matrix():
    """Guard the snapshot's own shape: 45 endpoints × 5 roles = 225 cases.

    Deleting a row to make a fix "pass" is a thing that happens. This makes it
    show up as a failure rather than a smaller, quieter test run.

    Tranche 1 changed 14 of the then-210 codes and deleted none. Tranche 2 added
    the three souls endpoints tranche 1 had denied without a witness — the only
    time this number has moved, and a reviewed decision — taking it to 225, then
    changed 18 more codes and again deleted nothing. That is the property this
    assertion exists to keep checkable: the count goes up on purpose or not at
    all.
    """
    write_endpoints = 17  # calculate, souls×7, judgment, disposition, workflow×2, post, menu, user, perm×2
    assert len(READ_MATRIX) == 28
    assert len(READ_CASES) == 140
    assert (len(READ_MATRIX) + write_endpoints) * len(ROLES) == 225
    # `write_endpoints` above is a literal, and a literal cannot notice a
    # deleted test function — which is the exact move this guard exists to
    # catch, and the half of it tranche 1 left open. The read half was always
    # covered (READ_MATRIX is data, and dropping a path shrinks it). So count
    # the write tests instead of trusting the number: every one of them is a
    # `test_*_snapshot` parametrized over `role` alone, and `path` is what
    # separates them from the read case, which is parametrized over triples.
    assert _write_snapshot_test_names() == [
        "test_disposition_create_snapshot",
        "test_judgment_create_snapshot",
        "test_ledger_calculate_snapshot",
        "test_menu_create_snapshot",
        "test_perm_assign_snapshot",
        "test_perm_permission_create_snapshot",
        "test_social_post_create_snapshot",
        "test_soul_add_record_snapshot",
        "test_soul_create_snapshot",
        "test_soul_delete_snapshot",
        "test_soul_die_snapshot",
        "test_soul_put_snapshot",
        "test_soul_transition_snapshot",
        "test_soul_update_snapshot",
        "test_user_create_snapshot",
        "test_workflow_template_create_snapshot",
        "test_workflow_template_delete_snapshot",
    ], _write_snapshot_test_names()
    assert len(_write_snapshot_test_names()) == write_endpoints
    # The ten enforced write endpoints whose codenames a migrate-only database
    # leaves unseeded are additionally driven through the DB resolution path —
    # 50 more cases. Pinned here for the same reason as the 225: dropping a
    # probe would shrink the run without failing it.
    assert len(ENFORCED_WRITE_PROBES) == 10
    assert len(ENFORCED_WRITE_PROBES) * len(ROLES) == 50
    # And the four workflow endpoints, whose codenames a migrate-only database
    # DOES seed, are driven the other way — 20 cases with the rows removed.
    assert len(WORKFLOW_PROBES) == 4
    assert len(WORKFLOW_PROBES) * len(ROLES) == 20
