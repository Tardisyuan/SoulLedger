"""枉死城申诉的两处补完(2026-10-29):阳寿到期后仍挂着的 FILED 有出口;属实可选「超度」(docs/10 §4.2、§4.3、§6.2)。
规则在 `apps/judgment/wangsi.py`。"""
from datetime import date, timedelta

import pytest

from apps.disposition.models import Disposition
from apps.events.models import SoulEvent
from apps.judgment import wangsi
from apps.judgment.models import CityGod, GrievanceLevel, GrievanceStatus, Judgment
from apps.souls.models import Soul, SoulState
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _diyu_has_a_city_god(cn_tenant):
    """地府开案要有城隍收案(用户 2026-10-29):本殿先有一位兜底城隍。"""
    from tests.city_god_support import default_city_god

    default_city_god(cn_tenant)


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
    # 地府判无罪不发落、直接候转世(2026-10-29):免审结案、不走审批流,所以当场 REINCARNATING。
    assert soul.current_state == SoulState.REINCARNATING
    assert not Disposition.all_objects.filter(judgment_id=case.pk).exists()
    assert [e.payload["status"] for e in _events(soul, "WANGSI_GRIEVANCE_DELIVERED")] == ["DELIVERED"]
    assert not _events(soul, "WANGSI_GRIEVANCE_UPHELD")


def test_delivery_needs_upheld(cn_tenant, admin_user):
    _soul, case = _filed(cn_tenant, admin_user)
    with pytest.raises(wangsi.WangsiRefusedError) as refused:
        wangsi.decide_grievance(case.pk, admin_user, upheld=False, note="x", deliver=True)
    assert (refused.value.code, refused.value.status) == ("deliver_needs_upheld", 400)


@pytest.mark.parametrize("at_city_god", ["PENDING", "RETURNED"])
def test_delivery_sends_a_case_still_with_the_city_god_on_first(cn_tenant, admin_user, at_city_god):
    """用户 2026-10-29:城隍初审中的案子,超度时同一事务里先解送(CITY_GOD_SENT_ON 照记),再超度。
    此前是 409 `at_city_god`。"""
    soul, case = _filed(cn_tenant, admin_user)
    god = CityGod.objects.create(tenant=cn_tenant, name="杭州府城隍", regions=["杭州"])
    Judgment.all_objects.filter(pk=case.pk).update(city_god=god, city_god_status=at_city_god)
    wangsi.decide_grievance(case.pk, admin_user, upheld=True, note="属实", deliver=True)
    case = Judgment.all_objects.get(pk=case.pk)
    assert (case.city_god_status, case.sent_on_by_id) == ("SENT_ON", admin_user.pk)
    assert (case.grievance_status, case.verdict) == (GrievanceStatus.DELIVERED, "PASSED")
    assert _events(soul, "CITY_GOD_SENT_ON") and _events(soul, "WANGSI_GRIEVANCE_DELIVERED")


def test_a_refused_delivery_does_not_send_the_case_on(cn_tenant, admin_user):
    """超度被拒(等级不够)时什么都没写,解送也没有。"""
    _soul, case = _filed(cn_tenant, admin_user, level=GrievanceLevel.MINOR)
    god = CityGod.objects.create(tenant=cn_tenant, name="杭州府城隍", regions=["杭州"])
    Judgment.all_objects.filter(pk=case.pk).update(city_god=god, city_god_status="PENDING")
    with pytest.raises(wangsi.WangsiRefusedError):
        wangsi.decide_grievance(case.pk, admin_user, upheld=True, note="属实", deliver=True)
    assert Judgment.all_objects.get(pk=case.pk).city_god_status == "PENDING"


def test_the_decide_endpoint_takes_deliver(cn_tenant, admin_user):
    _soul, case = _filed(cn_tenant, admin_user)
    res = officer_client(admin_user).post(f"/api/v1/judgment/wangsi/{case.pk}/decide/",
                                          {"upheld": True, "note": "属实", "deliver": True}, format="json")
    assert res.status_code == 200, res.data
    assert (res.data["grievance_status"], res.data["verdict"]) == ("DELIVERED", "PASSED")


# ── PATCH 不覆盖并发的审核 ───────────────────────────────────────────────


def test_a_patch_loaded_before_a_decision_does_not_undo_it(cn_tenant, admin_user):
    """PATCH 只写它带的列:请求开始时读到的旧行不再把 grievance_status / held_until 写回去。"""
    from apps.judgment.serializers import JudgmentSerializer

    _soul, case = _filed(cn_tenant, admin_user)
    stale = Judgment.all_objects.get(pk=case.pk)  # PATCH 先读了这一行
    wangsi.decide_grievance(case.pk, admin_user, upheld=True, note="属实")  # 期间审核落定
    serializer = JudgmentSerializer(stale, data={"wrongful_death_cause": "VICTIM"}, partial=True)
    assert serializer.is_valid(), serializer.errors
    serializer.save()
    case = Judgment.all_objects.get(pk=case.pk)
    assert (case.grievance_status, case.held_until) == (GrievanceStatus.UPHELD, None)
    assert case.wrongful_death_cause == "VICTIM"
