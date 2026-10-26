"""The Egyptian verdict is the scale's (docs/02 §3, §5; 01 §3.3; user decisions 2026-10-27).

- every Egyptian case is weighed, hand-opened ones too (no STANDARD net-merit ≥ 50 rule);
- the officer cannot declare a verdict the scale did not give — devoured only when the heart is heavier;
- the weighing is frozen on the judgment (Thoth records it);
- a wavering scale (PURGATORY / RETRY) opens a new weighing: no disposition, the soul stays under judgment.
"""
import pytest

from apps.disposition.models import Disposition
from apps.judgment.models import Judgment, JudgmentMethod, WeighingResult
from apps.judgment.weighing import WeighingRefusedError
from apps.realms.models import Realm
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import SoulRecord
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db


@pytest.fixture
def eg_tenant():
    tenant = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "Duat"})[0]
    for code in ("EG_AARU", "EG_ANNIHILATION", "EG_DUAT_ENTRY"):
        Realm.objects.create(realm_code=code, civilization="EGYPTIAN", name_local=code, name_zh=code,
                             realm_type="HEAVEN", tenant=tenant)
    return tenant


def _case(tenant, merit=0, demerit=0):
    soul = Soul.objects.create(name="Weighed", tenant=tenant, current_state=SoulState.JUDGING, death_year=2000)
    for record_type, weight in (("MERIT", merit), ("DEMERIT", demerit)):
        if weight:
            SoulRecord.objects.create(soul=soul, record_type=record_type, description=record_type,
                                      weight=weight, event_year=2000, tenant=tenant)
    # Opened by hand: no judgment_method given.
    return Judgment.objects.create(soul=soul, civilization=soul.civilization, court="两真之殿", tenant=tenant)


def test_a_hand_opened_egyptian_case_is_weighed(eg_tenant):
    assert _case(eg_tenant).judgment_method == JudgmentMethod.HEART_WEIGHING


def test_the_officer_cannot_send_a_light_heart_to_ammit(eg_tenant):
    case = _case(eg_tenant)
    with pytest.raises(WeighingRefusedError) as refused:
        case.conclude("FAILED")
    assert refused.value.code == "verdict_contradicts_weighing"
    assert refused.value.extra["weighed_verdict"] == "PASSED"
    case.refresh_from_db()
    assert case.verdict is None and not Disposition.objects.filter(judgment=case).exists()


def test_a_heavy_heart_is_devoured_and_the_weighing_is_recorded(eg_tenant):
    case = _case(eg_tenant, demerit=5)
    with pytest.raises(WeighingRefusedError):
        case.conclude("PASSED")
    case.conclude("FAILED")
    case.refresh_from_db()
    assert (case.weighing_result, case.heart_weight) == (WeighingResult.HEAVIER, 5)
    assert Disposition.objects.get(judgment=case).destination_realm.realm_code == "EG_ANNIHILATION"


def test_good_deeds_lighten_the_heart_on_the_scale(eg_tenant):
    case = _case(eg_tenant, merit=5, demerit=5)
    case.conclude("PASSED")
    case.refresh_from_db()
    assert (case.weighing_result, case.heart_weight) == (WeighingResult.LIGHTER, 0)
    assert Disposition.objects.get(judgment=case).destination_realm.realm_code == "EG_AARU"


def test_net_merit_no_longer_decides_an_egyptian_case(eg_tenant):
    """The old STANDARD branch sent PURGATORY with karma ≥ 50 to Aaru."""
    case = _case(eg_tenant, merit=60)
    case.conclude("PURGATORY")
    assert not Disposition.objects.filter(judgment=case).exists()


def test_a_wavering_scale_is_weighed_again(eg_tenant):
    case = _case(eg_tenant, demerit=5)
    case.conclude("PURGATORY")
    case.refresh_from_db()
    assert case.weighing_result == WeighingResult.WAVERING
    assert not Disposition.objects.filter(judgment=case).exists()
    soul = Soul.objects.get(pk=case.soul_id)
    assert soul.current_state == SoulState.JUDGING
    retrial = Judgment.objects.get(retrial_of=case)
    assert retrial.verdict is None and retrial.judgment_method == JudgmentMethod.HEART_WEIGHING
    assert soul.events.filter(event_type="JUDGMENT_INITIATED").exists()


def test_a_wavering_scale_takes_no_destination(eg_tenant):
    case = _case(eg_tenant)
    with pytest.raises(WeighingRefusedError) as refused:
        case.conclude("PURGATORY", term_years=3)
    assert refused.value.code == "wavering_has_no_destination"
    assert not Judgment.objects.filter(retrial_of=case).exists()


# ── The weighing flow: Thoth, the tribunal, Horus, Osiris — Ammit only on the heavy branch (02 §2.1, §5) ──

def _walk(flow):
    """Pass every station the flow stops at; return the flow and the names it stopped at."""
    from apps.workflow.models import ApprovalWorkflow

    stops = []
    while True:
        flow = ApprovalWorkflow.objects.get(pk=flow.pk)
        node = flow.current_node
        if node is None:
            return flow, stops
        stops.append(node.node_name)
        assert flow.complete_node(node.pk, "PASSED")


def test_a_light_heart_walks_the_pass_branch_and_executes_only_after(eg_tenant):
    from apps.disposition.services import DispositionService
    from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus

    case = _case(eg_tenant)
    case.conclude("PASSED")
    disposition = Disposition.objects.get(judgment=case)
    assert DispositionService.execute(disposition) is False  # the flow has not run yet
    flow, stops = _walk(ApprovalWorkflow.objects.get(judgment=case))
    assert flow.status == ApprovalWorkflowStatus.COMPLETED
    assert stops == ["阿努比斯 · 引导与称量", "四十二神官 · 否定告白", "神庭 · 确认", "荷鲁斯 · 引导", "欧西里斯 · 终审"]
    assert DispositionService.execute(Disposition.objects.get(pk=disposition.pk)) is True


def test_a_heavy_heart_goes_to_ammit_and_skips_the_tribunal(eg_tenant):
    from apps.workflow.models import ApprovalWorkflow, NodeStatus

    case = _case(eg_tenant, demerit=5)
    case.conclude("FAILED")
    flow, stops = _walk(ApprovalWorkflow.objects.get(judgment=case))
    assert stops == ["阿努比斯 · 引导与称量", "四十二神官 · 否定告白", "阿米特 · 吞噬"]
    skipped = set(flow.nodes.filter(status=NodeStatus.SKIPPED).values_list("node_name", flat=True))
    assert {"神庭 · 确认", "荷鲁斯 · 引导", "欧西里斯 · 终审"} <= skipped


def test_an_egyptian_case_cannot_be_concluded_without_the_weighing_flow(eg_tenant):
    case = _case(eg_tenant)
    with pytest.raises(WeighingRefusedError) as refused:
        case.conclude("PASSED", create_workflow=False)
    assert refused.value.code == "weighing_flow_required"


def test_a_disposition_parked_at_the_duat_entry_does_not_execute_into_settled(eg_tenant):
    """Written before the wavering rule: an undecided verdict parked at EG_DUAT_ENTRY (02 §5.3)."""
    from apps.disposition.services import DispositionService
    from apps.judgment.weighing import unfinished_flow

    case = _case(eg_tenant)
    Judgment.all_objects.filter(pk=case.pk).update(verdict="PURGATORY", is_final=True)
    case.refresh_from_db()
    disposition = DispositionService.create_from_judgment(case)
    assert disposition.destination_realm.realm_code == "EG_DUAT_ENTRY"
    assert unfinished_flow(disposition) == "weighing_wavers"
    assert DispositionService.execute(disposition) is False
    assert Soul.objects.get(pk=case.soul_id).current_state != SoulState.SETTLED


def test_neither_egyptian_outcome_takes_a_term(eg_tenant):
    """02 §5.2 / 03 §五: the second death is not served; nor is the Field of Reeds."""
    from apps.disposition.destination import DestinationRefusedError

    for verdict, demerit in (("PASSED", 0), ("FAILED", 5)):
        case = _case(eg_tenant, demerit=demerit)
        with pytest.raises(DestinationRefusedError) as refused:
            case.conclude(verdict, term_years=3)
        assert refused.value.code == "term_not_applicable"
