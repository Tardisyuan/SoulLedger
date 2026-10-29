"""Case attachments and the officer-app to-do follow the data scope of their judgment (user 2026-10-27).

Someone whose data scope hides a judgment cannot fetch its attachments or see its to-do item.
Before, both paths filtered by hall only (security review 2026-10-27 #4).
"""
import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image

from apps.judgment import attachments as svc
from apps.judgment.models import Judgment
from apps.officer_app import todo
from apps.workflow.models import ApprovalNode, ApprovalWorkflow, ApprovalWorkflowStatus, NodeStatus
from tests.data_scope_support import org, scope
from tests.soul_account_support import dead_soul

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path


def _png():
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(buf, "PNG")
    return SimpleUploadedFile("a.png", buf.getvalue(), content_type="image/png")


def _case(tenant, court, judge):
    soul = dead_soul(tenant, name=court)
    case = Judgment.objects.create(soul=soul, civilization=soul.civilization, court=court, tenant=tenant)
    wf = ApprovalWorkflow.objects.create(soul=soul, judgment=case, workflow_name=court, case_type="STANDARD",
                                         status=ApprovalWorkflowStatus.IN_PROGRESS, tenant=tenant)
    node = ApprovalNode.objects.create(workflow=wf, node_name="初审", node_order=1, node_type="EVALUATION",
                                       approver_type="ROLE", approver_role="JUDGE", status=NodeStatus.PENDING,
                                       activated_at=timezone.now())
    wf.current_node = node
    wf.save(update_fields=["current_node"])
    return case, wf, svc.upload(judge, case, _png())


def test_a_judgment_outside_the_scope_hides_its_attachments_and_its_todo(cn_tenant, judge_user):
    inside, inside_wf, inside_file = _case(cn_tenant, "第一殿", judge_user)
    outside, outside_wf, outside_file = _case(cn_tenant, "第二殿", judge_user)
    approvals = lambda: {i["id"] for i in todo.build(judge_user)["approvals"]["items"]}  # noqa: E731
    assert svc.may_view(judge_user, outside_file) and approvals() == {str(inside_wf.pk), str(outside_wf.pk)}

    first_hall = org(cn_tenant, "第一殿")
    Judgment.objects.filter(pk=inside.pk).update(owner_org=first_hall)
    Judgment.objects.filter(pk=outside.pk).update(owner_org=org(cn_tenant, "第二殿"))
    judge_user.organization = first_hall
    judge_user.save(update_fields=["organization"])
    # 两条流程都「待我审批」(按角色),所以流程本身都看得到;挡住范围外那条的是它的案子。
    scope("JUDGE", "ORG")
    assert svc.may_view(judge_user, inside_file) is True
    assert svc.may_view(judge_user, outside_file) is False
    assert approvals() == {str(inside_wf.pk)}
    assert todo.workflow_for(todo.scope_of(judge_user), "approval", outside_wf.pk) is None
