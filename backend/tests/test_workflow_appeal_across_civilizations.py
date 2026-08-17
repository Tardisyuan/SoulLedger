"""An appeal must be creatable in all three civilizations, through both doors.

The defect
----------
``WorkflowService.create_from_judgment`` picks the case type itself when the
caller does not pass one, and for ``is_appeal=True`` it picks
``CaseType.APPEAL`` unconditionally::

    if case_type is None:
        if is_appeal:
            case_type = CaseType.APPEAL
        ...
    validation_error = cls.validate_civilization_case_type(civilization, case_type)
    if validation_error:
        raise ValueError(validation_error)

…and then validated that value against
``VALID_CASE_TYPES_BY_CIVILIZATION``, which carried ``APPEAL`` for the Chinese
set only. So **every European and every Egyptian appeal raised ``ValueError``**,
and through the endpoint that ValueError is a 400 —
``views.ApprovalWorkflowViewSet.create_from_judgment`` catches it and answers
``{"error": …}``. That is the default path, not an exotic one: the endpoint
forwards ``request.data.get("case_type")``, so a request that says only
``{"judgment_id": …, "is_appeal": true}`` arrives here with ``case_type=None``.

Which side was wrong
--------------------
Two entry points and two presets against one table, so the table was widened.

* ``WorkflowService.create_appeal_workflow`` writes ``case_type=CaseType.APPEAL``
  for a soul of any civilization and, until this change, validated nothing at
  all. An appeal raised through that door has always been legal everywhere.
* ``EUROPEAN_APPEAL`` and ``EGYPTIAN_APPEAL`` are complete presets in
  ``frontend/src/config/workflow-templates.ts`` — flows a user can build, save
  and see, that no judgment could ever be routed to.

Only the table said otherwise, so the table is what changed. The other half of
the repair is that ``create_appeal_workflow`` now runs the same validator: two
doors agreeing because they consult one table is a rule; two doors agreeing
because they happen to write the same constant is a coincidence, and the
coincidence is exactly what had already come apart here.

What this file asserts, and where
---------------------------------
The regression case is **over HTTP**, because the endpoint is where the defect
was visible as a 400 to a user, and because a service-level test alone would not
have exercised the tenant-scoped judgment lookup the endpoint does. The bearer
token carries the ``tenant_code`` claim ``TenantMiddleware`` reads;
``force_authenticate`` is deliberately not used, for the reason recorded in
``tests/test_workflow_preset_node_types.py::_bearer`` — it leaves rows
``tenant=NULL`` and the scoped reads downstream skip them, which is how a case
like this passes while measuring nothing.

The service-level cases sit beside it rather than instead of it: the HTTP case
pins the API contract, the service cases pin ``WorkflowService``'s own, and
``create_appeal_workflow`` has no endpoint of its own to be reached through.

What "would really fail" means here
-----------------------------------
Every assertion below was checked by breaking it — removing ``CaseType.APPEAL``
from the European set reddens the HTTP case, the service case and the
"both doors agree" case, each with a different message. The mutations and their
output are in the task report.
"""
import io

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.authentication.models import User
from apps.judgment.models import Judgment
from apps.souls.models import CIVILIZATION_TENANT, UNKNOWN_CIVILIZATION, Civilization, Soul
from apps.tenants.managers import clear_current_tenant
from apps.tenants.models import Tenant
from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus, CaseType
from apps.workflow.services import VALID_CASE_TYPES_BY_CIVILIZATION, WorkflowService

CIVILIZATIONS = (Civilization.CHINESE, Civilization.EUROPEAN, Civilization.EGYPTIAN)


@pytest.fixture
def seeded(db):
    clear_current_tenant()
    call_command("seed_mythology", stdout=io.StringIO())


def _tenant(civilization: str) -> Tenant:
    return Tenant.objects.get(code=CIVILIZATION_TENANT[civilization])


def _bearer(user) -> dict:
    """APIClient kwargs for a JWT carrying the claim TenantMiddleware reads."""
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    return {"HTTP_AUTHORIZATION": f"Bearer {token.access_token}"}


def _admin(tenant, username):
    return User.objects.create_user(
        username=username, password="x", role="ADMIN", tenant=tenant
    )


def _judgment(civilization, tenant, name):
    soul = Soul.objects.create(name=name, tenant=tenant)
    return Judgment.objects.create(
        soul=soul, civilization=civilization, court="—",
        verdict="REJECTED", is_final=True, tenant=tenant,
    )


# ── the table itself ──────────────────────────────────────────────────


def test_appeal_is_valid_in_every_civilization():
    """The smallest place the defect is visible; no database needed.

    Stated as "all three" rather than "European and Egyptian" so that the
    Chinese set losing APPEAL — which would break the one civilization that
    always worked — fails here too.
    """
    without = sorted(
        civilization
        for civilization in CIVILIZATIONS
        if CaseType.APPEAL not in VALID_CASE_TYPES_BY_CIVILIZATION[civilization]
    )
    assert without == [], (
        f"civilizations whose set has no APPEAL: {without}. "
        f"create_from_judgment(..., is_appeal=True) sets case_type=APPEAL and "
        f"then validates it against this table, so every appeal of those "
        f"civilizations raises ValueError — while create_appeal_workflow "
        f"builds one for the same soul. Widen the set or explain, in the "
        f"comment above it, which of the two doors is now wrong."
    )
    # Absence: nothing else was swept in while widening. The three sets are
    # still the ones the presets and templates are filed under, not CaseType
    # in full.
    for civilization in CIVILIZATIONS:
        assert VALID_CASE_TYPES_BY_CIVILIZATION[civilization] != set(CaseType.values), (
            f"{civilization}'s set is now every CaseType there is, which "
            f"validates nothing. APPEAL was the finding; the check was not."
        )


# ── the regression, over HTTP ─────────────────────────────────────────


@pytest.mark.django_db
@pytest.mark.parametrize("civilization", CIVILIZATIONS)
def test_an_appeal_is_created_through_the_endpoint(seeded, civilization):
    """THE case: `POST create_from_judgment` with `is_appeal: true`, nothing else.

    Before the fix the European and Egyptian runs answered::

        400 {'error': "Case type 'APPEAL' is not valid for civilization
             'EUROPEAN'. Valid types: CANONIZATION, HERESY_TRIAL,
             PURGATORY_REVIEW, ROUTINE"}

    No `case_type` is sent, because that is the shape that broke: the endpoint
    forwards `request.data.get("case_type")` and the service then chooses
    APPEAL for itself. A test that passed `case_type=APPEAL` explicitly would
    exercise the same validator but would not be the request a user makes.
    """
    tenant = _tenant(civilization)
    client = APIClient(**_bearer(_admin(tenant, f"appeal_{civilization}")))
    judgment = _judgment(civilization, tenant, f"{civilization} 申诉魂")

    response = client.post(
        "/api/v1/workflows/create_from_judgment/",
        {"judgment_id": str(judgment.id), "is_appeal": True},
        format="json",
    )

    assert response.status_code == 201, response.data
    assert response.data["case_type"] == CaseType.APPEAL, response.data
    assert response.data["is_appeal"] is True, response.data

    # …and what landed is a workflow, not a 201-shaped shell. Read unfiltered
    # so a tenant contextvar cannot make an empty result look like a pass.
    workflow = ApprovalWorkflow.all_objects.get(pk=response.data["id"])
    assert workflow.tenant_id == tenant.id
    assert workflow.case_type == CaseType.APPEAL
    assert workflow.nodes.count() > 0, (
        "the appeal workflow was created with no nodes at all, which cannot be "
        "advanced, approved or escalated — a stuck row is not the fix"
    )
    assert workflow.current_node is not None
    assert workflow.status == ApprovalWorkflowStatus.IN_PROGRESS


@pytest.mark.django_db
def test_the_endpoint_still_refuses_a_case_type_the_civilization_has_not(seeded):
    """The validator was widened by one member, not switched off.

    If a later "fix" deletes the check instead of the gap, the cases above stay
    green and this one goes red.
    """
    tenant = _tenant(Civilization.EGYPTIAN)
    client = APIClient(**_bearer(_admin(tenant, "appeal_reject_admin")))
    judgment = _judgment(Civilization.EGYPTIAN, tenant, "错案类型魂")

    response = client.post(
        "/api/v1/workflows/create_from_judgment/",
        {"judgment_id": str(judgment.id), "case_type": CaseType.CANONIZATION},
        format="json",
    )
    assert response.status_code == 400, response.data
    assert "CANONIZATION" in response.data["error"], response.data
    assert ApprovalWorkflow.all_objects.filter(judgment=judgment).count() == 0


# ── the same thing at the service boundary ────────────────────────────


@pytest.mark.django_db
@pytest.mark.parametrize("civilization", CIVILIZATIONS)
def test_create_from_judgment_builds_an_appeal_without_being_told_the_case_type(
    seeded, civilization
):
    """The default path, called directly: `is_appeal=True`, `case_type=None`."""
    tenant = _tenant(civilization)
    judgment = _judgment(civilization, tenant, f"{civilization} service 申诉魂")

    workflow = WorkflowService.create_from_judgment(judgment, is_appeal=True)

    assert workflow is not None
    assert workflow.case_type == CaseType.APPEAL
    assert workflow.is_appeal is True
    assert workflow.nodes.count() > 0


@pytest.mark.django_db
@pytest.mark.parametrize("civilization", CIVILIZATIONS)
def test_both_doors_answer_the_same_way_for_the_same_soul(seeded, civilization):
    """`create_from_judgment` and `create_appeal_workflow`, one soul, one answer.

    This is the case the whole change is for. Before it, the two doors gave
    opposite answers for a European or Egyptian soul: one raised ValueError and
    the other built a workflow. Asserting both here means that removing APPEAL
    from a set, or dropping the new validation out of `create_appeal_workflow`,
    breaks the agreement rather than restoring the silent disagreement.

    The two workflows are built from two different souls because
    `ApprovalWorkflow.judgment` is a OneToOne — chaining them onto one judgment
    raises `UNIQUE constraint failed` from the database, which is a fact about
    the schema and not about case types. Same reason
    `tests/test_coverage_boost.py::test_create_appeal_workflow` builds its
    original without a judgment at all.
    """
    tenant = _tenant(civilization)

    through_judgment = WorkflowService.create_from_judgment(
        _judgment(civilization, tenant, f"{civilization} 门一"), is_appeal=True
    )

    original = ApprovalWorkflow.objects.create(
        soul=Soul.objects.create(name=f"{civilization} 门二", tenant=tenant),
        workflow_name="原流程", case_type=CaseType.ROUTINE,
        status=ApprovalWorkflowStatus.REJECTED, tenant=tenant,
    )
    through_appeal_door = WorkflowService.create_appeal_workflow(original)

    assert through_judgment.case_type == CaseType.APPEAL
    assert through_appeal_door.case_type == CaseType.APPEAL
    assert through_judgment.is_appeal is through_appeal_door.is_appeal is True
    assert through_appeal_door.original_workflow_id == original.id


@pytest.mark.django_db
def test_create_appeal_workflow_now_refuses_what_create_from_judgment_refuses(db):
    """The one behaviour the added validation actually changes.

    A soul whose tenant code is not in `TENANT_CIVILIZATION` has
    `civilization == UNKNOWN_CIVILIZATION`, which is in no set. Before, this
    door built an appeal workflow with **no nodes** — `WORKFLOW_TEMPLATES` has
    no `(UNKNOWN, APPEAL)` entry, so the node loop never ran and the row was
    left PENDING with `current_node=None`, un-advanceable and un-approvable.
    `create_from_judgment` has always raised for the same soul; now both do.

    Recorded as a case rather than as a line in the report because it is the
    only difference, and because a future reader deciding to drop the
    validation should be told which row it prevents.
    """
    clear_current_tenant()
    tenant = Tenant.objects.create(code="UNKNOWN_CIV", display_name="Unknown")
    soul = Soul.objects.create(name="无籍之魂", tenant=tenant)
    assert soul.civilization == UNKNOWN_CIVILIZATION

    original = ApprovalWorkflow.objects.create(
        soul=soul, workflow_name="原流程", case_type=CaseType.ROUTINE,
        status=ApprovalWorkflowStatus.REJECTED, tenant=tenant,
    )

    before = ApprovalWorkflow.all_objects.count()
    with pytest.raises(ValueError, match="not valid for civilization"):
        WorkflowService.create_appeal_workflow(original)

    # Absence: it refused *before* writing, so there is no half-built appeal
    # left behind for someone to find later.
    assert ApprovalWorkflow.all_objects.count() == before
    assert ApprovalWorkflow.all_objects.filter(original_workflow=original).count() == 0
