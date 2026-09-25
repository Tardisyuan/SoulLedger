"""刑满暂留(WAITING)时灵魂留在那一站(产品负责人 2026-09-25)。

执行处置本来会关上服刑界域那一站(`DispositionService._leave_served_realm`)。节点因为
未结案审判进了 WAITING,灵魂人还在那里,所以那一站不关;放行时才关 —— 暂居地由
`end_residence`,原属地由 `SentencePlanService._step` 的 WAITING → COMPLETED。
"""
import pytest

from apps.disposition.models import Disposition
from apps.judgment.models import Judgment
from apps.realms.models import SoulPathEntry
from apps.souls.models import SoulState
from tests import sentence_plan_support as plan

pytestmark = pytest.mark.django_db


def _station(soul, disposition):
    """The soul's path entry at the disposition's realm (the latest one)."""
    return (
        SoulPathEntry.all_objects.filter(soul=soul, realm_id=disposition.destination_realm_id)
        .order_by("-sequence").first()
    )


def _open_case(soul, tenant):
    return Judgment.objects.create(soul=soul, tenant=tenant, civilization=soul.civilization)


def test_a_waiting_stop_abroad_keeps_the_soul_there_until_it_is_released():
    cn, eg = plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT")
    soul, p, _ = plan.at_stop(cn, eg)
    case = _open_case(soul, eg)

    assert plan.serve(soul, p, 2) is True
    stop = plan.node(p, 2)
    assert stop.status == "WAITING"
    disposition = Disposition.all_objects.get(pk=stop.disposition_id)
    entry = _station(soul, disposition)
    assert entry is not None and entry.left_at is None, "WAITING closed the station the soul is held at"

    case.delete_or_raise()
    soul.refresh_from_db()
    assert plan.node(p, 2).status == "COMPLETED" and soul.tenant_id == cn.pk
    entry.refresh_from_db()
    assert entry.left_at is not None


def test_a_served_stop_that_is_not_held_still_leaves_the_station():
    """The other direction: no open case → COMPLETED → the station closes at execution."""
    cn, eg = plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT")
    soul, p, _ = plan.at_stop(cn, eg)
    assert plan.serve(soul, p, 2) is True
    stop = plan.node(p, 2)
    assert stop.status == "COMPLETED"
    entry = _station(soul, Disposition.all_objects.get(pk=stop.disposition_id))
    assert entry is not None and entry.left_at is not None


def test_a_waiting_home_node_keeps_the_soul_there_until_it_is_released():
    cn = plan.tenant("CN_DIYU")
    plan.realm("DY_COURT_02_CHUJIANG", "CHINESE")  # where a FAILED soul with no record is sent
    soul, p = plan.planned(cn, verdict="FAILED")
    home = plan.node(p, 1)
    disposition = Disposition.all_objects.get(pk=home.disposition_id)
    assert disposition.destination_realm is not None and not disposition.is_eternal
    case = _open_case(soul, cn)

    assert plan.serve(soul, p, 1) is True
    assert plan.node(p, 1).status == "WAITING"
    entry = _station(soul, disposition)
    assert entry is not None and entry.left_at is None, "WAITING closed the station the soul is held at"

    case.delete_or_raise()
    soul.refresh_from_db()
    assert plan.node(p, 1).status == "COMPLETED"
    assert soul.current_state == SoulState.REINCARNATING
    entry.refresh_from_db()
    assert entry.left_at is not None, "releasing the WAITING home node left the soul at the station"
