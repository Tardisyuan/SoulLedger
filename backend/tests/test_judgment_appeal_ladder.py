"""上诉到多站申诉流程(apps/judgment/appeals.py,用户 2026-10-27):一次复核维持之后用剩下的次数进本文明的
APPEAL 流程;流程驳回 = 维持原判,走完 = 终审官员照常改判(同一套计划与补偿)。希腊没有这条路。"""
import pytest

from apps.events.models import SoulEvent
from apps.judgment.models import Judgment, JudgmentAppeal
from apps.souls.models import Soul
from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus, CaseType
from apps.workflow.services import NoAppealAboveMinosError, WorkflowService
from tests import sentence_plan_support as sp
from tests import test_judgment_appeals as base
from tests.soul_account_support import officer_client
from tests.test_judgment_appeals import HALL, MINE, _claim_and_decide, _file

case = base.case  # the same fixture: a soul with a judgment concluded FAILED

pytestmark = pytest.mark.django_db


def _escalate(case):
    return _file(case, escalate=True)


def _upheld_once(case):
    assert _file(case).status_code == 201
    assert _claim_and_decide(case, "UPHELD").status_code == 200


def _drive(workflow, verdicts, user):
    """Decide the flow's current station once per verdict, as `user` (the view's designation check is not this test's
    subject)."""
    for verdict in verdicts:
        workflow.refresh_from_db()
        assert workflow.complete_node(workflow.current_node_id, verdict, notes=f"{verdict} 意见", user=user)
    workflow.refresh_from_db()
    return workflow


def test_escalation_needs_a_round_upheld_on_review(case):
    response = _escalate(case)
    assert response.status_code == 409 and response.data["code"] == "not_escalatable"
    assert case["client"].get(MINE).data["judgments"][0]["can_escalate"] is False


def test_an_upheld_review_can_be_taken_up_the_chinese_appeal_flow(case):
    assert case["client"].get(MINE).data["judgments"][0]["escalation_stations"] == []
    _upheld_once(case)
    row = case["client"].get(MINE).data["judgments"][0]
    assert row["can_escalate"] is True
    # The confirmation page lists the stations the flow will have, before it is built.
    assert row["escalation_stations"] == ["魏征 · 察查司", "原殿阎王 · 复核", "上级殿阎王", "酆都大帝 · 终审"]

    response = _escalate(case)
    assert response.status_code == 201, response.data
    assert (response.data["round"], response.data["status"]) == (2, "IN_REVIEW")
    workflow = ApprovalWorkflow.all_objects.get(pk=response.data["workflow"])
    assert workflow.case_type == CaseType.APPEAL and workflow.is_appeal
    assert workflow.status == ApprovalWorkflowStatus.IN_PROGRESS
    # 魏征 → 原殿 → 上级殿 → 酆都大帝 (docs/03_人物关系图.md; local-gates/流程退回规则草案.md 申诉审判流程)
    assert [n.node_name for n in workflow.nodes.order_by("node_order")] == [
        "魏征 · 察查司", "原殿阎王 · 复核", "上级殿阎王", "酆都大帝 · 终审"]
    filed = SoulEvent.objects.get(soul=case["soul"], event_type="JUDGMENT_APPEAL_FILED", payload__round=2)
    assert filed.payload["escalated"] is True and filed.payload["workflow_id"] == str(workflow.pk)
    # The officer appeal page names the flow; the workflow names the appeal.
    reviewer = officer_client(case["reviewer"])
    row = reviewer.get(f"{HALL}{response.data['id']}/").data
    assert row["workflow_number"] == workflow.number and row["workflow_status"] == "IN_PROGRESS"
    detail = reviewer.get(f"/api/v1/workflows/{workflow.pk}/").data
    assert detail["judgment_appeal"]["id"] == response.data["id"]


def test_an_escalation_may_leave_the_reason_out_a_single_review_may_not(case):
    blank = {"judgment": str(case["judgment"].pk), "reason": "  "}
    assert case["client"].post(MINE, blank, format="json").status_code == 400
    _upheld_once(case)
    response = case["client"].post(MINE, {**blank, "escalate": True}, format="json")
    assert response.status_code == 201, response.data
    assert response.data["reason"] == ""


def test_while_the_flow_runs_nobody_claims_decides_or_withdraws(case):
    _upheld_once(case)
    appeal_id = _escalate(case).data["id"]
    reviewer = officer_client(case["reviewer"])
    assert reviewer.post(f"{HALL}{appeal_id}/claim/").data["code"] == "ladder_running"
    assert reviewer.post(f"{HALL}{appeal_id}/decide/", {"outcome": "UPHELD", "note": "x"},
                         format="json").data["code"] == "ladder_running"
    assert case["client"].post(f"{MINE}{appeal_id}/withdraw/").data["code"] == "ladder_running"


def test_a_rejecting_station_upholds_the_original_verdict(case):
    _upheld_once(case)
    appeal_id = _escalate(case).data["id"]
    appeal = JudgmentAppeal.all_objects.get(pk=appeal_id)
    workflow = _drive(appeal.workflow, ["FAILED"], case["reviewer"])  # 察查司 不受理 → flow ends
    assert workflow.status == ApprovalWorkflowStatus.REJECTED
    appeal.refresh_from_db()
    assert appeal.status == "UPHELD" and appeal.decided_at is not None
    assert appeal.decision_note == "FAILED 意见" and appeal.reviewer_id == case["reviewer"].pk
    assert Judgment.all_objects.get(pk=case["judgment"].pk).verdict == "FAILED"
    decided = [SoulEvent.objects.get(soul=case["soul"], event_type="JUDGMENT_APPEAL_DECIDED", payload__round=2)]
    assert decided[0].payload["round"] == 2 and decided[0].payload["status"] == "UPHELD"


def test_a_completed_flow_hands_the_amendment_to_the_final_judge(case):
    _upheld_once(case)
    appeal_id = _escalate(case).data["id"]
    appeal = JudgmentAppeal.all_objects.get(pk=appeal_id)
    final_judge = sp.officer("fengdu", "JUDGE", case["judgment"].tenant)
    _drive(appeal.workflow, ["PASSED"] * 3, case["reviewer"])
    workflow = _drive(appeal.workflow, ["PASSED"], final_judge)
    assert workflow.status == ApprovalWorkflowStatus.COMPLETED
    appeal.refresh_from_db()
    assert appeal.status == "IN_REVIEW" and appeal.reviewer_id == final_judge.pk

    # Same decide as the single step: plan and compensation machinery included.
    other = officer_client(case["reviewer"])
    refused = other.post(f"{HALL}{appeal_id}/decide/", {"outcome": "AMENDED", "verdict": "PASSED", "note": "改"},
                         format="json")
    assert refused.status_code == 403 and refused.data["code"] == "not_reviewer"
    response = officer_client(final_judge).post(
        f"{HALL}{appeal_id}/decide/", {"outcome": "AMENDED", "verdict": "PASSED", "note": "终审改判"}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["status"] == "AMENDED" and response.data["new_verdict"] == "PASSED"
    assert Judgment.all_objects.get(pk=case["judgment"].pk).verdict == "PASSED"


def _ladder(case, appeal_id):
    """The ladder as the soul sees it (the list) and as the officer sees it (the detail): the same structure."""
    mine = next(r for r in case["client"].get(MINE).data["results"] if r["id"] == appeal_id)
    officer = officer_client(case["reviewer"]).get(f"{HALL}{appeal_id}/").data
    assert mine["ladder"] == officer["ladder"]
    return mine["ladder"]


def _states(ladder):
    return [(s["order"], s["state"], s["note"]) for s in ladder["stations"]]


def test_a_single_review_has_no_ladder(case):
    appeal_id = _file(case).data["id"]
    assert _ladder(case, appeal_id) is None


def test_the_ladder_mid_flow_names_each_station_and_the_current_one(case):
    _upheld_once(case)
    appeal_id = _escalate(case).data["id"]
    _drive(JudgmentAppeal.all_objects.get(pk=appeal_id).workflow, ["PASSED"], case["reviewer"])
    ladder = _ladder(case, appeal_id)
    assert (ladder["current"], ladder["total"]) == (2, 4)
    assert [s["name"] for s in ladder["stations"]] == ["魏征 · 察查司", "原殿阎王 · 复核", "上级殿阎王", "酆都大帝 · 终审"]
    assert [s["is_final"] for s in ladder["stations"]] == [False, False, False, True]
    assert _states(ladder) == [(1, "PASSED", "PASSED 意见"), (2, "CURRENT", None), (3, "AHEAD", None),
                               (4, "AHEAD", None)]
    # No reviewer, no approver: the soul is not told who heard it (same as the single review).
    assert not {"approver", "approver_name", "reviewer"} & set(ladder["stations"][0])


def test_a_rejecting_station_cuts_the_ladder(case):
    _upheld_once(case)
    appeal_id = _escalate(case).data["id"]
    # Station 1 refuses: the flow ends there (a later station may carry a 驳回到 back instead, which re-opens it).
    _drive(JudgmentAppeal.all_objects.get(pk=appeal_id).workflow, ["FAILED"], case["reviewer"])
    ladder = _ladder(case, appeal_id)
    assert (ladder["current"], ladder["total"]) == (None, 4)
    # The stations after it stay AHEAD; with the flow ended, the client writes 不再审 for them.
    assert _states(ladder) == [(1, "REJECTED", "FAILED 意见"), (2, "AHEAD", None), (3, "AHEAD", None),
                               (4, "AHEAD", None)]
    assert next(r for r in case["client"].get(MINE).data["results"] if r["id"] == appeal_id)[
        "workflow_status"] == "REJECTED"


def test_a_finished_ladder_is_passed_to_the_end(case):
    _upheld_once(case)
    appeal_id = _escalate(case).data["id"]
    workflow = JudgmentAppeal.all_objects.get(pk=appeal_id).workflow
    _drive(workflow, ["PASSED"] * 3, case["reviewer"])
    _drive(workflow, ["PASSED"], sp.officer("fengdu", "JUDGE", case["judgment"].tenant))
    ladder = _ladder(case, appeal_id)
    assert (ladder["current"], ladder["total"]) == (None, 4)
    assert [s["state"] for s in ladder["stations"]] == ["PASSED"] * 4


def test_a_running_ladder_waits_in_the_unclaimed_queue_not_under_review(case):
    _upheld_once(case)
    appeal_id = _escalate(case).data["id"]
    reviewer = officer_client(case["reviewer"])
    waiting = reviewer.get(HALL, {"status__in": "PENDING,IN_REVIEW", "reviewer__isnull": "true"}).data["results"]
    in_review = reviewer.get(HALL, {"status": "IN_REVIEW", "reviewer__isnull": "false"}).data["results"]
    assert [r["id"] for r in waiting] == [appeal_id]
    assert in_review == []


def test_a_greek_appeal_flow_is_refused_not_built(gr_tenant):
    soul = Soul.objects.create(name="希腊申诉魂", tenant=gr_tenant)
    assert soul.civilization == "GREEK"
    with pytest.raises(NoAppealAboveMinosError):
        WorkflowService.start_workflow(soul, case_type=CaseType.APPEAL, tenant=gr_tenant, is_appeal=True)
    assert not ApprovalWorkflow.all_objects.filter(soul=soul).exists()


@pytest.fixture
def gr_tenant(db):
    from apps.tenants.models import Tenant

    return Tenant.objects.get_or_create(code="GR_HADES", defaults={"display_name": "Hades"})[0]
