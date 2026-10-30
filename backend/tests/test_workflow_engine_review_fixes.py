"""审批流程引擎只读审查(2026-10-29)里不需要产品拍板的那些修复,逐条一个(或几个)用例。

条目编号是审查报告的;字母是同日第二批(另两份审查)。要拍板的(E 采信与供述是否随案、F SKIPPED 去留、G 手动流程
是否给钩子)只做了技术护栏,护栏本身在这里钉住。2026-10-29 用户拍板之后的那几条在
tests/test_flow_decisions_2026_10_29.py。
"""
import datetime
from contextlib import contextmanager

import pytest
from django.db import connection, transaction
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.disposition.models import Disposition
from apps.disposition.services import DispositionService
from apps.events.models import SoulEvent
from apps.judgment import appeals, weighing
from apps.judgment.models import Judgment, JudgmentAppeal, JudgmentKind, Verdict
from apps.realms.models import SoulPathEntry
from apps.sentence_plan import requests as plan_requests
from apps.sentence_plan.models import SentencePlan
from apps.souls.models import Soul, SoulState
from apps.workflow import timeouts
from apps.workflow.filters import WorkflowFilter
from apps.workflow.models import (
    BRANCH_SKIPPED,
    END_REASON_BRANCH_SKIPPED,
    ApprovalNode,
    ApprovalWorkflow,
    ApprovalWorkflowStatus,
    CaseType,
    NodeKind,
    NodeStatus,
)
from apps.workflow.services import WorkflowService
from tests import sentence_plan_support as sp
from tests import test_judgment_appeals as appeal_base
from tests.soul_account_support import officer_client
from tests.test_judgment_appeal_ladder import _drive, _upheld_once
from tests.test_judgment_appeals import _file
from tests.test_workflow_timeout_and_reject_to import _age, _node, _workflow

pytestmark = pytest.mark.django_db

@pytest.fixture
def case(cn_tenant):
    """A Diyu soul (with its /me client) and a judgment concluded FAILED, its flow in progress."""
    return appeal_base.make_case(cn_tenant)


@contextmanager
def _filed_before_rule_b(case):
    """Appeals filed while the origin flow ran. Refused since 2026-10-29 (review B, `origin_flow_open`), but rows
    filed before it still exist, and what a refused flow does to them is what these tests pin. The flow reads
    COMPLETED only while the filing runs."""
    flow = ApprovalWorkflow.all_objects.get(judgment_id=case["judgment"].pk)
    ApprovalWorkflow.all_objects.filter(pk=flow.pk).update(status=ApprovalWorkflowStatus.COMPLETED)
    try:
        yield
    finally:
        ApprovalWorkflow.all_objects.filter(pk=flow.pk).update(status=flow.status)


@pytest.fixture
def cn():
    return sp.tenant("CN_DIYU")


def _origin_flow(judgment):
    return ApprovalWorkflow.all_objects.get(judgment_id=judgment.pk)


def _reject(flow):
    flow.refresh_from_db()
    assert flow.complete_node(flow.current_node_id, "FAILED")
    flow.refresh_from_db()
    return flow


def _diyu_failed(cn):
    """地府 FAILED 结案,流程还在走:一份挂在原属节点上、还没执行的处置。返回 (soul, case, disposition)。"""
    soul, judgment = sp.open_case(cn)
    assert judgment.conclude(Verdict.FAILED, "") is True
    judgment.refresh_from_db()
    return soul, judgment, Disposition.all_objects.get(judgment=judgment)


def _three_stops(tenant, *, on_pass_to_third=False):
    """Three stops by order; with `on_pass_to_third` the first one's PASS goes to the third."""
    nodes = [_node(1, **({"on_pass": "n3"} if on_pass_to_third else {})), _node(2), _node(3)]
    return _workflow(tenant, nodes)


# ── 1 / d. A refused conclusion takes its open appeals and its station with it ──────────────────


def test_a_refused_flow_voids_the_open_appeal_and_leaves_the_withdrawn_station(case):
    judgment = case["judgment"]
    disposition = Disposition.all_objects.get(judgment=judgment)
    realm_id = disposition.destination_realm_id
    assert SoulPathEntry.all_objects.filter(soul_id=case["soul"].pk, realm_id=realm_id, left_at__isnull=True).exists()
    with _filed_before_rule_b(case):
        appeal_id = _file(case).data["id"]

    _reject(_origin_flow(judgment))

    appeal = JudgmentAppeal.all_objects.get(pk=appeal_id)
    assert appeal.status == "VOID" and appeal.decided_at is not None
    event = SoulEvent.all_objects.get(soul_id=case["soul"].pk, event_type="JUDGMENT_APPEAL_DECIDED")
    assert (event.payload["status"], event.payload["voided_because"]) == ("VOID", "case_reopened")
    assert Disposition.all_objects.get(pk=disposition.pk).is_deleted
    assert not SoulPathEntry.all_objects.filter(soul_id=case["soul"].pk, realm_id=realm_id,
                                                left_at__isnull=True).exists()
    assert Judgment.objects.filter(retrial_of=judgment).exists()


def test_an_amendment_does_not_reroute_a_voided_disposition(case):
    """`amend_for_appeal`'s no-plan branch read `Disposition.all_objects.filter(judgment_id=…)` with deleted rows in."""
    judgment = case["judgment"]
    disposition = Disposition.all_objects.get(judgment=judgment)
    _reject(_origin_flow(judgment))  # voids the disposition and the plan
    before = Disposition.all_objects.filter(pk=disposition.pk).values_list("version", "update_time").get()
    soul = Soul.all_objects.get(pk=case["soul"].pk)
    with transaction.atomic():
        assert plan_requests.amend_for_appeal(soul, judgment, Verdict.FAILED) == []
    assert Disposition.all_objects.filter(pk=disposition.pk).values_list("version", "update_time").get() == before
    assert not SoulPathEntry.all_objects.filter(soul_id=soul.pk, left_at__isnull=True,
                                                realm_id=disposition.destination_realm_id).exists()


def test_a_ladder_on_the_refused_conclusion_ends_with_it(case):
    with _filed_before_rule_b(case):
        _upheld_once(case)
        appeal_id = _file(case, escalate=True).data["id"]
    _reject(_origin_flow(case["judgment"]))
    appeal = JudgmentAppeal.all_objects.get(pk=appeal_id)
    ladder = ApprovalWorkflow.all_objects.get(pk=appeal.workflow_id)
    assert appeal.status == "VOID"
    assert (ladder.status, ladder.end_reason) == (ApprovalWorkflowStatus.REJECTED, appeals.END_REASON_REOPENED)
    # Not upheld on top of being voided (`on_ladder_finished` found no open appeal).
    statuses = list(SoulEvent.all_objects.filter(soul_id=case["soul"].pk, event_type="JUDGMENT_APPEAL_DECIDED",
                                                 payload__round=2).values_list("payload__status", flat=True))
    assert statuses == ["VOID"]


# ── 3. Lock order: the appeal flow before the appeal ────────────────────────────────────────────


def test_voiding_locks_the_appeal_flow_before_it_writes_the_appeal(case):
    """Approving a station locks the flow, then (`on_ladder_finished`) the appeal. Voiding used to lock the appeal and
    only then the flow: two transactions doing both at once wait on each other. On SQLite the order of statements is
    what can be read, so: the workflow is read (locked, on PostgreSQL) before any appeal row is written."""
    with _filed_before_rule_b(case):
        _upheld_once(case)
        _file(case, escalate=True)
    soul = Soul.all_objects.get(pk=case["soul"].pk)
    with CaptureQueriesContext(connection) as queries, transaction.atomic():
        appeals.void_open_appeals(soul, because="test", end_reason="TEST")
    sql = [q["sql"] for q in queries.captured_queries]
    flow_read = next(i for i, s in enumerate(sql) if s.startswith("SELECT") and '"workflow_approvalworkflow"' in s
                     and "FROM \"workflow_approvalworkflow\"" in s)
    appeal_write = next(i for i, s in enumerate(sql) if s.startswith("UPDATE") and '"judgment_judgmentappeal"' in s)
    assert flow_read < appeal_write


# ── 4. A flow started by hand does not decide the judgment it names ─────────────────────────────


def test_a_hand_started_flow_naming_the_judgment_neither_withdraws_nor_holds_it(cn):
    soul, judgment, disposition = _diyu_failed(cn)
    flow = _origin_flow(judgment)
    ApprovalWorkflow.all_objects.filter(pk=flow.pk).update(manually_started=True)
    assert weighing.unfinished_flow(disposition) is None  # not held by a flow that does not decide it
    _reject(flow)
    soul.refresh_from_db()
    assert soul.current_state == SoulState.DISPOSED
    assert not Disposition.all_objects.get(pk=disposition.pk).is_deleted
    assert not Judgment.objects.filter(retrial_of=judgment).exists()


def test_the_start_door_marks_its_flow_and_the_judgment_door_does_not(cn):
    lead = sp.officer("start_lead", "ADMIN", cn)
    soul = Soul.objects.create(name="特案", tenant=cn, current_state=SoulState.JUDGING)
    res = officer_client(lead).post("/api/v1/workflows/start/",
                                    {"soul": str(soul.pk), "case_type": CaseType.SPECIAL, "reason": "复查"},
                                    format="json")
    assert res.status_code == 201, res.data
    assert ApprovalWorkflow.all_objects.get(pk=res.data["id"]).manually_started is True
    _soul, judgment, _disposition = _diyu_failed(cn)
    assert _origin_flow(judgment).manually_started is False


# ── 5. Verdict vocabulary ──────────────────────────────────────────────────────────────────────


def test_template_nodes_carry_no_verdict_list_and_skipped_is_refused(cn):
    flow = _three_stops(cn)
    assert all(v == [] for v in flow.nodes.values_list("required_verdicts", flat=True))
    judge = sp.officer("verdict_judge", "JUDGE", cn)
    res = officer_client(judge).post(f"/api/v1/workflows/{flow.pk}/approve_node/", {"verdict": "SKIPPED"},
                                     format="json")
    assert (res.status_code, res.data["code"]) == (400, "skipped_not_a_verdict"), res.data
    flow.refresh_from_db()
    assert flow.status == ApprovalWorkflowStatus.IN_PROGRESS and flow.current_node.status == NodeStatus.PENDING


def test_a_node_that_lists_its_verdicts_refuses_the_others_with_a_code(cn):
    flow = _three_stops(cn)
    ApprovalNode.objects.filter(pk=flow.current_node_id).update(required_verdicts=["CONFIRMED"])
    judge = sp.officer("verdict_judge2", "JUDGE", cn)
    res = officer_client(judge).post(f"/api/v1/workflows/{flow.pk}/approve_node/", {"verdict": "PASSED"},
                                     format="json")
    assert (res.status_code, res.data["code"]) == (400, "verdict_not_accepted"), res.data
    assert res.data["required_verdicts"] == ["CONFIRMED"]


# ── 8 / 9 / 24. advance and escalate ───────────────────────────────────────────────────────────


def test_advance_and_escalate_follow_where_a_pass_would_go(cn):
    advanced = _three_stops(cn, on_pass_to_third=True)
    assert advanced.advance_to_next(reason="卡住")
    advanced.refresh_from_db()
    assert advanced.current_node.node_order == 3  # by order it used to be 2, a stop the PASS skips
    assert advanced.nodes.get(node_order=2).status == NodeStatus.SKIPPED

    escalated = _three_stops(cn, on_pass_to_third=True)
    assert escalated.escalate_current_node(reason="越级")
    escalated.refresh_from_db()
    assert escalated.current_node.node_order == 3


def test_advance_rereads_the_flow_under_its_lock(cn):
    flow = _three_stops(cn)
    stale = ApprovalWorkflow.all_objects.get(pk=flow.pk)
    assert ApprovalWorkflow.all_objects.get(pk=flow.pk).advance_to_next(reason="一")
    assert stale.advance_to_next(reason="二")  # its copy still says stop 1
    stale.refresh_from_db()
    assert stale.current_node.node_order == 3


def test_advance_with_nowhere_to_go_changes_nothing(cn):
    flow = _workflow(cn, [_node(1)])
    assert flow.advance_to_next(reason="x") is False
    flow.refresh_from_db()
    assert flow.current_node.status == NodeStatus.PENDING and flow.status == ApprovalWorkflowStatus.IN_PROGRESS


def test_advance_over_http_needs_a_reason_and_leaves_an_audit_row(cn):
    flow = _three_stops(cn)
    judge = officer_client(sp.officer("adv_judge", "ADMIN", cn))
    refused = judge.post(f"/api/v1/workflows/{flow.pk}/advance/", {}, format="json")
    assert (refused.status_code, refused.data["code"]) == (400, "reason_required")
    first = flow.current_node_id
    res = judge.post(f"/api/v1/workflows/{flow.pk}/advance/", {"reason": "审批人告假"}, format="json")
    assert res.status_code == 200, res.data
    skipped = ApprovalNode.objects.get(pk=first)
    assert (skipped.status, skipped.notes) == (NodeStatus.SKIPPED, "审批人告假")
    row = AuditLog.objects.get(resource="workflow.advance", resource_id=str(flow.pk))
    assert row.changes["reason"] == "审批人告假" and row.changes["skipped_node"] == str(first)


def test_the_advance_audit_row_records_the_client_not_the_proxy(cn, settings):
    """推进的审计行走 `get_client_ip`(与其它审计行同一处),不是裸 REMOTE_ADDR —— 那是反向代理的地址。"""
    settings.TRUSTED_PROXY_COUNT = 1
    flow = _three_stops(cn)
    judge = officer_client(sp.officer("adv_judge_ip", "ADMIN", cn))
    res = judge.post(f"/api/v1/workflows/{flow.pk}/advance/", {"reason": "审批人告假"}, format="json",
                     REMOTE_ADDR="10.0.0.2", HTTP_X_FORWARDED_FOR="203.0.113.9, 10.0.0.2")
    assert res.status_code == 200, res.data
    row = AuditLog.objects.get(resource="workflow.advance", resource_id=str(flow.pk))
    assert row.ip_address == "203.0.113.9" and row.ip_address != "10.0.0.2"


# ── 10. Who reviews after a finished ladder ────────────────────────────────────────────────────


def test_a_ladder_walked_by_the_original_judge_leaves_the_appeal_unclaimed(case):
    sp.walk_flow(case["judgment"])  # an appeal waits for the origin flow (review B)
    _upheld_once(case)
    appeal = JudgmentAppeal.all_objects.get(pk=_file(case, escalate=True).data["id"])
    flow = _drive(appeal.workflow, ["PASSED"] * 4, case["decider"])
    assert flow.status == ApprovalWorkflowStatus.COMPLETED
    appeal.refresh_from_db()
    assert appeal.reviewer_id is None and appeal.claimed_at is None


def test_the_final_station_of_a_ladder_cannot_be_escalated_past(case):
    """Escalation stops at the final review (user 2026-10-29, review A): escalating 终审 used to complete the ladder
    and settle the appeal on a decision nobody made."""
    from apps.workflow.models import EscalationRefusedError

    sp.walk_flow(case["judgment"])  # an appeal waits for the origin flow (review B)
    _upheld_once(case)
    appeal = JudgmentAppeal.all_objects.get(pk=_file(case, escalate=True).data["id"])
    _drive(appeal.workflow, ["PASSED"] * 3, case["reviewer"])
    escalator = sp.officer("ladder_escalator", "MODERATOR", case["judgment"].tenant)
    flow = ApprovalWorkflow.all_objects.get(pk=appeal.workflow_id)
    with pytest.raises(EscalationRefusedError):
        flow.escalate_current_node(user=escalator, reason="终审告假")
    flow.refresh_from_db()
    appeal.refresh_from_db()
    assert flow.status == ApprovalWorkflowStatus.IN_PROGRESS
    assert appeal.reviewer_id is None


# ── 12 / c. What a retrial carries ─────────────────────────────────────────────────────────────


def test_a_retrial_carries_the_offence_and_the_wangsi_columns_not_the_evidence(cn):
    soul, judgment = sp.open_case(cn)
    facts = {"offence": "MURDER", "untimely": True, "held_until": datetime.date(2030, 1, 1),
             "wrongful_death_cause": "ACCIDENT", "grievance_plea": "冤", "confession": "供述"}
    Judgment.all_objects.filter(pk=judgment.pk).update(**facts)
    judgment.refresh_from_db()
    retrial = weighing.open_retrial(judgment, reason="REJECTED", method=judgment.judgment_method)
    for field in ("offence", "untimely", "held_until", "wrongful_death_cause", "grievance_plea"):
        assert getattr(retrial, field) == facts[field], field
    assert retrial.confession == ""  # decided 2026-10-29 (review E / I): confessions and admissions do not follow


# ── 13. A timeout that cannot be applied fails once, and someone is told ───────────────────────


def test_a_failing_auto_reject_is_recorded_once_and_the_admins_are_told(
        cn, monkeypatch, django_capture_on_commit_callbacks):
    told = []
    monkeypatch.setattr("apps.events.services.EventService.notify_user",
                        staticmethod(lambda **kw: told.append((kw["user"].username, kw["params"]["kind"]))))

    def refuse(flow):
        raise weighing.WeighingRefusedError("no", "soul_cannot_reopen", status=409)

    monkeypatch.setattr(weighing, "reweigh_after_rejection", refuse)
    sp.officer("timeout_admin", "MODERATOR", cn)
    flow = _workflow(cn, [_node(1, timeout_hours=1, timeout_action="AUTO_REJECT"), _node(2)])
    _age(flow.current_node, 2)
    with django_capture_on_commit_callbacks(execute=True):
        assert timeouts.process_due()["failed"] == 1
    node = flow.nodes.get(node_order=1)
    assert node.status == NodeStatus.PENDING and node.timed_out_at is not None
    assert node.decision_history[-1]["event"] == "timeout_failed"
    assert node.decision_history[-1]["code"] == "soul_cannot_reopen"
    assert ("timeout_admin", "workflow_timeout_failed") in told
    assert "failed" not in timeouts.process_due()  # not retried every five minutes


# ── 14. A hook's business refusal is a 409 with its code; a defect stays a 500 ─────────────────


def test_a_hook_refusal_answers_409_and_a_defect_is_not_swallowed(cn, monkeypatch):
    flow = _three_stops(cn)
    judge = officer_client(sp.officer("hook_judge", "JUDGE", cn))

    def refuse(flow):
        raise weighing.WeighingRefusedError("no", "soul_cannot_reopen", status=409)

    monkeypatch.setattr(weighing, "reweigh_after_rejection", refuse)
    res = judge.post(f"/api/v1/workflows/{flow.pk}/approve_node/", {"verdict": "FAILED"}, format="json")
    assert (res.status_code, res.data["code"]) == (409, "soul_cannot_reopen"), res.data
    flow.refresh_from_db()
    assert flow.status == ApprovalWorkflowStatus.IN_PROGRESS  # rolled back whole

    def crash(flow):
        raise RuntimeError("a defect")

    monkeypatch.setattr(weighing, "reweigh_after_rejection", crash)
    with pytest.raises(RuntimeError):
        judge.post(f"/api/v1/workflows/{flow.pk}/approve_node/", {"verdict": "FAILED"}, format="json")


# ── 17. The hooks read the flow's new status ───────────────────────────────────────────────────


def test_the_finished_status_is_saved_before_the_hooks_run(cn, monkeypatch):
    from apps.workflow import segments

    seen = []
    real = segments.on_workflow_finished

    def spy(workflow, status, end_reason=""):
        seen.append(ApprovalWorkflow.all_objects.filter(pk=workflow.pk).values_list("status", flat=True).get())
        return real(workflow, status, end_reason)

    monkeypatch.setattr(segments, "on_workflow_finished", spy)
    flow = _workflow(cn, [_node(1)])
    assert flow.complete_node(flow.current_node_id, "PASSED")
    assert seen == [ApprovalWorkflowStatus.COMPLETED]


# ── 18 / 20. Dead code and unreachable states ──────────────────────────────────────────────────


def test_the_divergent_appeal_door_is_gone():
    assert not hasattr(WorkflowService, "create_appeal_workflow")


def test_the_status_filter_offers_only_reachable_states():
    offered = {value for value, _ in WorkflowFilter.base_filters["status"].extra["choices"]}
    assert offered == {"PENDING", "IN_PROGRESS", "COMPLETED", "REJECTED", "CANCELLED"}  # CANCELLED: review C


# ── 23. A timed-out countersign keeps the signatures already given ─────────────────────────────


def test_a_countersign_auto_reject_keeps_the_signed_slots(cn):
    judge = sp.officer("cs_judge", "JUDGE", cn)
    soul = Soul.objects.create(name="会签", tenant=cn, current_state=SoulState.JUDGING)
    flow = ApprovalWorkflow.objects.create(workflow_name="会签", soul=soul, tenant=cn,
                                           status=ApprovalWorkflowStatus.IN_PROGRESS)
    slot = {"approver_type": "ROLE", "approver_role": "JUDGE"}
    node = ApprovalNode.objects.create(
        workflow=flow, node_name="三人会签", node_order=1, node_type="TRIAL", status=NodeStatus.PENDING,
        kind=NodeKind.COUNTERSIGN, signers_json=[slot, slot, slot], threshold=2,
        timeout_hours=1, timeout_action="AUTO_REJECT", activated_at=timezone.now())
    flow.current_node = node
    flow.save()
    assert flow.complete_node(node.pk, "PASSED", user=judge)  # one approval of two needed
    _age(node, 2)
    assert timeouts.process_due()["AUTO_REJECT"] == 1
    node.refresh_from_db()
    assert node.status == NodeStatus.REJECTED
    signed = {s["signer"]: s for s in node.signatures_json}
    assert signed[0]["passed"] is True and signed[0]["user_id"] == judge.pk  # kept
    assert all(signed[i]["passed"] is False and signed[i]["timeout"] for i in (1, 2))


# ── h. An engine ending is not a refusal of the case ───────────────────────────────────────────


def test_a_branch_to_a_skipped_station_does_not_withdraw_the_conclusion(cn, monkeypatch):
    soul, judgment, disposition = _diyu_failed(cn)
    flow = _origin_flow(judgment)
    monkeypatch.setattr(ApprovalWorkflow, "_pass_successor", lambda self, node: BRANCH_SKIPPED)
    assert flow.complete_node(flow.current_node_id, "PASSED")
    flow.refresh_from_db()
    assert (flow.status, flow.end_reason) == (ApprovalWorkflowStatus.REJECTED, END_REASON_BRANCH_SKIPPED)
    assert not Disposition.all_objects.get(pk=disposition.pk).is_deleted
    assert not Judgment.objects.filter(retrial_of=judgment).exists()


# ── a / b / e. Acquittals and the plan ─────────────────────────────────────────────────────────


def _termed(cn, years=3):
    soul, judgment = sp.open_case(cn)
    judgment.conclude(Verdict.FAILED, "", term_years=years)
    sp.walk_flow(judgment)
    return soul, SentencePlan.all_objects.get(soul=soul), Disposition.all_objects.get(judgment=judgment)


@pytest.mark.parametrize("executed", [True, False])
def test_a_reopened_case_acquitted_takes_the_home_sentence_off(cn, executed):
    soul, plan, disposition = _termed(cn)
    if executed:
        assert DispositionService.execute(disposition) is True  # serving
    SentencePlan.all_objects.filter(pk=plan.pk).update(status="RETRIAL")
    reopened = Judgment.objects.create(soul=soul, tenant=cn, civilization=soul.civilization, court="重开审判",
                                       kind=JudgmentKind.REOPEN, amends_plan_id=plan.pk, verdict=Verdict.PASSED,
                                       is_final=True)
    with transaction.atomic():
        plan_requests.conclude_reopened(reopened)
    node = sp.node(plan, 1) if executed else plan.nodes.get(order=1)
    disposition = Disposition.all_objects.get(pk=disposition.pk)
    if executed:
        assert node.status == "COMPLETED" and disposition.expired_at is not None and not disposition.is_deleted
    else:
        assert node.status == "REMOVED" and disposition.is_deleted
    assert SoulEvent.objects.filter(soul=soul, event_type="SENTENCE_PLAN_AMENDED").exists()


def test_an_appeal_acquittal_waits_for_the_origin_flow_then_goes_to_rebirth(case):
    from tests.test_judgment_appeals import _claim_and_decide

    with _filed_before_rule_b(case):
        assert _file(case).status_code == 201
    response = _claim_and_decide(case, "AMENDED", verdict="PASSED")
    assert response.status_code == 200, response.data
    soul = Soul.objects.get(pk=case["soul"].pk)
    assert soul.current_state == SoulState.DISPOSED  # the origin flow is still running
    sp.walk_flow(case["judgment"])
    soul.refresh_from_db()
    assert soul.current_state == SoulState.REINCARNATING


def test_a_diyu_acquittal_records_that_rebirth_was_triggered(cn):
    soul, judgment = sp.open_case(cn)
    judgment.conclude(Verdict.PASSED, "")
    sp.walk_flow(judgment)
    soul.refresh_from_db()
    assert soul.current_state == SoulState.REINCARNATING
    event = SoulEvent.objects.get(soul=soul, event_type="REINCARNATION_TRIGGERED")
    assert event.payload["disposition_id"] is None


# ── f. release locks the soul first ────────────────────────────────────────────────────────────


def test_release_locks_the_soul_before_the_disposition(cn, monkeypatch):
    from apps.disposition import expiry

    _soul, _plan, disposition = _termed(cn)
    order = []
    real_lock, real_releasable = Soul.lock, expiry.releasable
    monkeypatch.setattr(Soul, "lock", lambda pk: (order.append("soul"), real_lock(pk))[1])
    monkeypatch.setattr(expiry, "releasable", lambda d: (order.append("disposition"), real_releasable(d))[1])
    mod = officer_client(sp.officer("release_mod", "MODERATOR", cn))
    mod.post(f"/api/v1/disposition/{disposition.pk}/release/")
    assert order[:2] == ["soul", "disposition"]


# ── g. A never-executed disposition stops a rebirth ────────────────────────────────────────────


def test_an_unexecuted_disposition_without_a_plan_stops_the_rebirth(cn):
    from apps.reincarnation.services import RebirthBlocked, assert_may_be_reborn

    soul, plan, disposition = _termed(cn)
    SentencePlan.all_objects.filter(pk=plan.pk).update(is_deleted=True)  # a soul with no plan to stop it
    with pytest.raises(RebirthBlocked) as blocked:
        assert_may_be_reborn(Soul.objects.get(pk=soul.pk))
    assert blocked.value.detail["code"] == "disposition_not_executed"
    Disposition.all_objects.filter(pk=disposition.pk).update(is_deleted=True)  # a void one is not owed
    assert_may_be_reborn(Soul.objects.get(pk=soul.pk))


# ── i. No city god: refused at issue ───────────────────────────────────────────────────────────


def test_a_warrant_is_refused_at_issue_when_no_city_god_can_take_the_case(cn):
    from apps.dispatch import capture
    from apps.dispatch.models import CaptureWarrant
    from apps.judgment.city_gods import NoCityGodError

    soul = Soul.objects.create(name="无城隍", tenant=cn, fated_death_year=2000, fated_death_month=1,
                               fated_death_day=1)
    with pytest.raises(NoCityGodError):
        capture.issue(soul)
    assert not CaptureWarrant.objects.filter(soul=soul).exists()
    lead = officer_client(sp.officer("cap_lead_ncg", "MODERATOR", cn))
    res = lead.post("/api/v1/dispatch/capture-warrants/", {"soul": str(soul.pk)}, format="json")
    assert (res.status_code, res.data.get("code")) == (409, "no_city_god"), res.data


# ── j. A new soul's civilization-only facts are checked on create ──────────────────────────────


@pytest.mark.parametrize("field, value", [
    ("duat_passage", "NAMELESS"), ("baptism", "BAPTISED"), ("neutral_in_life", True), ("ferry_passage", "UNBURIED"),
])
def test_creating_a_soul_with_another_civilizations_fact_is_refused(cn, field, value):
    admin = officer_client(sp.officer(f"create_{field}", "ADMIN", cn))
    res = admin.post("/api/v1/souls/", {"name": "新魂", field: value}, format="json")
    assert res.status_code == 400 and field in res.data, res.data


# ── k. The 土地公 list counts registrations in the query, not per row ───────────────────────────


def test_the_tudi_list_does_not_query_per_row(cn):
    from apps.death_sync.models import TudiGod

    admin = officer_client(sp.officer("tudi_lister", "ADMIN", cn))
    TudiGod.objects.create(tenant=cn, name="一号土地")

    def count():
        with CaptureQueriesContext(connection) as queries:
            assert admin.get("/api/v1/death-sync/tudi-gods/").status_code == 200
        return len(queries)

    count()  # warm the per-request caches (permissions), so the two measured calls differ only in rows
    one = count()
    for i in range(3):
        TudiGod.objects.create(tenant=cn, name=f"多号土地{i}")
    assert count() == one


def test_ladders_do_not_open_from_a_judgment(cn):
    """19: `create_from_judgment` no longer builds an APPEAL flow (covered over HTTP in
    tests/test_workflow_appeal_across_civilizations.py); the client cannot ask for one by case type either."""
    soul, judgment = sp.open_case(cn)
    Judgment.all_objects.filter(pk=judgment.pk).update(is_final=True, verdict=Verdict.FAILED)
    admin = officer_client(sp.officer("cfj_admin", "ADMIN", cn))
    for body in ({"is_appeal": True}, {"case_type": "APPEAL"}):
        res = admin.post("/api/v1/workflows/create_from_judgment/", {"judgment_id": str(judgment.pk), **body},
                         format="json")
        assert (res.status_code, res.data["code"]) == (400, "appeal_not_from_judgment"), res.data
