"""An appeal must be creatable in all four civilizations, through both doors.

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
  ``packages/core/src/config/workflow-templates.ts`` — flows a user can build, save
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
from apps.souls.models import CIVILIZATION_TENANT, Civilization, Soul
from apps.tenants.managers import clear_current_tenant
from apps.tenants.models import Tenant
from apps.workflow.models import ApprovalWorkflow, CaseType
from apps.workflow.services import VALID_CASE_TYPES_BY_CIVILIZATION, WorkflowService

#: Written out rather than derived from `Civilization`, for the reason every
#: expectation table in this suite is: a list built from the thing under test
#: agrees with it by construction. GREEK joined when it became the fourth enum
#: member — it has its own tenant (`GR_HADES`) and therefore its own souls, so
#: an appeal on that side is a real path and not a hypothetical one.
#: GREEK LEFT AGAIN (user 2026-10-27): Minos's judgment is final, so a Greek APPEAL is refused with
#: `no_appeal_above_minos` at both doors — `test_a_greek_appeal_is_refused_at_both_doors` below.
CIVILIZATIONS = (
    Civilization.CHINESE,
    Civilization.EUROPEAN,
    Civilization.EGYPTIAN,
)


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

    Stated over every civilization rather than over "European and Egyptian" so
    that the Chinese set losing APPEAL — which would break the one civilization
    that always worked — fails here too, and so that a civilization added later
    with no set at all fails here rather than at the first appeal.
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
def test_the_endpoint_no_longer_builds_an_appeal_flow(seeded, civilization):
    """`POST create_from_judgment` with `is_appeal: true` used to build an APPEAL flow (this case asserted the 201).
    No appeal stood behind such a flow, so finishing it changed nothing (review 2026-10-29): appeals go up their
    flow from the soul's side (`appeals.file(escalate=True)`). The door now refuses, writing nothing."""
    tenant = _tenant(civilization)
    client = APIClient(**_bearer(_admin(tenant, f"appeal_{civilization}")))
    judgment = _judgment(civilization, tenant, f"{civilization} 申诉魂")
    for body in ({"is_appeal": True}, {"case_type": CaseType.APPEAL}):
        response = client.post(
            "/api/v1/workflows/create_from_judgment/", {"judgment_id": str(judgment.id), **body}, format="json")
        assert response.status_code == 400 and response.data["code"] == "appeal_not_from_judgment", response.data
    assert not ApprovalWorkflow.all_objects.filter(judgment=judgment).exists()


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


@pytest.mark.django_db
def test_a_greek_appeal_is_refused_at_both_doors(seeded):
    """No appeal above Minos (docs/02_希腊冥府审判与人物详解.md §5.2): a clean 400 with a code, not a built flow."""
    from apps.workflow.services import NoAppealAboveMinosError

    tenant = _tenant(Civilization.GREEK)
    client = APIClient(**_bearer(_admin(tenant, "appeal_greek_admin")))
    judgment = _judgment(Civilization.GREEK, tenant, "希腊申诉魂")
    response = client.post("/api/v1/workflows/create_from_judgment/",
                           {"judgment_id": str(judgment.id), "is_appeal": True}, format="json")
    assert response.status_code == 400 and response.data["code"] == "appeal_not_from_judgment", response.data
    with pytest.raises(NoAppealAboveMinosError):
        WorkflowService.create_from_judgment(judgment, is_appeal=True)
    response = client.post("/api/v1/workflows/start/",
                           {"soul": str(judgment.soul_id), "case_type": CaseType.APPEAL, "reason": "申诉"}, format="json")
    assert response.status_code == 400 and response.data["code"] == "no_appeal_above_minos", response.data
    assert ApprovalWorkflow.all_objects.filter(soul=judgment.soul, case_type=CaseType.APPEAL).count() == 0


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
