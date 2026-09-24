"""Officer-facing responses carry a name beside every tenant / user pk they show.

The cross-judgment detail page printed 「发起方: 1」: `CrossTenantJudgmentSerializer`
sent `initiating_tenant` (the pk) and `initiating_tenant_code`, and the page picked
the pk. Participant seats had the same shape. A sweep of every serializer found two
more pks the web frontend displays with nothing readable beside them:

* `ApprovalNodeSerializer.approver` — `app/workflow/[id]/page.tsx` shows a
  MissingValue in its place for want of a name;
* `TaskRunSerializer.tenant` — `RunHistoryPanel` looks the code up through the job
  list and prints the bare pk when the job is not in it.

Each gains read-only name fields; the pk stays (§4.6: the raw identifier stays
recoverable). The tests below check each value, check that nothing of another
tenant's appears (the name fields ride the existing tenant scoping and must not
widen it), and pin the cross-judgment list's query count so the new relation
reads cannot become one query per row.
"""
import json

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.dispatch.models import CrossTenantJudgment, CrossTenantJudgmentParticipant
from apps.scheduler.models import TaskRun
from apps.tenants.models import Tenant
from apps.workflow.models import ApprovalNode, ApprovalWorkflow

User = get_user_model()
CJ = "/api/v1/dispatch/cross-tenant-judgments/"
WORKFLOWS = "/api/v1/workflows/"
RUNS = "/api/v1/scheduler/runs/"


def _client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _tenant(code, name):
    return Tenant.objects.get_or_create(code=code, defaults={"display_name": name})[0]


@pytest.fixture
def world(db):
    """Three tenants with names that appear nowhere else, so a substring search
    of a response body is a real absence check."""
    a = _tenant("DN_A", "Alpha Display Hall")
    b = _tenant("DN_B", "Beta Display Hall")
    c = _tenant("DN_C", "Gamma Display Hall")
    judge_a = User.objects.create_user(username="dn_judge_a", password="x", role="JUDGE", tenant=a)
    return {"a": a, "b": b, "c": c, "judge_a": judge_a, "client_a": _client(judge_a)}


def _bench(initiator, *seats, title="bench"):
    j = CrossTenantJudgment.objects.create(
        title=title, description="d", initiating_tenant=initiator, tenant=initiator,
    )
    for t in seats:
        CrossTenantJudgmentParticipant.objects.create(
            judgment=j, participant_tenant=t, role="CO_JUDGE", tenant=t,
        )
    return j


def _results(resp):
    body = resp.json()
    return body["results"] if isinstance(body, dict) and "results" in body else body


# ---------------------------------------------------------------------------
# Cross-tenant judgment
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_cross_judgment_detail_names_the_initiator_and_every_seat(world):
    a, b = world["a"], world["b"]
    j = _bench(a, b)

    resp = world["client_a"].get(f"{CJ}{j.pk}/")
    assert resp.status_code == 200, resp.content
    data = resp.json()
    # The pk stays; code and display name sit beside it.
    assert data["initiating_tenant"] == a.pk
    assert data["initiating_tenant_code"] == "DN_A"
    assert data["initiating_tenant_display_name"] == "Alpha Display Hall"
    [seat] = data["participants"]
    assert seat["participant_tenant"] == b.pk
    assert seat["participant_tenant_code"] == "DN_B"
    assert seat["participant_tenant_display_name"] == "Beta Display Hall"


@pytest.mark.django_db
def test_cross_judgment_list_names_the_initiator(world):
    a, b = world["a"], world["b"]
    mine = _bench(a, title="mine")
    theirs = _bench(b, a, title="seated")  # A is seated on B's bench, so A sees it

    resp = world["client_a"].get(CJ)
    assert resp.status_code == 200, resp.content
    rows = {r["id"]: r for r in _results(resp)}
    assert set(rows) == {str(mine.pk), str(theirs.pk)}
    assert rows[str(mine.pk)]["initiating_tenant_display_name"] == "Alpha Display Hall"
    assert rows[str(theirs.pk)]["initiating_tenant"] == b.pk
    assert rows[str(theirs.pk)]["initiating_tenant_code"] == "DN_B"
    assert rows[str(theirs.pk)]["initiating_tenant_display_name"] == "Beta Display Hall"


@pytest.mark.django_db
def test_a_bench_the_caller_is_not_on_leaks_no_name(world):
    """C's bench with B seated: A is on neither side, so neither C's name nor B's
    may appear anywhere in A's list, and the detail stays 404."""
    b, c = world["b"], world["c"]
    foreign = _bench(c, b, title="foreign")

    listed = world["client_a"].get(CJ)
    assert listed.status_code == 200
    body = listed.content.decode()
    assert "Gamma Display Hall" not in body
    assert "Beta Display Hall" not in body
    assert "DN_C" not in body
    assert _results(listed) == []

    detail = world["client_a"].get(f"{CJ}{foreign.pk}/")
    assert detail.status_code == 404
    assert "Gamma Display Hall" not in detail.content.decode()


@pytest.mark.django_db
def test_the_cross_judgment_list_does_not_query_once_per_row(world):
    """The list reads `initiating_tenant.code` and `.display_name`. Without the
    `select_related("initiating_tenant")` each row would add a query. Ten rows
    from five different initiators must cost what one row costs."""
    a = world["a"]
    _bench(a, title="first")
    # Warm-up: the first request of a test also fills the permission cache, a
    # query the second one does not pay. Measure both from the same state.
    assert world["client_a"].get(CJ).status_code == 200
    with CaptureQueriesContext(connection) as one_row:
        resp = world["client_a"].get(CJ)
    assert resp.status_code == 200 and len(_results(resp)) == 1

    for i in range(9):
        other = _tenant(f"DN_Q{i % 5}", f"Query Hall {i % 5}")
        _bench(other, a, title=f"row{i}")  # A is seated, so each is in A's list

    with CaptureQueriesContext(connection) as ten_rows:
        resp = world["client_a"].get(CJ)
    rows = _results(resp)
    assert len(rows) == 10
    assert {r["initiating_tenant_display_name"] for r in rows} >= {"Query Hall 0", "Query Hall 4"}
    assert len(ten_rows) == len(one_row), (
        f"{len(one_row)} queries for one row, {len(ten_rows)} for ten:\n"
        + "\n".join(q["sql"] for q in ten_rows.captured_queries)
    )


# ---------------------------------------------------------------------------
# Workflow approver
# ---------------------------------------------------------------------------


def _workflow_with_decided_nodes(tenant, approvers):
    from apps.souls.models import Soul

    soul = Soul.objects.create(name="DN Soul", tenant=tenant)
    wf = ApprovalWorkflow.objects.create(workflow_name="DN WF", soul=soul, tenant=tenant)
    for i, user in enumerate(approvers, start=1):
        ApprovalNode.objects.create(
            workflow=wf, node_name=f"n{i}", node_order=i,
            status="APPROVED", verdict="PASSED", approver=user,
        )
    ApprovalNode.objects.create(workflow=wf, node_name="open", node_order=len(approvers) + 1)
    return wf


@pytest.mark.django_db
def test_a_decided_node_names_its_approver_and_an_open_one_is_null(world):
    a = world["a"]
    decider = User.objects.create_user(
        username="dn_decider", password="x", role="JUDGE", tenant=a, display_name="秦广王判官",
    )
    wf = _workflow_with_decided_nodes(a, [decider])

    resp = world["client_a"].get(f"{WORKFLOWS}{wf.pk}/")
    assert resp.status_code == 200, resp.content
    nodes = sorted(resp.json()["nodes"], key=lambda n: n["node_order"])
    decided, still_open = nodes
    assert decided["approver"] == decider.pk
    assert decided["approver_username"] == "dn_decider"
    assert decided["approver_display_name"] == "秦广王判官"
    # Undecided: all three null, not an empty string that reads as "someone".
    assert still_open["approver"] is None
    assert still_open["approver_username"] is None
    assert still_open["approver_display_name"] is None


@pytest.mark.django_db
def test_another_tenants_workflow_approver_is_not_reachable(world):
    b = world["b"]
    foreign_decider = User.objects.create_user(
        username="dn_foreign_decider", password="x", role="JUDGE", tenant=b, display_name="Foreign Decider",
    )
    wf = _workflow_with_decided_nodes(b, [foreign_decider])

    detail = world["client_a"].get(f"{WORKFLOWS}{wf.pk}/")
    assert detail.status_code == 404
    listed = world["client_a"].get(WORKFLOWS)
    assert listed.status_code == 200
    for body in (detail.content.decode(), listed.content.decode()):
        assert "dn_foreign_decider" not in body
        assert "Foreign Decider" not in body


@pytest.mark.django_db
def test_the_workflow_detail_does_not_query_once_per_approver(world):
    a = world["a"]
    users = [
        User.objects.create_user(username=f"dn_ap{i}", password="x", role="JUDGE", tenant=a)
        for i in range(4)
    ]
    one = _workflow_with_decided_nodes(a, users[:1])
    four = _workflow_with_decided_nodes(a, users)

    assert world["client_a"].get(f"{WORKFLOWS}{one.pk}/").status_code == 200  # warm-up, as above
    with CaptureQueriesContext(connection) as q_one:
        assert world["client_a"].get(f"{WORKFLOWS}{one.pk}/").status_code == 200
    with CaptureQueriesContext(connection) as q_four:
        resp = world["client_a"].get(f"{WORKFLOWS}{four.pk}/")
    assert resp.status_code == 200
    assert {n["approver_username"] for n in resp.json()["nodes"]} == {u.username for u in users} | {None}
    assert len(q_four) == len(q_one)


# ---------------------------------------------------------------------------
# Scheduler run tenant
# ---------------------------------------------------------------------------


@pytest.fixture
def scheduler_reader(world):
    from apps.perm.models import Permission, Role, RolePermission

    role = Role.objects.get(name="JUDGE")
    RolePermission.objects.get_or_create(role=role, permission=Permission.objects.get(codename="scheduler.read"))
    return world["client_a"]


@pytest.mark.django_db
def test_a_run_names_its_tenant_and_other_tenants_runs_stay_out(world, scheduler_reader):
    a, b = world["a"], world["b"]
    TaskRun.objects.create(task_name="t", celery_task_id="dn-a", tenant=a)
    TaskRun.objects.create(task_name="t", celery_task_id="dn-b", tenant=b)

    resp = scheduler_reader.get(RUNS)
    assert resp.status_code == 200, resp.content
    rows = _results(resp)
    assert [r["celery_task_id"] for r in rows] == ["dn-a"]
    [row] = rows
    assert row["tenant"] == a.pk
    assert row["tenant_code"] == "DN_A"
    assert row["tenant_display_name"] == "Alpha Display Hall"
    body = resp.content.decode()
    assert "Beta Display Hall" not in body and "DN_B" not in body


@pytest.mark.django_db
def test_a_global_run_has_null_names(world):
    from apps.scheduler.serializers import TaskRunSerializer

    run = TaskRun.objects.create(task_name="t", celery_task_id="dn-global", tenant=None)
    data = json.loads(json.dumps(TaskRunSerializer(run).data, default=str))
    assert data["tenant"] is None
    assert data["tenant_code"] is None
    assert data["tenant_display_name"] is None
