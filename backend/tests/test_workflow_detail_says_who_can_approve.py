"""The workflow detail tells the reader whether they may decide the current node (rbac-web M-6).

The web's 「提交判决」 and 「待我处理」 used to look at `workflow.approve` alone; `approve_node` also requires the
node to designate the caller (`ApprovalNode.can_approve`) and to be the current stop. `can_approve` is that answer,
from the same function `approve_node` refuses with (`decision_codes.block_for`).
"""
import pytest

from apps.authentication.models import User
from apps.workflow.models import NodeStatus
from tests.soul_account_support import officer_client
from tests.test_officer_app import _plain_workflow

pytestmark = pytest.mark.django_db


def _detail(user, wf):
    res = officer_client(user).get(f"/api/v1/workflows/{wf.pk}/")
    assert res.status_code == 200, res.data
    return res.data


def test_the_designated_approver_may_and_an_undesignated_holder_may_not(cn_tenant, judge_user):
    wf, node = _plain_workflow(cn_tenant)  # a ROLE=JUDGE node
    assert _detail(judge_user, wf)["can_approve"] is True
    # ADMIN holds workflow.approve but the node names JUDGE: approve_node answers 403, so the detail says False
    admin = User.objects.create_user(username="hall_admin", password="x", role="ADMIN", tenant=cn_tenant)
    assert _detail(admin, wf)["can_approve"] is False
    refused = officer_client(admin).post(f"/api/v1/workflows/{wf.pk}/approve_node/",
                                         {"node_id": str(node.pk), "verdict": "PASSED"}, format="json")
    assert refused.status_code == 403


def test_a_decided_node_is_no_longer_approvable(cn_tenant, judge_user):
    wf, node = _plain_workflow(cn_tenant)
    node.status = NodeStatus.APPROVED
    node.save(update_fields=["status"])
    assert _detail(judge_user, wf)["can_approve"] is False
