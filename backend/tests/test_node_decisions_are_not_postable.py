"""A workflow, a template and a node cannot be handed to another tenant, and
a decision cannot be minted by POST.

Three defects measured on 2026-08-29, all as MODERATOR -- a role the
permission matrix deliberately denies `workflow.approve` and
`workflow.advance` precisely so that it cannot decide anything:

1. `PATCH /workflows/{id}/ {"tenant": <other>}` -> 200. The workflow keeps its
   original `soul` FK while `ApprovalWorkflowSerializer` exposes `soul_name`
   and the entire `nodes` list, so the receiving tenant reads a foreign soul's
   name and its whole approval history and the owning tenant loses the row.
   Same for `PATCH /workflow/templates/{id}/`.

2. `POST /nodes/ {"workflow": <another tenant's workflow>}` -> 201. The FK's
   default queryset is `ApprovalWorkflow.objects`, a TenantManager, but the
   tenant contextvar is unset at validation time -- measured, that queryset
   returned rows from both tenants. `scope_to_tenant` runs in `get_queryset()`,
   which covers PATCH and GET and not POST.

3. `POST /nodes/ {"status": "APPROVED", "verdict": "PASSED", "approver": <a
   judge>, "decided_at": "2020-01-01"}` -> 201, while
   `POST /workflows/{id}/approve_node/` correctly 403s for the same caller.
   Nothing downstream distinguishes the forged row from one `complete_node()`
   wrote.

The third one had a guard on PATCH already. Its docstring explained that POST
was left open because "node fixtures across apps/workflow/tests.py rely on
POSTing a node with status='APPROVED' already set". That was a true statement
about the fixtures and not a reason: it left the same forgery one request away
by another door. The fixtures now seed decided nodes through the ORM.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from apps.workflow.models import ApprovalNode, ApprovalWorkflow, WorkflowTemplate

User = get_user_model()
WORKFLOWS = "/api/v1/workflows"
NODES = "/api/v1/nodes"
TEMPLATES = "/api/v1/workflow/templates"


def _jwt_client(user, tenant):
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def world(db):
    a = Tenant.objects.get_or_create(code="WF_A", defaults={"display_name": "WF A"})[0]
    b = Tenant.objects.get_or_create(code="WF_B", defaults={"display_name": "WF B"})[0]
    soul_a = Soul.objects.create(name="SoulA", current_state=SoulState.JUDGING, tenant=a)
    soul_b = Soul.objects.create(name="SoulB", current_state=SoulState.JUDGING, tenant=b)
    # MODERATOR holds workflow.update but is denied workflow.approve/advance.
    mod_b = User.objects.create_user(
        username="wf_mod_b", password="x", role="MODERATOR", tenant=b
    )
    judge_a = User.objects.create_user(
        username="wf_judge_a", password="x", role="JUDGE", tenant=a
    )
    wf_a = ApprovalWorkflow.objects.create(
        workflow_name="A's chain", soul=soul_a, tenant=a
    )
    wf_b = ApprovalWorkflow.objects.create(
        workflow_name="B's chain", soul=soul_b, tenant=b
    )
    return {
        "a": a, "b": b, "soul_a": soul_a, "soul_b": soul_b,
        "mod_b": mod_b, "judge_a": judge_a, "wf_a": wf_a, "wf_b": wf_b,
        "client_b": _jwt_client(mod_b, b),
    }


@pytest.mark.django_db
def test_a_workflow_cannot_be_handed_to_another_tenant(world):
    resp = world["client_b"].patch(
        f"{WORKFLOWS}/{world['wf_b'].pk}/",
        {"tenant": world["a"].pk},
        format="json",
    )
    world["wf_b"].refresh_from_db()
    assert world["wf_b"].tenant_id == world["b"].pk, (
        f"the workflow moved to another tenant (response was {resp.status_code}); "
        f"it carries soul_name and the whole node history with it"
    )


@pytest.mark.django_db
def test_a_template_cannot_be_handed_to_another_tenant(world):
    tpl = WorkflowTemplate.objects.create(
        name="B's template", civilization="CHINESE", tenant=world["b"]
    )
    resp = world["client_b"].patch(
        f"{TEMPLATES}/{tpl.pk}/", {"tenant": world["a"].pk}, format="json"
    )
    tpl.refresh_from_db()
    assert tpl.tenant_id == world["b"].pk, (
        f"the template moved to another tenant (response was {resp.status_code})"
    )


@pytest.mark.django_db
def test_a_workflow_cannot_be_re_pointed_at_a_different_soul(world):
    resp = world["client_b"].patch(
        f"{WORKFLOWS}/{world['wf_b'].pk}/",
        {"soul": str(world["soul_a"].pk)},
        format="json",
    )
    assert resp.status_code == 400, (
        f"re-pointing a live approval chain at another soul returned "
        f"{resp.status_code}; every decision already recorded on it comes along"
    )
    world["wf_b"].refresh_from_db()
    assert world["wf_b"].soul_id == world["soul_b"].pk


@pytest.mark.django_db
def test_a_node_cannot_be_posted_into_another_tenants_workflow(world):
    resp = world["client_b"].post(
        f"{NODES}/",
        {
            "workflow": str(world["wf_a"].pk),
            "node_name": "injected",
            "node_order": 1,
        },
        format="json",
    )
    assert resp.status_code == 400, (
        f"POST of a node into another tenant's workflow returned "
        f"{resp.status_code}. get_queryset() scoping covers PATCH and GET; "
        f"POST goes through the field's own queryset, which is a TenantManager "
        f"evaluated with no tenant contextvar and therefore scopes nothing."
    )
    assert not ApprovalNode.objects.filter(workflow=world["wf_a"]).exists()


@pytest.mark.django_db
def test_a_decision_cannot_be_minted_by_posting_a_node(world):
    """The forgery, and the 403 that shows the caller had no such authority."""
    # The sanctioned route is closed to this caller...
    denied = world["client_b"].post(
        f"{WORKFLOWS}/{world['wf_b'].pk}/approve_node/",
        {"verdict": "PASSED"},
        format="json",
    )
    assert denied.status_code == 403, (
        f"approve_node returned {denied.status_code} for MODERATOR; this test's "
        f"premise is that the caller has no authority to decide anything"
    )

    # ...so the create route must be too.
    resp = world["client_b"].post(
        f"{NODES}/",
        {
            "workflow": str(world["wf_b"].pk),
            "node_name": "forged",
            "node_order": 1,
            "status": "APPROVED",
            "verdict": "PASSED",
            "approver": world["judge_a"].pk,
            "decided_at": "2020-01-01T00:00:00Z",
        },
        format="json",
    )
    assert resp.status_code == 400, (
        f"POST minted a decided node ({resp.status_code}). Nothing downstream "
        f"can tell it from one complete_node() wrote."
    )
    for field in ("status", "verdict", "approver", "decided_at"):
        assert field in resp.data, f"the 400 does not name `{field}`"
    assert not ApprovalNode.objects.filter(node_name="forged").exists()


@pytest.mark.django_db
def test_each_decision_field_is_refused_on_its_own(world):
    """A partial fix must not look like a whole one."""
    for field, value in (
        ("status", "APPROVED"),
        ("verdict", "PASSED"),
        ("approver", None),  # filled below
        ("decided_at", "2020-01-01T00:00:00Z"),
    ):
        payload = {
            "workflow": str(world["wf_b"].pk),
            "node_name": f"solo-{field}",
            "node_order": 1,
            field: world["judge_a"].pk if field == "approver" else value,
        }
        resp = world["client_b"].post(f"{NODES}/", payload, format="json")
        assert resp.status_code == 400, (
            f"POST with `{field}` alone returned {resp.status_code}"
        )
        assert field in resp.data


@pytest.mark.django_db
def test_an_undecided_node_can_still_be_created_and_edited(world):
    """Positive control: the lock must not close the endpoint.

    A node with no decision on it is ordinary workflow authoring and has to
    keep working, or the fix is just an outage.
    """
    resp = world["client_b"].post(
        f"{NODES}/",
        {
            "workflow": str(world["wf_b"].pk),
            "node_name": "ordinary",
            "node_order": 1,
            "approver_role": "JUDGE",
        },
        format="json",
    )
    assert resp.status_code == 201, resp.data
    node_id = resp.data["id"]
    assert resp.data["status"] == "PENDING"

    resp = world["client_b"].patch(
        f"{NODES}/{node_id}/", {"node_name": "renamed"}, format="json"
    )
    assert resp.status_code == 200, resp.data
    assert ApprovalNode.objects.get(pk=node_id).node_name == "renamed"


@pytest.mark.django_db
def test_a_workflow_can_still_be_renamed(world):
    """Positive control for the tenant lock."""
    resp = world["client_b"].patch(
        f"{WORKFLOWS}/{world['wf_b'].pk}/", {"notes": "revised"}, format="json"
    )
    assert resp.status_code == 200, resp.data
    world["wf_b"].refresh_from_db()
    assert world["wf_b"].notes == "revised"
