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
