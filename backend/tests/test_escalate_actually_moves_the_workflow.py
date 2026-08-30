"""`escalate` moves the workflow, and its audit record says something true.

`advance_to_next()` computed the next node as `get_next_node()`, which returns
the first PENDING node -- i.e. the node `current_node` already pointed at. It
assigned that to itself, saved, and returned True. Measured 2026-08-29:

    advance_to_next()          -> True,  current_node unchanged
    POST /escalate/            -> 200,   all three nodes still PENDING
    AuditLog.changes = {'skipped_node': 'fcd8f091…',
                        'advanced_to':  'fcd8f091…'}
    skipped_node == advanced_to ? True

The audit row carried its own refutation: the node it said was skipped is the
node it said it advanced to. `NodeStatus.SKIPPED` and `ESCALATED` were
declared values that no production code ever assigned.

This is not a cosmetic bug. `ApprovalNode.can_approve` fails closed for a node
that designates nobody, and every refusal points the caller at `escalate` as
"the sanctioned way past". There was no way past: any workflow whose current
node designated nobody was stuck permanently, and the operator was handed a
200 and an audit row saying it had been moved.

The two tests that covered this could not fail. One asserted
`current_node.node_order in [2, 3]` -- 2 is the answer when advance does
nothing and 3 is the answer when it works, and the comment above it argued
both ways and accepted both. The other, named
`test_denied_node_can_still_be_moved_by_escalate`, asserted only a 200 and an
AuditLog count, and never read the node.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from apps.workflow.models import (
    ApprovalNode,
    ApprovalWorkflow,
    ApprovalWorkflowStatus,
    NodeStatus,
)

User = get_user_model()
WORKFLOWS = "/api/v1/workflows"


def _jwt_client(user, tenant):
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def stuck(db):
    tenant = Tenant.objects.get_or_create(
        code="ESC_T", defaults={"display_name": "Escalate"}
    )[0]
    soul = Soul.objects.create(
        name="StuckSoul", current_state=SoulState.JUDGING, tenant=tenant
    )
    wf = ApprovalWorkflow.objects.create(
        workflow_name="卡住的流程", soul=soul, tenant=tenant,
        status=ApprovalWorkflowStatus.IN_PROGRESS,
    )
    nodes = [
        ApprovalNode.objects.create(
            workflow=wf, node_name=f"N{i}", node_order=i,
            node_type="TRIAL", status=NodeStatus.PENDING,
            # SYSTEM designates nobody -- `can_approve` fails closed, which is
            # the situation escalate exists for.
            approver_type="SYSTEM",
        )
        for i in (1, 2, 3)
    ]
    wf.current_node = nodes[0]
    wf.save()
    admin = User.objects.create_user(
        username="esc_admin", password="x", role="ADMIN", tenant=tenant
    )
    return wf, nodes, _jwt_client(admin, tenant)


@pytest.mark.django_db
def test_escalate_moves_off_the_node_it_skipped(stuck):
    wf, nodes, client = stuck
    resp = client.post(
        f"{WORKFLOWS}/{wf.pk}/escalate/", {"reason": "审批人不在"}, format="json"
    )
    assert resp.status_code == 200, resp.data

    wf.refresh_from_db()
    assert wf.current_node_id == nodes[1].pk, (
        f"the flow is still on "
        f"{wf.current_node.node_name if wf.current_node else None}"
    )
    nodes[0].refresh_from_db()
    assert nodes[0].status == NodeStatus.ESCALATED, (
        f"the skipped node is {nodes[0].status}. Leaving it PENDING means "
        f"get_next_node() hands it straight back."
    )


@pytest.mark.django_db
def test_the_audit_row_names_two_different_nodes(stuck):
    """The row that used to carry its own refutation."""
    from apps.audit.models import AuditLog

    wf, nodes, client = stuck
    assert client.post(
        f"{WORKFLOWS}/{wf.pk}/escalate/", {"reason": "r"}, format="json"
    ).status_code == 200

    row = AuditLog.objects.filter(resource="workflow.escalate").order_by(
        "-timestamp"
    ).first()
    assert row is not None, "no audit row was written"
    changes = row.changes or {}
    assert changes.get("skipped_node") == str(nodes[0].pk)
    assert changes.get("advanced_to") == str(nodes[1].pk)
    assert changes["skipped_node"] != changes["advanced_to"], (
        "the audit row says the node it skipped is the node it advanced to"
    )


@pytest.mark.django_db
def test_escalating_the_last_node_completes_the_workflow(stuck):
    """A skip is a way of finishing with a node, so the last one ends the flow.

    Otherwise escalate answers "no next node" on the final node and leaves the
    flow stuck on exactly the node the caller was trying to get past.
    """
    wf, nodes, client = stuck
    for _ in range(3):
        resp = client.post(
            f"{WORKFLOWS}/{wf.pk}/escalate/", {"reason": "r"}, format="json"
        )
        assert resp.status_code == 200, resp.data

    wf.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.COMPLETED
    assert wf.current_node is None
    assert wf.completed_at is not None
    assert all(
        n.status == NodeStatus.ESCALATED
        for n in ApprovalNode.objects.filter(workflow=wf)
    )


@pytest.mark.django_db
def test_escalate_still_demands_a_reason(stuck):
    """The cost of the override is that it is visible. Unchanged."""
    wf, _, client = stuck
    resp = client.post(f"{WORKFLOWS}/{wf.pk}/escalate/", {}, format="json")
    assert resp.status_code == 400
    wf.refresh_from_db()
    assert wf.current_node.node_order == 1


@pytest.mark.django_db
def test_stats_still_add_up_after_an_escalation(stuck):
    """ESCALATED was in neither the completed nor the pending bucket.

    Latent while nothing assigned that status; reachable now.
    """
    from apps.workflow.services import WorkflowService

    wf, _, client = stuck
    client.post(f"{WORKFLOWS}/{wf.pk}/escalate/", {"reason": "r"}, format="json")
    stats = WorkflowService.get_workflow_stats(wf)
    assert stats["completed_nodes"] + stats["pending_nodes"] == stats["total_nodes"], (
        f"{stats} -- a node fell out of both buckets"
    )
    assert stats["completed_nodes"] == 1
