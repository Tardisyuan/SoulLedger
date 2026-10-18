"""The workflow's "current node" only moves forward, and only the current node is decided.

Two holes found reading `apps/workflow/models.py` on 2026-10-18:

A. `advance_to_next()` moves `current_node` past a node without deciding it, so
   the node it leaves stays PENDING. Deciding the new current node then asks
   `_pass_successor`, whose default is "the first PENDING node by order" -- the
   node just left behind. The flow walks backwards.

B. `approve_node` takes any `node_id`, and `complete_node` never checks it is the
   current node. A judge designated for a later stop can decide it while the flow
   is still on an earlier one.

These tests are written to fail on the code as it stood; the fix makes them pass.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.actors.models import Actor, ActorRole
from apps.realms.models import Realm
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from apps.workflow.models import (
    ApprovalNode,
    ApprovalWorkflow,
    ApprovalWorkflowStatus,
    NodeStatus,
)

User = get_user_model()


@pytest.fixture
def linear(db):
    """Three stops in a line, each designating the same actor, flow on stop 1."""
    tenant = Tenant.objects.get_or_create(code="PTR_T", defaults={"display_name": "Pointer"})[0]
    realm = Realm.objects.create(realm_code="PTR_REALM", name_en="P", civilization="CHINESE", tenant=tenant)
    actor = Actor.objects.create(name="判官", role=ActorRole.JUDGE, realm=realm, tenant=tenant)
    judge = User.objects.create_user(username="ptr_judge", password="x", role="ADMIN", tenant=tenant)
    judge.actor = actor
    judge.save(update_fields=["actor"])
    soul = Soul.objects.create(name="指针", current_state=SoulState.JUDGING, tenant=tenant)
    wf = ApprovalWorkflow.objects.create(
        workflow_name="三站", soul=soul, tenant=tenant, status=ApprovalWorkflowStatus.IN_PROGRESS,
    )
    nodes = [
        ApprovalNode.objects.create(
            workflow=wf, node_name=f"N{i}", node_order=i, node_type="TRIAL",
            status=NodeStatus.PENDING, approver_type="ACTOR", approver_actor=actor,
        )
        for i in (1, 2, 3)
    ]
    wf.current_node = nodes[0]
    wf.save()
    client = APIClient()
    client.force_authenticate(user=judge)
    return wf, nodes, judge, client


@pytest.mark.django_db
def test_deciding_the_node_advanced_to_does_not_walk_back(linear):
    wf, nodes, judge, _ = linear
    assert wf.advance_to_next()
    wf.refresh_from_db()
    assert wf.current_node_id == nodes[1].pk

    assert wf.complete_node(nodes[1].pk, "PASSED", user=judge)
    wf.refresh_from_db()
    assert wf.current_node_id != nodes[0].pk, "deciding stop 2 sent the flow back to stop 1, which advance had left"
    assert wf.current_node_id == nodes[2].pk
    nodes[0].refresh_from_db()
    assert nodes[0].status != NodeStatus.PENDING, "the stop advance moved past is still PENDING, so it can be handed back"


@pytest.mark.django_db
def test_a_later_stop_cannot_be_decided_while_the_flow_is_on_an_earlier_one(linear):
    wf, nodes, judge, client = linear
    response = client.post(
        f"/api/v1/workflows/{wf.pk}/approve_node/",
        {"node_id": str(nodes[2].pk), "verdict": "PASSED", "notes": ""},
        format="json",
    )
    assert response.status_code in (400, 409), (
        f"stop 3 was decided while the flow is on stop 1: {response.status_code}"
    )
    nodes[2].refresh_from_db()
    assert nodes[2].status == NodeStatus.PENDING
    wf.refresh_from_db()
    assert wf.current_node_id == nodes[0].pk


@pytest.mark.django_db
def test_the_model_refuses_a_decision_on_a_node_that_is_not_current(linear):
    wf, nodes, judge, _ = linear
    assert wf.complete_node(nodes[2].pk, "PASSED", user=judge) is False
    nodes[2].refresh_from_db()
    assert nodes[2].status == NodeStatus.PENDING
