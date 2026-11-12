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
