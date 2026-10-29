"""联审的参与殿都没有审批段(只有顾问席 / 只有召集方)时,原审流程走完同样结束联审(审查 rev-flow-engine 15,2026-10-29)。

此前 `segments.on_workflow_finished` 见没有 order>1 的段就返回,联审要召集人手动结。口径:走完(COMPLETED)= PASS,
与有外域段时同一出口;被驳回不结;空席的 PROPOSED 结不了,留着。"""
import pytest

from apps.dispatch.models import JudgmentStatus, ParticipantRole
from apps.dispatch.services import CrossTenantJudgmentService
from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus
from tests import sentence_plan_support as plan
from tests.test_workflow_segments import _decide, _run_local, w  # noqa: F401

pytestmark = pytest.mark.django_db


def _advisory(w, seats=("ADVISOR",), convene=True):  # noqa: F811
    _soul, case = plan.open_case(w.cn)
    cj = CrossTenantJudgmentService.create("联审", "d", w.cn, None)
    cj.judgment = case
    cj.save(update_fields=["judgment"])
    for realm in (w.eg, w.eu)[:len(seats)]:
        CrossTenantJudgmentService.add_participant(cj, realm, None, ParticipantRole.ADVISOR)
    if convene:
        CrossTenantJudgmentService.activate(cj)
    case.conclude("FAILED", "")
    wf = ApprovalWorkflow.objects.get(judgment=case)
    assert not wf.segments.filter(order__gt=1).exists()
    return cj, wf


@pytest.mark.parametrize("convene", [True, False])
def test_an_advisor_only_bench_concludes_pass_when_the_flow_completes(w, convene):  # noqa: F811
    cj, wf = _advisory(w, seats=("ADVISOR", "ADVISOR"), convene=convene)
    _run_local(w, wf)
    wf.refresh_from_db()
    cj.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.COMPLETED
    assert (cj.status, cj.conclusion_type) == (JudgmentStatus.CONCLUDED, "PASS")


def test_an_advisor_only_bench_stays_open_while_the_flow_runs_and_when_it_is_rejected(w):  # noqa: F811
    cj, wf = _advisory(w)
    assert _decide(w.cn_judge, wf).status_code == 200
    cj.refresh_from_db()
    assert cj.status == JudgmentStatus.ACTIVE

    assert _decide(w.cn_judge, wf, verdict="FAILED").status_code == 200
    wf.refresh_from_db()
    cj.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.REJECTED
    assert cj.status == JudgmentStatus.ACTIVE and cj.conclusion_type in (None, "")


def test_an_empty_proposed_bench_is_left_for_the_convener(w):  # noqa: F811
    cj, wf = _advisory(w, seats=(), convene=False)
    _run_local(w, wf)
    wf.refresh_from_db()
    cj.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.COMPLETED
    assert cj.status == JudgmentStatus.PROPOSED
