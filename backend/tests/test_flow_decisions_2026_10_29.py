"""审批流程 / 四文明流程的几项决定(用户 2026-10-29,审查 B、C、D、E/I、J、K、M、R)。

A(越级不过终审)在 tests/test_escalate_actually_moves_the_workflow.py;L(DY_01_HEAVEN 不再使用)在
tests/test_conclude_destination.py 与 tests/test_judgment_queue.py。每条都断言出现,也断言缺席。
"""
import io

import pytest
from django.core.management import call_command

from apps.dispatch.models import JudgmentStatus, ParticipantRole
from apps.dispatch.services import CrossTenantJudgmentService
from apps.disposition.models import Disposition
from apps.events.models import SoulEvent
from apps.judgment import confessions, weighing
from apps.judgment.models import (
    ChineseOffence,
    EvidenceAdmission,
    Judgment,
    JudgmentMethod,
    NegativeConfession,
    Statute,
    StatuteCorpus,
    Verdict,
)
from apps.judgment.services import JudgmentConclusionService
from apps.reincarnation.services import RebirthBlocked, assert_may_be_reborn
from apps.sentence_plan.requests import PlanChangeRefusedError
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import SoulRecord
from apps.tenants.models import Tenant
from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus, VerdictRefusedError
from tests import sentence_plan_support as sp
from tests.soul_account_support import officer_client, ready_soul
from tests.test_workflow_segments import CJ, _decide, _nodes, _pick, _run_local, _seg, merged, w  # noqa: F401

pytestmark = pytest.mark.django_db

MINE = "/api/v1/me/judgment-appeals/"


def _concluded(tenant, verdict="FAILED", **facts):
    soul, case = sp.open_case(tenant)
    if facts:
        Judgment.all_objects.filter(pk=case.pk).update(**facts)
        case.refresh_from_db()
    assert case.conclude(verdict, "") is True
    case.refresh_from_db()
    return soul, case


# ── B. 原审流程没走完不能申诉 / 上诉 ────────────────────────────────────────────


def test_a_soul_cannot_appeal_while_the_original_flow_runs_and_can_once_it_completes():
    tenant = sp.tenant("CN_DIYU")
    account, client = ready_soul(tenant)
    case = Judgment.objects.create(soul=account.soul, civilization=account.soul.civilization, court="第一殿",
                                   tenant=tenant)
    JudgmentConclusionService.conclude_judgment(case, Verdict.FAILED, "原判")
    assert ApprovalWorkflow.all_objects.get(judgment=case).status == ApprovalWorkflowStatus.IN_PROGRESS

    row = client.get(MINE).data["judgments"][0]
    assert (row["can_appeal"], row["refusal_code"], row["can_escalate"]) == (False, "origin_flow_open", False)
    res = client.post(MINE, {"judgment": str(case.pk), "reason": "冤"}, format="json")
    assert res.data["code"] == "origin_flow_open", res.data
    assert not case.appeals.exists()

    sp.walk_flow(case)
    row = client.get(MINE).data["judgments"][0]
    assert (row["can_appeal"], row["refusal_code"]) == (True, None)
    assert client.post(MINE, {"judgment": str(case.pk), "reason": "冤"}, format="json").status_code == 201


def test_an_officer_cannot_start_an_appeal_flow_while_the_original_flow_runs():
    tenant = sp.tenant("CN_DIYU")
    soul, case = _concluded(tenant)
    admin = officer_client(sp.officer("b_admin", "ADMIN", tenant))
    body = {"soul": str(soul.pk), "case_type": "APPEAL", "reason": "申诉"}
    res = admin.post("/api/v1/workflows/start/", body, format="json")
    assert (res.status_code, res.data["code"]) == (400, "origin_flow_open"), res.data
    assert not ApprovalWorkflow.all_objects.filter(soul=soul, case_type="APPEAL").exists()

    sp.walk_flow(case)
    res = admin.post("/api/v1/workflows/start/", body, format="json")
    assert res.status_code == 201, res.data


# ── C. 跨域取消:流程另立「已取消」,不触发完成钩子 ──────────────────────────────


def test_cancelling_inside_a_foreign_segment_ends_the_flow_cancelled_and_runs_no_completion_hook(w):  # noqa: F811
    _soul, case, cj, wf = merged(w, [w.eg])
    _run_local(w, wf)
    assert _pick(w.eg_judge, wf, 2).status_code == 200
    assert _decide(w.eg_judge, wf).status_code == 200

    response = officer_client(w.cn_mod).post(f"{CJ}{cj.pk}/cancel/", {"reason": "撤回"}, format="json")
    assert response.status_code == 200, response.data
    wf.refresh_from_db()
    cj.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.CANCELLED and wf.status != ApprovalWorkflowStatus.COMPLETED
    assert cj.status == JudgmentStatus.CANCELLED and cj.conclusion_type in (None, "")
    # Not passed: the disposition is not released, and no retrial is opened (no rejection hook either).
    disposition = Disposition.all_objects.get(judgment=case)
    assert weighing.unfinished_flow(disposition) == "approval_cancelled"
    assert not Judgment.objects.filter(retrial_of=case).exists()
    # A finished flow, though: no more decisions.
    assert _decide(w.eg_judge, wf).status_code != 200


# ── D. 顾问席不走审批段 ─────────────────────────────────────────────────────────


def test_an_advisor_seat_gets_no_segment_at_generation_or_when_seated_later(w):  # noqa: F811
    soul, case = sp.open_case(w.cn)
    cj = CrossTenantJudgmentService.create("联审", "d", w.cn, None)
    cj.judgment = case
    cj.save(update_fields=["judgment"])
    seat = CrossTenantJudgmentService.add_participant(cj, w.eg, None, ParticipantRole.CO_JUDGE, node_order=2)
    CrossTenantJudgmentService.submit_sentence(seat, sp.stop_realm(w.eg), 5, "", None)
    CrossTenantJudgmentService.add_participant(cj, w.eu, None, ParticipantRole.ADVISOR)
    CrossTenantJudgmentService.activate(cj)
    case.conclude("FAILED", "")
    wf = ApprovalWorkflow.objects.get(judgment=case)
    assert set(wf.segments.values_list("tenant__code", flat=True)) == {"CN_DIYU", "EG_DUAT"}

    # Seated while the flow runs: still no segment for an advisor …
    gr = sp.tenant("GR_HADES")
    CrossTenantJudgmentService.add_participant(cj, gr, None, ParticipantRole.ADVISOR)
    assert not wf.segments.filter(tenant=gr).exists()
    assert wf.segments.count() == 2


# ── E / I. 重审不继承采信、供述、否定告白 ─────────────────────────────────────────


@pytest.fixture
def weighed():
    call_command("seed_mythology", stdout=io.StringIO(), stderr=io.StringIO())
    tenant = Tenant.objects.get(code="EG_DUAT")
    soul = Soul.objects.create(name="Ani", tenant=tenant, current_state=SoulState.JUDGING)
    return Judgment.objects.create(soul=soul, tenant=tenant, civilization="EGYPTIAN", court="—",
                                   judgment_method=JudgmentMethod.HEART_WEIGHING)


def test_a_retrial_inherits_no_admission_no_confession_and_no_negative_confession(weighed):
    record = SoulRecord.objects.create(soul=weighed.soul, record_type="DEMERIT", description="窃", weight=5)
    EvidenceAdmission.objects.create(judgment=weighed, record=record, admitted=False, reason="伪证",
                                     tenant_id=weighed.tenant_id)
    Judgment.all_objects.filter(pk=weighed.pk).update(confession="我未曾偷窃")
    confessions.record(weighed, 1, False, "不实")
    confessions.record(weighed, 2, True)
    weighed.refresh_from_db()

    retrial = weighing.open_retrial(weighed)
    assert retrial.retrial_of_id == weighed.pk
    assert retrial.confession == "" and weighed.confession == "我未曾偷窃"
    assert not EvidenceAdmission.all_objects.filter(judgment=retrial).exists()
    assert EvidenceAdmission.all_objects.filter(judgment=weighed).count() == 1
    assert not NegativeConfession.all_objects.filter(judgment=retrial).exists()
    assert NegativeConfession.all_objects.filter(judgment=weighed).count() == 2
    assert confessions.untruthful_ordinals(retrial) == [] and confessions.untruthful_ordinals(weighed) == [1]


# ── J. 五逆不能判 PASSED ─────────────────────────────────────────────────────────


def test_five_heinous_refuses_passed_at_conclusion_and_writes_nothing():
    tenant = sp.tenant("CN_DIYU")
    soul, case = sp.open_case(tenant)
    Judgment.all_objects.filter(pk=case.pk).update(offence=ChineseOffence.FIVE_HEINOUS)
    case.refresh_from_db()
    admin = officer_client(sp.officer("j_admin", "ADMIN", tenant))
    res = admin.post(f"/api/v1/judgment/{case.pk}/conclude/", {"verdict": "PASSED"}, format="json")
    assert (res.status_code, res.data["code"]) == (400, "five_heinous_must_fail"), res.data
    case.refresh_from_db()
    assert case.verdict is None and not case.is_final
    assert not ApprovalWorkflow.all_objects.filter(judgment=case).exists()
    # FAILED goes through; another offence may still be PASSED.
    assert case.conclude("FAILED", "") is True
    _soul, murder = sp.open_case(tenant)
    Judgment.all_objects.filter(pk=murder.pk).update(offence=ChineseOffence.MURDER)
    murder.refresh_from_db()
    assert murder.conclude("PASSED", "") is True


def test_a_five_heinous_case_concluded_passed_before_the_rule_cannot_be_approved():
    tenant = sp.tenant("CN_DIYU")
    _soul, case = _concluded(tenant, verdict="FAILED", offence=ChineseOffence.FIVE_HEINOUS)
    flow = ApprovalWorkflow.all_objects.get(judgment=case)
    Judgment.all_objects.filter(pk=case.pk).update(verdict=Verdict.PASSED)  # a row written before the rule
    with pytest.raises(VerdictRefusedError) as refused:
        flow.complete_node(flow.current_node.pk, "PASSED")
    assert refused.value.code == "five_heinous_must_fail"
    # Refusing it is still allowed; and a FAILED case of the same offence approves as before.
    assert flow.complete_node(flow.current_node.pk, "FAILED")
    _soul, other = _concluded(tenant, verdict="FAILED", offence=ChineseOffence.FIVE_HEINOUS)
    other_flow = ApprovalWorkflow.all_objects.get(judgment=other)
    assert other_flow.complete_node(other_flow.current_node.pk, "PASSED")


def test_the_refusal_helper_only_touches_passed_on_five_heinous():
    from apps.judgment.models import refuse_passed_if_five_heinous

    case = Judgment(offence=ChineseOffence.FIVE_HEINOUS)
    with pytest.raises(PlanChangeRefusedError):
        refuse_passed_if_five_heinous(case, Verdict.PASSED)
    for verdict in (Verdict.FAILED, Verdict.PURGATORY, Verdict.RETRY):
        refuse_passed_if_five_heinous(case, verdict)
    refuse_passed_if_five_heinous(Judgment(offence=ChineseOffence.MURDER), Verdict.PASSED)


# ── K. 灵魂 LOST 期间流程被驳回:作废处置、回审判中 ─────────────────────────────────


def test_a_lost_soul_whose_flow_is_rejected_goes_back_to_judging_with_the_disposition_voided():
    tenant = sp.tenant("CN_DIYU")
    soul, case = _concluded(tenant)
    disposition = Disposition.all_objects.get(judgment=case)
    assert Soul.objects.get(pk=soul.pk).transition_to(SoulState.LOST, "途中走失")
    flow = ApprovalWorkflow.all_objects.get(judgment=case)
    flow.complete_node(flow.current_node.pk, "FAILED")

    flow.refresh_from_db()
    assert flow.status == ApprovalWorkflowStatus.REJECTED
    assert Soul.objects.get(pk=soul.pk).current_state == SoulState.JUDGING
    assert Disposition.all_objects.get(pk=disposition.pk).is_deleted
    assert Judgment.objects.filter(retrial_of=case).exists()


def test_a_person_still_cannot_move_a_lost_soul_to_judging():
    tenant = sp.tenant("CN_DIYU")
    soul = Soul.objects.create(name="走失", tenant=tenant, current_state=SoulState.LOST)
    assert soul.can_transition_to(SoulState.JUDGING) is False
    assert soul.can_transition_to(SoulState.JUDGING, system="weighing_rejected") is True


# ── M. 否定告白整轮记完写一条汇总事件 ─────────────────────────────────────────────


def test_one_summary_event_when_the_last_denial_is_recorded_and_none_before_or_after(weighed):
    total = Statute.all_objects.filter(tenant_id=weighed.tenant_id, corpus=StatuteCorpus.NEGATIVE_CONFESSION,
                                       is_deleted=False).count()
    assert total == 42

    def events():
        return SoulEvent.objects.filter(soul=weighed.soul, event_type="NEGATIVE_CONFESSION_HEARD")

    for ordinal in range(1, total):
        confessions.record(weighed, ordinal, ordinal != 7)
    confessions.record(weighed, 3, None)  # back to unheard: still not a full round
    assert not events().exists()
    confessions.record(weighed, 3, True)
    assert not events().exists()
    confessions.record(weighed, total, True)
    assert events().count() == 1
    payload = events().get().payload
    assert (payload["truthful"], payload["untruthful"], payload["total"]) == (41, 1, 42)
    assert payload["untruthful_ordinals"] == [7] and payload["judgment_id"] == str(weighed.pk)
    confessions.record(weighed, 7, True)  # changing a denial after the round: no second summary
    assert events().count() == 1


# ── R. 原审流程未完不能转世 ───────────────────────────────────────────────────────


def test_rebirth_waits_for_the_original_flow():
    tenant = sp.tenant("CN_DIYU")
    soul, case = _concluded(tenant)
    with pytest.raises(RebirthBlocked) as blocked:
        assert_may_be_reborn(Soul.objects.get(pk=soul.pk))
    assert blocked.value.detail["code"] == "origin_flow_open"
    sp.walk_flow(case)
    with pytest.raises(RebirthBlocked) as blocked:
        assert_may_be_reborn(Soul.objects.get(pk=soul.pk))
    assert blocked.value.detail["code"] != "origin_flow_open"  # the next gate (the unexecuted disposition)
