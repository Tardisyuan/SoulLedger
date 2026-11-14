"""撤回落印(2026-11-14,`POST /judgment/{id}/withdraw-conclusion/`;`weighing.withdraw_conclusion`)。

原审落印后处置要等审批流程 COMPLETED 才执行,所以在第一位审批人动手之前,落印的判官可以撤回:流程 CANCELLED
(`SEAL_WITHDRAWN`)、处置与计划作废、灵魂回到审判中、另开一案并由他认领。每条测试也断言旁边那件不该发生的事没发生。
"""
import pytest

from apps.disposition.models import Disposition
from apps.events.models import SoulEvent
from apps.judgment.models import Judgment
from apps.souls.models import Soul, SoulState
from apps.workflow.models import END_REASON_WITHDRAWN, ApprovalWorkflow, ApprovalWorkflowStatus
from tests import sentence_plan_support as plan
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

SEAL = {"verdict": "FAILED", "fail_reasons": ["OTHER"], "fail_reason_note": "测"}


@pytest.fixture
def cn():
    return plan.tenant("CN_DIYU")


@pytest.fixture
def judge(cn):
    return plan.officer("wd_judge", "JUDGE", cn)


def _sealed(cn, judge):
    soul, case = plan.open_case(cn, name="撤印魂")
    response = officer_client(judge).post(f"/api/v1/judgment/{case.pk}/conclude/", SEAL, format="json")
    assert response.status_code == 200, response.data
    return soul, Judgment.all_objects.get(pk=case.pk), ApprovalWorkflow.all_objects.get(judgment=case)


def _url(case):
    return f"/api/v1/judgment/{case.pk}/withdraw-conclusion/"


def _untouched(soul, case, flow):
    soul.refresh_from_db()
    assert soul.current_state == SoulState.DISPOSED
    assert ApprovalWorkflow.all_objects.get(pk=flow.pk).status in (ApprovalWorkflowStatus.PENDING,
                                                                  ApprovalWorkflowStatus.IN_PROGRESS,
                                                                  ApprovalWorkflowStatus.COMPLETED)
    assert not Judgment.all_objects.filter(retrial_of=case).exists()
    assert not SoulEvent.all_objects.filter(soul=soul, event_type="JUDGMENT_CONCLUSION_WITHDRAWN").exists()


def test_the_judge_withdraws_the_seal_before_any_approver_acts(cn, judge):
    soul, case, flow = _sealed(cn, judge)
    client = officer_client(judge)
    assert client.get(f"/api/v1/judgment/{case.pk}/").data["can_withdraw"] is True
    assert Disposition.all_objects.filter(judgment=case, is_deleted=False).exists()

    response = client.post(_url(case))

    assert response.status_code == 201, response.data
    retrial = Judgment.all_objects.get(pk=response.data["id"])
    assert retrial.retrial_of_id == case.pk and retrial.claimed_by_id == judge.pk
    assert retrial.verdict is None and not retrial.is_final
    flow.refresh_from_db()
    assert flow.status == ApprovalWorkflowStatus.CANCELLED and flow.end_reason == END_REASON_WITHDRAWN
    soul.refresh_from_db()
    assert soul.current_state == SoulState.JUDGING
    assert not Disposition.all_objects.filter(judgment=case, is_deleted=False).exists()
    # The sealed judgment is the record of what was sealed: not rewritten.
    case.refresh_from_db()
    assert case.verdict == "FAILED" and case.is_final
    events = SoulEvent.all_objects.filter(soul=soul, event_type="JUDGMENT_CONCLUSION_WITHDRAWN")
    assert events.count() == 1
    assert events.get().payload["retrial_id"] == str(retrial.pk)
    # No second withdrawal, and neither button is drawn on the withdrawn case.
    detail = client.get(f"/api/v1/judgment/{case.pk}/").data
    assert detail["can_withdraw"] is False and detail["flow_cancelled"] is False
    again = client.post(_url(case))
    assert again.status_code == 409 and again.data["code"] == "no_pending_flow"
    assert Judgment.all_objects.filter(retrial_of=case).count() == 1


def test_another_judge_cannot_withdraw_the_seal(cn, judge):
    soul, case, flow = _sealed(cn, judge)
    other = officer_client(plan.officer("wd_other", "JUDGE", cn))
    assert other.get(f"/api/v1/judgment/{case.pk}/").data["can_withdraw"] is False

    response = other.post(_url(case))

    assert response.status_code == 403, response.data
    assert response.data["code"] == "not_your_seal"
    _untouched(soul, case, flow)


def test_no_withdrawal_once_an_approver_has_acted(cn, judge):
    soul, case, flow = _sealed(cn, judge)
    flow.complete_node(flow.current_node_id, "PASSED")
    flow.refresh_from_db()
    # A one-station flow completes on that decision: then no flow is waiting at all.
    expected = "approval_started" if flow.status == ApprovalWorkflowStatus.IN_PROGRESS else "no_pending_flow"
    client = officer_client(judge)
    assert client.get(f"/api/v1/judgment/{case.pk}/").data["can_withdraw"] is False

    response = client.post(_url(case))

    assert response.status_code == 409, response.data
    assert response.data["code"] == expected
    soul.refresh_from_db()
    assert not Judgment.all_objects.filter(retrial_of=case).exists()
    assert not SoulEvent.all_objects.filter(soul=soul, event_type="JUDGMENT_CONCLUSION_WITHDRAWN").exists()


def test_no_withdrawal_after_the_flow_completed(cn, judge):
    soul, case, flow = _sealed(cn, judge)
    ApprovalWorkflow.all_objects.filter(pk=flow.pk).update(status=ApprovalWorkflowStatus.COMPLETED)

    response = officer_client(judge).post(_url(case))

    assert response.status_code == 409 and response.data["code"] == "no_pending_flow"
    _untouched(soul, case, flow)


def test_another_halls_judge_gets_a_404(cn, judge):
    soul, case, flow = _sealed(cn, judge)
    eu = plan.tenant("EU_HEAVEN_HELL")
    # Another hall's case is outside get_object(): the same answer as a case that does not exist.
    response = officer_client(plan.officer("wd_eu", "JUDGE", eu)).post(_url(case))

    assert response.status_code == 404, response.data
    _untouched(soul, case, flow)


def test_an_open_case_has_no_seal_to_withdraw(cn, judge):
    soul, case = plan.open_case(cn, name="未判魂")

    response = officer_client(judge).post(_url(case))

    assert response.status_code == 409 and response.data["code"] == "not_withdrawable"
    assert not SoulEvent.all_objects.filter(soul=soul, event_type="JUDGMENT_CONCLUSION_WITHDRAWN").exists()
