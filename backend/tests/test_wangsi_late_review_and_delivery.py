"""枉死城申诉的两处补完(2026-10-29):阳寿到期后仍挂着的 FILED 有出口;属实可选「超度」(docs/10 §4.2、§4.3、§6.2)。
规则在 `apps/judgment/wangsi.py`。"""
from datetime import date, timedelta

import pytest

from apps.events.models import SoulEvent
from apps.judgment import wangsi
from apps.judgment.models import CityGod, GrievanceLevel, GrievanceStatus, Judgment
from apps.souls.models import Soul, SoulState
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db


def _filed(tenant, admin, *, level=GrievanceLevel.SEVERE, fated_in=400):
    fated = date.today() + timedelta(days=fated_in)
    soul = Soul.objects.create(name="枉死", tenant=tenant, fated_death_year=fated.year,
                               fated_death_month=fated.month, fated_death_day=fated.day)
    case = soul.die(death_date=date.today())
    assert case.untimely
    Judgment.all_objects.filter(pk=case.pk).update(grievance_level=level)
    wangsi.file_grievance(case.pk, admin, "为人所害")
    return soul, case


def _expire(case):
    Judgment.all_objects.filter(pk=case.pk).update(held_until=date.today() - timedelta(days=1))


def _events(soul, event_type):
    return list(SoulEvent.objects.filter(soul=soul, event_type=event_type))


# ── 到期后仍可审,只记结论 ──────────────────────────────────────────────


def test_a_grievance_still_filed_when_the_fated_day_comes_can_still_be_decided(cn_tenant, admin_user):
    soul, case = _filed(cn_tenant, admin_user, level=GrievanceLevel.MINOR)  # 等级不够提前释放,也可以记属实
    _expire(case)
    wangsi.decide_grievance(case.pk, admin_user, upheld=True, note="查实")
    case = Judgment.all_objects.get(pk=case.pk)
    assert case.grievance_status == GrievanceStatus.UPHELD_LATE
    assert case.held_until == date.today() - timedelta(days=1)  # 没有「提前释放」这一步
    assert [e.payload["status"] for e in _events(soul, "WANGSI_GRIEVANCE_UPHELD")] == ["UPHELD_LATE"]


def test_a_late_rejection_is_recorded_too(cn_tenant, admin_user):
    _soul, case = _filed(cn_tenant, admin_user)
    _expire(case)
    wangsi.decide_grievance(case.pk, admin_user, upheld=False, note="不属实")
    assert Judgment.all_objects.get(pk=case.pk).grievance_status == GrievanceStatus.REJECTED


def test_a_concluded_case_can_still_be_decided_but_not_delivered(cn_tenant, admin_user):
    _soul, case = _filed(cn_tenant, admin_user)
    _expire(case)
    Judgment.all_objects.filter(pk=case.pk).update(verdict="PASSED", is_final=True)
    with pytest.raises(wangsi.WangsiRefusedError) as refused:
        wangsi.decide_grievance(case.pk, admin_user, upheld=True, note="查实", deliver=True)
    assert refused.value.code == "not_in_wangsi"
    wangsi.decide_grievance(case.pk, admin_user, upheld=True, note="查实")
    assert Judgment.all_objects.get(pk=case.pk).grievance_status == GrievanceStatus.UPHELD_LATE


def test_still_held_the_level_rule_stands(cn_tenant, admin_user):
    _soul, case = _filed(cn_tenant, admin_user, level=GrievanceLevel.MINOR)
    for deliver in (False, True):
        with pytest.raises(wangsi.WangsiRefusedError) as refused:
            wangsi.decide_grievance(case.pk, admin_user, upheld=True, note="查实", deliver=deliver)
        assert refused.value.code == "grievance_not_major"
    assert Judgment.all_objects.get(pk=case.pk).grievance_status == GrievanceStatus.FILED


def test_an_archived_case_takes_no_grievance(cn_tenant, admin_user):
    soul = Soul.objects.create(name="枉死", tenant=cn_tenant, fated_death_year=date.today().year + 2,
                               fated_death_month=1, fated_death_day=1)
    case = soul.die(death_date=date.today())
    Judgment.all_objects.filter(pk=case.pk).update(is_archived=True)
    assert wangsi.filing_refusal(Judgment.all_objects.get(pk=case.pk)).code == "not_pending"


# ── 超度 ────────────────────────────────────────────────────────────────


def test_delivery_takes_the_soul_to_the_lotus_terrace_and_concludes_without_a_hearing(cn_tenant, admin_user):
    soul, case = _filed(cn_tenant, admin_user)
    wangsi.decide_grievance(case.pk, admin_user, upheld=True, note="属实", deliver=True)
    case = Judgment.all_objects.get(pk=case.pk)
    soul = Soul.objects.get(pk=soul.pk)
    assert case.grievance_status == GrievanceStatus.DELIVERED and case.held_until is None
    assert (case.verdict, case.is_final) == ("PASSED", True)
    assert soul.diyu_station == Soul.DiyuStation.LOTUS_TERRACE
    assert soul.current_state != SoulState.JUDGING
    assert [e.payload["status"] for e in _events(soul, "WANGSI_GRIEVANCE_DELIVERED")] == ["DELIVERED"]
    assert not _events(soul, "WANGSI_GRIEVANCE_UPHELD")


def test_delivery_needs_upheld_and_a_case_sent_on_by_the_city_god(cn_tenant, admin_user):
    _soul, case = _filed(cn_tenant, admin_user)
    with pytest.raises(wangsi.WangsiRefusedError) as refused:
        wangsi.decide_grievance(case.pk, admin_user, upheld=False, note="x", deliver=True)
    assert (refused.value.code, refused.value.status) == ("deliver_needs_upheld", 400)

    god = CityGod.objects.create(tenant=cn_tenant, name="杭州府城隍", regions=["杭州"])
    Judgment.all_objects.filter(pk=case.pk).update(city_god=god, city_god_status="PENDING")
    with pytest.raises(wangsi.WangsiRefusedError) as refused:
        wangsi.decide_grievance(case.pk, admin_user, upheld=True, note="属实", deliver=True)
    assert refused.value.code == "at_city_god"
    case = Judgment.all_objects.get(pk=case.pk)
    assert (case.grievance_status, case.verdict) == (GrievanceStatus.FILED, None)


def test_the_decide_endpoint_takes_deliver(cn_tenant, admin_user):
    _soul, case = _filed(cn_tenant, admin_user)
    res = officer_client(admin_user).post(f"/api/v1/judgment/wangsi/{case.pk}/decide/",
                                          {"upheld": True, "note": "属实", "deliver": True}, format="json")
    assert res.status_code == 200, res.data
    assert (res.data["grievance_status"], res.data["verdict"]) == ("DELIVERED", "PASSED")
