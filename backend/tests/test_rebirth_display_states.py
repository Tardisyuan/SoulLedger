"""转生申请的三个新显示状态(Design v4 第六十一批 四,用户 2026-11-21)。

工作流在「异常处理」→ EXCEPTION、在 APPEAL 段 → RECONSIDERING(复议,不是灵魂的申诉 APPEALING),两者都仍算进行中;
管理员终止(CANCELLED)→ TERMINATED:不是驳回、不可申诉,冷却照算,`/me` 的申请带出冷却截止。
此前这三种分别落成「审批中」「审批中」「已驳回 / 申诉被驳回」。
"""
import pytest
from django.utils import timezone

from apps.soul_accounts import rebirth
from apps.soul_accounts.models import RebirthApplication
from apps.workflow.models import ApprovalWorkflow
from apps.workflow.services import WorkflowService
from tests.soul_account_support import officer_client, rebirth_ready_soul

pytestmark = pytest.mark.django_db

APPLY = "/api/v1/me/rebirth-applications/"


def _submitted(tenant, capture):
    account, client = rebirth_ready_soul(tenant)
    with capture(execute=True):
        created = client.post(APPLY, {"desired_form": "HUMAN", "statement": "愿为人"}, format="json")
    assert created.status_code == 201, created.data
    return account, client, RebirthApplication.objects.get(pk=created.data["id"])


def _flow_to(application, status, *, appeal=False):
    workflow_id = application.appeal_workflow_id if appeal else application.workflow_id
    ApprovalWorkflow.all_objects.filter(pk=workflow_id).update(status=status)
    rebirth.sync_from_workflow(workflow_id)
    return RebirthApplication.objects.get(pk=application.pk)


@pytest.mark.parametrize(("flow", "shown"), [
    ("PENDING", "UNDER_REVIEW"),
    ("IN_PROGRESS", "UNDER_REVIEW"),
    ("EXCEPTION", "EXCEPTION"),
    ("APPEAL", "RECONSIDERING"),
    ("COMPLETED", "APPROVED"),
    ("REJECTED", "REJECTED"),
    ("CANCELLED", "TERMINATED"),
])
def test_each_flow_status_projects_to_its_own_application_status(flow, shown, cn_tenant,
                                                                  django_capture_on_commit_callbacks):
    _, _, application = _submitted(cn_tenant, django_capture_on_commit_callbacks)
    assert _flow_to(application, flow).status == shown


@pytest.mark.parametrize(("flow", "shown"), [
    ("IN_PROGRESS", "APPEALING"),
    ("EXCEPTION", "EXCEPTION"),
    ("APPEAL", "RECONSIDERING"),
    ("REJECTED", "APPEAL_REJECTED"),
    ("CANCELLED", "TERMINATED"),
])
def test_the_appeal_flow_projects_the_same_way(flow, shown, cn_tenant, judge_user, django_capture_on_commit_callbacks):
    _, client, application = _submitted(cn_tenant, django_capture_on_commit_callbacks)
    application = _flow_to(application, "REJECTED")
    with django_capture_on_commit_callbacks(execute=True):
        assert client.post(f"{APPLY}{application.pk}/appeal/", {"statement": "请复核"}, format="json").status_code == 200
    application.refresh_from_db()
    assert _flow_to(application, flow, appeal=True).status == shown


def test_paused_and_reconsidering_applications_are_still_open(cn_tenant, django_capture_on_commit_callbacks):
    _, client, application = _submitted(cn_tenant, django_capture_on_commit_callbacks)
    for flow in ("EXCEPTION", "APPEAL"):
        _flow_to(application, flow)
        listing = client.get(APPLY).data
        assert listing["can_apply"] is False and listing["reason"] == "application_open", flow
        detail = client.get(f"{APPLY}{application.pk}/").data
        assert detail["decided_at"] is None and detail["can_appeal"] is False and detail["cooldown_until"] is None


def test_a_reconsideration_that_ends_leaves_its_time_on_the_application(cn_tenant, django_capture_on_commit_callbacks):
    _, client, application = _submitted(cn_tenant, django_capture_on_commit_callbacks)
    assert client.get(f"{APPLY}{application.pk}/").data["reconsidered_at"] is None
    _flow_to(application, "APPEAL")
    assert client.get(f"{APPLY}{application.pk}/").data["reconsidered_at"] is None  # still going: no line yet
    before = timezone.now()
    back = _flow_to(application, "IN_PROGRESS")
    assert back.status == "UNDER_REVIEW" and back.reconsidered_at is not None and back.reconsidered_at >= before
    assert client.get(f"{APPLY}{application.pk}/").data["reconsidered_at"] is not None


def test_a_terminated_application_cannot_be_appealed_and_its_cooldown_is_shown(cn_tenant, judge_user,
                                                                                  django_capture_on_commit_callbacks):
    _, client, application = _submitted(cn_tenant, django_capture_on_commit_callbacks)
    with django_capture_on_commit_callbacks(execute=True):
        assert WorkflowService.terminate(application.workflow, reason="材料作废") is True
    application.refresh_from_db()
    assert application.status == "TERMINATED" and application.decided_at is not None

    detail = client.get(f"{APPLY}{application.pk}/").data
    assert detail["status"] == "TERMINATED" and detail["can_appeal"] is False
    assert detail["cooldown_until"] is not None and detail["cooldown_until"] > timezone.now()
    refused = client.post(f"{APPLY}{application.pk}/appeal/", {"statement": "请复核"}, format="json")
    assert refused.status_code == 409
    # The cooldown still runs (a termination used to be a REJECTED, and its cooldown with it).
    listing = client.get(APPLY).data
    assert listing["reason"] == "cooldown" and listing["cooldown_until"] is not None
    # The officer's side says the same.
    row = officer_client(judge_user).get(f"/api/v1/soul-accounts/rebirth-applications/{application.pk}/").data
    assert row["status"] == "TERMINATED" and row["can_appeal"] is False


def test_the_other_statuses_carry_no_cooldown_on_the_application(cn_tenant, django_capture_on_commit_callbacks):
    _, client, application = _submitted(cn_tenant, django_capture_on_commit_callbacks)
    assert client.get(f"{APPLY}{application.pk}/").data["cooldown_until"] is None
    _flow_to(application, "COMPLETED")
    assert client.get(f"{APPLY}{application.pk}/").data["cooldown_until"] is None
