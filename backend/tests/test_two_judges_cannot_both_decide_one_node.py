"""Two judges deciding the same node produce one decision and one refusal.

`ApprovalWorkflowViewSet.approve_node` checks `node.status != PENDING` and
then calls `complete_node`. That check ran outside any lock, and
`complete_node` did not re-check under one. Measured on real PostgreSQL 16
(a clone of the test box's database) on 2026-08-29, with a barrier placed
*between* the view's guard and the call so both threads were provably inside
the window:

    A: read node status=PENDING gate_passed=True
    B: read node status=PENDING gate_passed=True
    complete_node returns: {'B': True, 'A': True}
    stored n1: status=APPROVED verdict=PASSED approver=A notes='by A'

B's REJECTION was silently discarded and B was told `True`. Nothing recorded
that a rejection had been overwritten -- the second judge's decision simply
did not exist.

`apps/souls/models.py` already had the right shape (take the row lock,
re-read, re-decide) and was measured correct under the same experiment. This
file pins that shape here.

REQUIRES POSTGRESQL. SQLite serializes writers at the database level, so the
interleave this guards against cannot be produced there and an assertion
written for it would be one of the checks that can never fire. Skipped rather
than faked: `backend/tests/test_concurrency.py` already uses this marker.
"""
import threading

import pytest
from django.db import connection, connections

from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from apps.workflow.models import (
    ApprovalNode,
    ApprovalWorkflow,
    ApprovalWorkflowStatus,
    NodeStatus,
)

SQLITE = connection.vendor == "sqlite"
NEEDS_ROW_LOCKS = pytest.mark.skipif(
    SQLITE,
    reason=(
        "SQLite serializes writers, so two threads cannot be inside "
        "complete_node at once and the assertion could never fail. Run "
        "against PostgreSQL."
    ),
)


@pytest.fixture
def contested_node(db):
    tenant = Tenant.objects.get_or_create(
        code="RACE_T", defaults={"display_name": "Race"}
    )[0]
    soul = Soul.objects.create(
        name="ContestedSoul", current_state=SoulState.JUDGING, tenant=tenant
    )
    wf = ApprovalWorkflow.objects.create(
        workflow_name="争议流程", soul=soul, tenant=tenant,
        status=ApprovalWorkflowStatus.IN_PROGRESS,
    )
    node = ApprovalNode.objects.create(
        workflow=wf, node_name="唯一节点", node_order=1,
        node_type="TRIAL", status=NodeStatus.PENDING,
    )
    wf.current_node = node
    wf.save()
    return wf, node


@NEEDS_ROW_LOCKS
@pytest.mark.django_db(transaction=True)
def test_only_one_of_two_simultaneous_decisions_is_recorded(contested_node):
    wf, node = contested_node
    results = {}
    entered = threading.Barrier(2, timeout=10)
    barrier_ok = {"a": False, "b": False}

    def decide(name, verdict):
        try:
            # Read the node the way the view does, then wait. Both threads
            # hold a PENDING read before either calls complete_node -- this is
            # what makes the experiment about the code and not about thread
            # scheduling. A barrier placed after the call would just deadlock
            # on the row lock and report a comfortable "no conflict".
            fresh = ApprovalWorkflow.objects.get(pk=wf.pk)
            observed = ApprovalNode.objects.get(pk=node.pk).status
            assert observed == NodeStatus.PENDING
            entered.wait()
            barrier_ok[name] = True
            results[name] = fresh.complete_node(node.id, verdict, f"by {name}")
        except threading.BrokenBarrierError:
            results[name] = "barrier-broken"
        finally:
            connections.close_all()

    threads = [
        threading.Thread(target=decide, args=("a", "PASSED")),
        threading.Thread(target=decide, args=("b", "FAILED")),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)

    assert all(barrier_ok.values()), (
        f"the two threads were not both inside the window: {barrier_ok}, "
        f"{results}. A green result from a harness that never reached the "
        f"contested region proves nothing -- this is how a previous run of "
        f"this experiment reported 'no lost update' while both threads had "
        f"deadlocked and rolled back."
    )

    node.refresh_from_db()
    assert node.status in (NodeStatus.APPROVED, NodeStatus.REJECTED)
    assert sum(1 for v in results.values() if v is True) == 1, (
        f"both callers were told their decision was recorded: {results}. "
        f"The stored verdict is {node.verdict!r} -- the other judge's "
        f"decision does not exist and nothing says so."
    )
    assert sum(1 for v in results.values() if v is False) == 1, (
        f"the losing caller was not told: {results}"
    )


@pytest.mark.django_db
def test_a_second_decision_on_a_decided_node_is_refused(contested_node):
    """The same rule without threads, so it is checked on every engine.

    The race is what made this reachable; the rule is that a decided node
    cannot be re-decided, and that is testable serially.
    """
    wf, node = contested_node
    assert wf.complete_node(node.id, "PASSED", "first") is True
    node.refresh_from_db()
    assert node.status == NodeStatus.APPROVED

    assert wf.complete_node(node.id, "FAILED", "second") is False, (
        "a decided node was re-decided; complete_node had no PENDING guard at "
        "all, so calling it twice rewrote status/verdict/approver/notes"
    )
    node.refresh_from_db()
    assert node.status == NodeStatus.APPROVED
    assert node.notes == "first"


@pytest.mark.django_db
def test_the_api_tells_the_loser_what_happened(contested_node):
    """The caller must be able to tell "someone else decided" from anything else.

    Two different paths reach that outcome and both must say so:

      * the view's own `node.status != PENDING` check, which runs first and
        without a lock -- 400 "Node already processed". This is the serial
        case, and it is what this test exercises.
      * the re-check inside `complete_node`'s row lock, reachable only when a
        second decision lands between those two points -- 409, added because
        the previous answer there was a bare "Failed to complete node", which
        a caller cannot tell from a malformed request. That path needs a real
        race and is covered by the threaded test above, on PostgreSQL.

    My first version of this test asserted 409 here and failed: the view's
    guard answers first. Bending the code to satisfy the test would have meant
    removing a correct fast path.
    """
    from django.contrib.auth import get_user_model
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    User = get_user_model()
    wf, node = contested_node
    judge = User.objects.create_user(
        username="race_judge", password="x", role="JUDGE", tenant=wf.tenant
    )
    token = RefreshToken.for_user(judge)
    token["tenant_code"] = wf.tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

    wf.complete_node(node.id, "PASSED", "already decided")

    resp = client.post(
        f"/api/v1/workflows/{wf.pk}/approve_node/",
        {"node_id": str(node.pk), "verdict": "FAILED"},
        format="json",
    )
    assert resp.status_code == 400, resp.data
    assert "already processed" in str(resp.data).lower(), (
        f"the refusal does not say why: {resp.data}"
    )
