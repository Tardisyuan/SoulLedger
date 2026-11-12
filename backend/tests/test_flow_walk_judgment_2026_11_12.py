"""Flow walk 2026-11-12, the judgment module (F-JUDG-0x; F-DEATH-02 = F-JUDG-04).

Each test is red on the defect it names: the write the walk found going through is now refused, and the write next
to it still goes through.
"""
import pytest

from apps.judgment.models import Judgment
from apps.souls.models import Soul, SoulState
from apps.workflow.models import ApprovalWorkflow
from tests import sentence_plan_support as plan
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db


@pytest.fixture
def cn():
    return plan.tenant("CN_DIYU")


@pytest.fixture
def lead(cn):
    return plan.officer("fw_lead", "ADMIN", cn)


def _concluded_flow(cn, name="客魂"):
    soul, case = plan.open_case(cn, name=name)
    case.conclude("FAILED", "")
    return soul, case, ApprovalWorkflow.objects.get(judgment=case)


# ── F-JUDG-02 reopen-cancelled is done once ──────────────────────────────────


def test_reopen_cancelled_does_not_reopen_a_case_already_heard_again(cn, lead):
    soul, case, flow = _concluded_flow(cn)
    ApprovalWorkflow.objects.filter(pk=flow.pk).update(status="CANCELLED", current_node=None,
                                                       end_reason="CROSS_CANCELLED")
    client = officer_client(lead)
    url = f"/api/v1/judgment/{case.pk}/reopen-cancelled/"
    first = client.post(url)
    assert first.status_code == 201, first.data
    # The retrial concluded and placed the soul (the walk's step 3): the soul is DISPOSED again, by the retrial.
    Soul.all_objects.filter(pk=soul.pk).update(current_state=SoulState.DISPOSED)

    again = client.post(url)
    assert again.status_code == 409, again.data
    assert Judgment.all_objects.filter(retrial_of=case).count() == 1
    soul.refresh_from_db()
    assert soul.current_state == SoulState.DISPOSED
    # And the page stops drawing the button.
    assert client.get(f"/api/v1/judgment/{case.pk}/").data["flow_cancelled"] is False


# ── F-JUDG-03 a hand-started flow does not take an open case's place ────────


def test_a_flow_started_by_hand_cannot_take_an_open_case(cn, lead):
    soul, case = plan.open_case(cn)
    res = officer_client(lead).post("/api/v1/workflows/start/", {
        "soul": str(soul.pk), "judgment": str(case.pk), "case_type": "SPECIAL", "reason": "复查"}, format="json")
    assert res.status_code == 409 and res.data["code"] == "judgment_not_concluded", res.data
    assert not ApprovalWorkflow.all_objects.filter(judgment=case).exists()
    # The place stays free for the flow the conclusion builds.
    case.conclude("FAILED", "")
    assert ApprovalWorkflow.all_objects.get(judgment=case).manually_started is False


def test_concluding_a_case_a_hand_started_flow_already_holds_is_a_409_not_a_500(cn):
    from apps.judgment.weighing import WeighingRefusedError

    soul, case = plan.open_case(cn)
    # A row from before `start` refused open cases.
    ApprovalWorkflow.objects.create(tenant=cn, soul=soul, judgment=case, workflow_name="手动", manually_started=True)
    with pytest.raises(WeighingRefusedError) as refused:
        case.conclude("FAILED", "")
    assert (refused.value.code, refused.value.status) == ("judgment_has_workflow", 409)
    case.refresh_from_db()
    assert not case.is_final and case.verdict is None


# ── F-JUDG-04 / F-DEATH-02 withdrawing a case does not skip its stations ─────


def test_a_case_opened_again_after_a_withdrawal_stands_where_the_withdrawn_one_stood(cn):
    from datetime import timedelta

    from django.utils import timezone

    from apps.judgment.services import JudgmentService

    soul, case = plan.open_case(cn)
    until = timezone.now().date() + timedelta(days=30)
    # Held in 枉死城 until the fated date, as `Soul.die` opens an untimely death.
    Judgment.all_objects.filter(pk=case.pk).update(untimely=True, held_until=until, wrongful_death_cause="ACCIDENT")
    case.refresh_from_db()
    case.delete_or_raise(reason="撤案")

    again = JudgmentService.open_case(soul, actor=plan.officer("fw_judge", "JUDGE", cn))
    assert (again.untimely, again.held_until, again.wrongful_death_cause) == (True, until, "ACCIDENT")
    assert again.pk != case.pk and again.verdict is None


def test_a_soul_with_no_withdrawn_case_opens_a_plain_one(cn):
    from apps.judgment.services import JudgmentService

    soul = Soul.objects.create(name="无撤案", tenant=cn, current_state=SoulState.JUDGING)
    opened = JudgmentService.open_case(soul, actor=plan.officer("fw_judge2", "JUDGE", cn))
    assert (opened.untimely, opened.held_until, opened.city_god_id) == (False, None, None)


# ── F-JUDG-01 a conclusion being heard again is not appealed ─────────────────

MINE = "/api/v1/me/judgment-appeals/"


def test_a_retry_verdict_cannot_be_appealed(cn):
    from apps.judgment.services import JudgmentConclusionService
    from tests.soul_account_support import ready_soul

    account, client = ready_soul(cn)
    case = Judgment.objects.create(soul=account.soul, civilization=account.soul.civilization, court="第一殿",
                                   tenant=cn)
    JudgmentConclusionService.conclude_judgment(case, "RETRY", "再审")
    res = client.post(MINE, {"judgment": str(case.pk), "reason": "冤"}, format="json")
    assert res.data.get("code") == "not_appealable", res.data
    assert not case.appeals.exists()


def test_a_case_withdrawn_and_heard_again_cannot_be_appealed(cn):
    from apps.judgment.services import JudgmentConclusionService
    from tests.soul_account_support import ready_soul

    account, client = ready_soul(cn, name="亡魂乙")
    case = Judgment.objects.create(soul=account.soul, civilization=account.soul.civilization, court="第一殿",
                                   tenant=cn)
    JudgmentConclusionService.conclude_judgment(case, "FAILED", "原判")
    plan.walk_flow(case)
    row = next(r for r in client.get(MINE).data["judgments"] if str(r["judgment_id"]) == str(case.pk))
    assert (row["can_appeal"], row["refusal_code"]) == (True, None)

    # The conclusion was withdrawn and a new case opened to hear it again (`reweigh_after_rejection`).
    Judgment.objects.create(soul=account.soul, civilization=case.civilization, court="第一殿", tenant=cn,
                            retrial_of=case)
    row = next(r for r in client.get(MINE).data["judgments"] if str(r["judgment_id"]) == str(case.pk))
    assert (row["can_appeal"], row["refusal_code"]) == (False, "not_appealable")
    res = client.post(MINE, {"judgment": str(case.pk), "reason": "冤"}, format="json")
    assert res.data.get("code") == "not_appealable", res.data


# ── F-JUDG-13 concluding on an article retired since it was cited ───────────


def test_concluding_on_an_article_retired_since_it_was_cited_is_refused_naming_it(cn):
    from apps.judgment.services import CitationRefusedError, StatuteCitationService
    from tests.test_judgment_statutes import make_statute

    _soul, case = plan.open_case(cn)
    kept = make_statute(cn, "FW13-KEPT", ordinal=1)
    gone = make_statute(cn, "FW13-GONE", ordinal=2)
    StatuteCitationService.cite(case, kept.id)
    StatuteCitationService.cite(case, gone.id)
    gone.soft_delete(reason="废止")

    with pytest.raises(CitationRefusedError) as refused:
        case.conclude("FAILED", "")
    assert (refused.value.code, refused.value.status) == ("statute_retired", 409)
    assert refused.value.extra["statutes"] == [{"id": str(gone.pk), "code": "FW13-GONE"}]
    case.refresh_from_db()
    assert case.verdict is None and not case.is_final

    # The officer takes the retired article off and concludes on the current one.
    assert StatuteCitationService.uncite(case, gone.id) is True
    assert case.conclude("FAILED", "")
    case.refresh_from_db()
    assert case.is_final and list(case.citations.values_list("statute__code", flat=True)) == ["FW13-KEPT"]


# ── F-JUDG-14 a timeout does not refuse a judgment's flow ────────────────────


def test_an_auto_reject_timeout_on_a_judgments_flow_escalates_and_withdraws_nothing(
        cn, monkeypatch, django_capture_on_commit_callbacks):
    from apps.workflow import timeouts
    from apps.workflow.models import ApprovalWorkflowStatus, NodeStatus
    from tests.test_workflow_timeout_and_reject_to import _age, _node, _workflow

    told = []
    monkeypatch.setattr("apps.events.services.EventService.notify_user",
                        staticmethod(lambda **kw: told.append(kw["user"].username)))
    plan.officer("fw14_admin", "ADMIN", cn)
    flow = _workflow(cn, [_node(1, timeout_hours=1, timeout_action="AUTO_REJECT"), _node(2)])
    assert flow.decides_judgment
    _age(flow.current_node, 2)

    with django_capture_on_commit_callbacks(execute=True):
        counts = timeouts.process_due()
    assert (counts["ESCALATE"], counts["AUTO_REJECT"]) == (1, 0), counts
    flow.refresh_from_db()
    assert flow.status == ApprovalWorkflowStatus.IN_PROGRESS
    node = flow.nodes.get(node_order=1)
    assert node.status == NodeStatus.PENDING and (node.approver_type, node.approver_role) == ("ROLE", "ADMIN")
    assert node.decision_history[-1]["instead_of"] == "AUTO_REJECT"
    assert "fw14_admin" in told
    assert not Judgment.objects.filter(retrial_of_id=flow.judgment_id).exists()
    assert Judgment.all_objects.get(pk=flow.judgment_id).is_final
