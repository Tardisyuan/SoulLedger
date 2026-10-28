"""地府四项(2026-10-28):十三站与亡魂位置(docs/06)、勾魂(01 §二 第五层、02)、土地公登记(08 §五/§七)、
四大部洲(07 §人道)。规则分别在 apps/souls/stations.py、apps/dispatch/capture.py、apps/death_sync/tudi_views.py、
apps/reincarnation/services.py::assert_continent_applies。"""
from datetime import date

import pytest

from apps.death_sync.models import DeathRegistrationRequest, TudiGod
from apps.dispatch import capture
from apps.dispatch.models import CaptureWarrant
from apps.events.models import SoulEvent
from apps.judgment.models import CityGod, Judgment
from apps.reincarnation.services import RebirthContinentNotApplicable, ReincarnationService, drink_soup
from apps.souls import stations
from apps.souls.models import Soul, SoulState
from tests import sentence_plan_support as sp
from tests.soul_account_support import officer_client, ready_soul

pytestmark = pytest.mark.django_db

WARRANTS = "/api/v1/dispatch/capture-warrants/"
TUDI = "/api/v1/death-sync/tudi-gods/"


def _due(tenant, name="阳寿尽", **fields):
    return Soul.objects.create(name=name, tenant=tenant, fated_death_year=2000, fated_death_month=1,
                               fated_death_day=1, **fields)


def _events(soul, event_type):
    return list(SoulEvent.objects.filter(soul=soul, event_type=event_type).order_by("create_time", "id"))


# ── 十三站 ──────────────────────────────────────────────────────────────


def test_death_puts_a_diyu_soul_at_the_earth_god_temple_and_no_one_else(cn_tenant, eu_tenant):
    cn = Soul.objects.create(name="甲", tenant=cn_tenant)
    cn.die()
    cn.refresh_from_db()
    assert cn.diyu_station == "TUDI_TEMPLE"
    assert [e.payload for e in _events(cn, "DIYU_STATION_CHANGED")] == [
        {"from": "", "to": "TUDI_TEMPLE", "via": "death", "soul_id": str(cn.id)}]
    eu = Soul.objects.create(name="乙", tenant=eu_tenant)
    eu.die()
    eu.refresh_from_db()
    assert eu.diyu_station == "" and not _events(eu, "DIYU_STATION_CHANGED")


def test_automatic_moves_only_go_forward_and_officer_moves_go_anywhere(cn_tenant):
    soul = Soul.objects.create(name="丙", tenant=cn_tenant)
    soul.die()
    lead = sp.officer("st_lead", "MODERATOR", cn_tenant)
    stations.move(soul, "EIGHTEEN_HELLS", lead)
    # 进殿(酆都城,第十站)在十八层地狱(第十一站)之后到来:不往回拉。
    assert not stations.arrive(soul, Soul.DiyuStation.FENGDU_CITY, via="court")
    assert Soul.objects.get(pk=soul.pk).diyu_station == "EIGHTEEN_HELLS"
    stations.move(soul, "WANGXIANG_TERRACE", lead)
    assert Soul.objects.get(pk=soul.pk).diyu_station == "WANGXIANG_TERRACE"
    assert _events(soul, "DIYU_STATION_CHANGED")[-1].payload == {
        "from": "EIGHTEEN_HELLS", "to": "WANGXIANG_TERRACE", "via": "officer", "soul_id": str(soul.id)}


def test_the_station_endpoint_refuses_the_living_and_other_civilizations(cn_tenant, eu_tenant):
    lead = sp.officer("st_api", "MODERATOR", cn_tenant)
    client = officer_client(lead)
    alive = Soul.objects.create(name="丁", tenant=cn_tenant)
    res = client.post(f"/api/v1/souls/{alive.pk}/station/", {"station": "YELLOW_SPRINGS_ROAD"}, format="json")
    assert (res.status_code, res.data["code"]) == (409, "alive")
    alive.die()
    res = client.post(f"/api/v1/souls/{alive.pk}/station/", {"station": "YELLOW_SPRINGS_ROAD"}, format="json")
    assert res.status_code == 200 and res.data["diyu_station"] == "YELLOW_SPRINGS_ROAD"
    res = client.post(f"/api/v1/souls/{alive.pk}/station/", {"station": "NOWHERE"}, format="json")
    assert res.status_code == 400
    eu = Soul.objects.create(name="戊", tenant=eu_tenant)
    eu.die()
    with pytest.raises(stations.StationRefusedError) as exc:
        stations.move(eu, "YELLOW_SPRINGS_ROAD", lead)
    assert exc.value.code == "not_diyu"


def test_entering_a_court_is_arriving_at_fengdu(cn_tenant):
    from apps.realms.path import SoulPathService

    soul = Soul.objects.create(name="己", tenant=cn_tenant)
    soul.die()
    from apps.realms.models import Realm

    court = Realm.objects.create(realm_code="DY_COURT_01_QINGUANG", civilization="CHINESE", name_local="第一殿",
                                 realm_type="HELL", tenant=cn_tenant)
    SoulPathService.enter(soul, court, tenant_id=cn_tenant.pk)
    assert Soul.objects.get(pk=soul.pk).diyu_station == "FENGDU_CITY"


def test_the_soup_is_the_last_station_and_rebirth_leaves_the_road(cn_tenant):
    soul = Soul.objects.create(name="庚", tenant=cn_tenant, current_state=SoulState.REINCARNATING)
    drink_soup(soul)
    assert Soul.objects.get(pk=soul.pk).diyu_station == "HUANHUN_CLIFF"
    ReincarnationService.complete_rebirth(soul=Soul.objects.get(pk=soul.pk), rebirth_continent="DONGSHENG")
    reborn = Soul.objects.get(pk=soul.pk)
    assert reborn.diyu_station == "" and reborn.birth_continent == "DONGSHENG"
    assert reborn.reincarnations.get().rebirth_continent == "DONGSHENG"


def test_the_soul_app_sees_its_own_station_and_continent(cn_tenant):
    account, client = ready_soul(cn_tenant, birth_continent="NANZHAN")
    stations.arrive(account.soul, Soul.DiyuStation.MIHUN_HALL, via="officer", forward_only=False)
    me = client.get("/api/v1/me/").data
    assert (me["diyu_station"], me["birth_continent"]) == ("MIHUN_HALL", "NANZHAN")


# ── 四大部洲 ────────────────────────────────────────────────────────────


def test_only_a_diyu_human_rebirth_takes_a_continent(cn_tenant, eu_tenant):
    soul = Soul.objects.create(name="辛", tenant=cn_tenant, current_state=SoulState.REINCARNATING)
    with pytest.raises(RebirthContinentNotApplicable):
        ReincarnationService.complete_rebirth(soul=soul, rebirth_form="ANIMAL", rebirth_continent="XINIU")
    assert Soul.objects.get(pk=soul.pk).current_state == SoulState.REINCARNATING


def test_birth_continent_is_recorded_only_for_diyu(cn_tenant, eu_tenant):
    lead = sp.officer("cont_lead", "MODERATOR", cn_tenant)
    soul = Soul.objects.create(name="壬", tenant=cn_tenant)
    res = officer_client(lead).patch(f"/api/v1/souls/{soul.pk}/", {"birth_continent": "BEIJULU"}, format="json")
    assert res.status_code == 200 and res.data["birth_continent"] == "BEIJULU"
    eu_lead = sp.officer("cont_eu", "MODERATOR", eu_tenant)
    eu = Soul.objects.create(name="癸", tenant=eu_tenant)
    res = officer_client(eu_lead).patch(f"/api/v1/souls/{eu.pk}/", {"birth_continent": "BEIJULU"}, format="json")
    assert res.status_code == 400 and "birth_continent" in res.data
    assert Soul.objects.get(pk=eu.pk).birth_continent == ""


# ── 勾魂 ────────────────────────────────────────────────────────────────


def test_issue_capture_hand_over_registers_the_death_with_the_city_god(cn_tenant):
    god = CityGod.objects.create(tenant=cn_tenant, name="杭州府城隍", regions=["杭州"])
    soul = _due(cn_tenant, origin_location="杭州")
    warrant = capture.issue(soul)
    assert (warrant.status, warrant.escort, warrant.city_god) == ("ISSUED", "WUCHANG", god)
    capture.capture(warrant.pk)
    warrant = capture.hand_over(warrant.pk)
    soul.refresh_from_db()
    assert warrant.status == "HANDED_OVER" and soul.current_state == SoulState.JUDGING
    assert warrant.judgment.city_god == god and warrant.judgment.city_god_status == "PENDING"
    assert soul.diyu_station == "TUDI_TEMPLE"
    assert [len(_events(soul, t)) for t in ("CAPTURE_WARRANT_ISSUED", "SOUL_CAPTURED", "CAPTURE_HANDED_OVER")] \
        == [1, 1, 1]


@pytest.mark.parametrize("merit, demerit, escort", [
    (0, 1, "NIUTOU_MAMIAN"),   # 过多于功,哪怕只多一分(用户 2026-10-29 定,与 `escort_hint` 同一句话)
    (0, 600, "NIUTOU_MAMIAN"),
    (5, 5, "WUCHANG"),         # 功过相抵:不是「过多于功」
    (10, 0, "WUCHANG"),
])
def test_more_demerit_than_merit_gets_ox_head_and_horse_face(cn_tenant, merit, demerit, escort):
    soul = _due(cn_tenant)
    Soul.all_objects.filter(pk=soul.pk).update(merit_score=merit, demerit_score=demerit)
    assert capture.issue(Soul.objects.get(pk=soul.pk)).escort == escort


def test_issue_refusals(cn_tenant, eu_tenant):
    young = Soul.objects.create(name="未到", tenant=cn_tenant, fated_death_year=2999, fated_death_month=1,
                                fated_death_day=1)
    unrecorded = Soul.objects.create(name="未登记", tenant=cn_tenant)
    for soul, code in ((young, "lifespan_not_ended"), (unrecorded, "lifespan_not_ended"),
                       (_due(eu_tenant), "not_diyu")):
        with pytest.raises(capture.CaptureRefused) as exc:
            capture.issue(soul)
        assert exc.value.detail["code"] == code
    soul = _due(cn_tenant)
    capture.issue(soul)
    with pytest.raises(capture.CaptureRefused) as exc:
        capture.issue(soul)
    assert exc.value.detail["code"] == "warrant_open"


def test_a_death_registered_another_way_voids_the_open_warrant(cn_tenant):
    soul = _due(cn_tenant)
    warrant = capture.issue(soul)
    soul.die(death_date=date.today())
    warrant.refresh_from_db()
    assert warrant.status == "CANCELLED"
    assert _events(soul, "CAPTURE_WARRANT_CANCELLED")[0].payload["via"] == "death"


def test_a_failed_hand_over_writes_nothing(cn_tenant):
    soul = _due(cn_tenant)
    warrant = capture.issue(soul)
    capture.capture(warrant.pk)
    Soul.all_objects.filter(pk=soul.pk).update(current_state=SoulState.JUDGING)  # 死亡已被别处写下而牒未作废
    with pytest.raises(capture.CaptureRefused):
        capture.hand_over(warrant.pk)
    assert CaptureWarrant.objects.get(pk=warrant.pk).status == "CAPTURED"


def test_capture_api_is_tenant_scoped_and_lists_due_souls(cn_tenant, eu_tenant):
    lead = sp.officer("cap_lead", "MODERATOR", cn_tenant)
    client = officer_client(lead)
    mine, theirs = _due(cn_tenant, name="本殿"), _due(eu_tenant, name="他殿")
    due = client.get(WARRANTS + "due/").data
    assert [row["id"] for row in due] == [mine.pk]
    assert client.post(WARRANTS, {"soul": str(theirs.pk)}, format="json").status_code == 404
    res = client.post(WARRANTS, {"soul": str(mine.pk)}, format="json")
    assert res.status_code == 201
    assert client.get(WARRANTS + "due/").data == []
    pk = res.data["id"]
    assert client.post(f"{WARRANTS}{pk}/hand-over/", {}, format="json").status_code == 409
    assert client.post(f"{WARRANTS}{pk}/cancel/", {"reason": ""}, format="json").status_code == 400
    assert client.post(f"{WARRANTS}{pk}/capture/").data["status"] == "CAPTURED"
    assert client.post(f"{WARRANTS}{pk}/hand-over/", {}, format="json").data["status"] == "HANDED_OVER"
    assert client.get(WARRANTS, {"soul": str(mine.pk)}).data["results"][0]["status"] == "HANDED_OVER"


# ── 土地公 ──────────────────────────────────────────────────────────────


def test_a_tudi_registration_reports_to_his_own_city_god(cn_tenant):
    hangzhou = CityGod.objects.create(tenant=cn_tenant, name="杭州府城隍", regions=["杭州"])
    lingan = CityGod.objects.create(tenant=cn_tenant, name="临安县城隍", regions=["临安"])
    clerk = sp.officer("tudi_clerk", "JUDGE", cn_tenant)
    tudi = TudiGod.objects.create(tenant=cn_tenant, name="青山镇土地", regions=["青山镇"], city_god=lingan)
    tudi.officers.add(clerk)
    # 出身地写的是杭州,按出身地会配给杭州府城隍;土地公报的是自己的上级。
    soul = Soul.objects.create(name="报庙", tenant=cn_tenant, origin_location="杭州")
    res = officer_client(clerk).post(f"{TUDI}{tudi.pk}/register-death/", {
        "soul_lookup": {"soul_id": str(soul.pk)}, "death_date": "2026-10-01", "cause_of_death": "病故",
    }, format="json")
    assert res.status_code == 201, res.data
    record = DeathRegistrationRequest.objects.get(pk=res.data["id"])
    assert (record.status, record.source_system, record.tudi_god, record.api_key) == (
        "PROCESSED", "TUDI", tudi, None)
    judgment = Judgment.objects.get(soul=soul)
    assert judgment.city_god == lingan and judgment.city_god != hangzhou
    assert Soul.objects.get(pk=soul.pk).diyu_station == "TUDI_TEMPLE"


def test_only_his_officers_or_a_hall_admin_register_in_his_name(cn_tenant):
    tudi = TudiGod.objects.create(tenant=cn_tenant, name="白水乡土地")
    stranger = sp.officer("tudi_stranger", "JUDGE", cn_tenant)
    soul = Soul.objects.create(name="无关", tenant=cn_tenant)
    res = officer_client(stranger).post(f"{TUDI}{tudi.pk}/register-death/", {
        "soul_lookup": {"soul_id": str(soul.pk)}, "death_date": "2026-10-01"}, format="json")
    assert (res.status_code, res.data["code"]) == (403, "not_tudi_officer")
    assert Soul.objects.get(pk=soul.pk).current_state == SoulState.ALIVE


def test_tudi_gods_are_diyu_only_and_their_city_god_must_be_of_the_hall(cn_tenant, eu_tenant):
    eu_admin = sp.officer("tudi_eu", "MODERATOR", eu_tenant)
    res = officer_client(eu_admin).post(TUDI, {"name": "x"}, format="json")
    assert (res.status_code, res.data["code"]) == (400, "tudi_gods_diyu_only")
    lead = sp.officer("tudi_lead", "MODERATOR", cn_tenant)
    eu_god = CityGod.objects.create(tenant=eu_tenant, name="他殿城隍")
    res = officer_client(lead).post(TUDI, {"name": "石桥村土地", "city_god": str(eu_god.pk)}, format="json")
    assert res.status_code == 400 and "city_god" in res.data
    own_god = CityGod.objects.create(tenant=cn_tenant, name="本殿城隍")
    res = officer_client(lead).post(TUDI, {"name": "石桥村土地", "city_god": str(own_god.pk),
                                           "regions": ["石桥村", "", "石桥村"]}, format="json")
    assert res.status_code == 201 and res.data["regions"] == ["石桥村"]
    assert res.data["city_god_name"] == "本殿城隍"
