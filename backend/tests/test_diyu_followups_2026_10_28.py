"""地府补完(2026-10-28 用户拍板):部洲与十三站回填(souls/0050)、灵魂 App 提枉死城申诉(`/me/wangsi/`)、
申诉上时间线(`WANGSI_GRIEVANCE_*`)、土地公的上级只能是县城隍、城隍封号按明制。"""
import importlib
import json
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from django.apps import apps as live_apps

from apps.death_sync.models import TudiGod
from apps.events.models import SoulEvent
from apps.judgment import wangsi
from apps.judgment.models import CityGod, CityGodRank, GrievanceLevel, Judgment
from apps.realms.models import Realm
from apps.realms.path import SoulPathService
from apps.souls.models import TENANT_CIVILIZATION, Soul, SoulState
from tests import sentence_plan_support as sp
from tests.soul_account_support import officer_client, ready_soul

pytestmark = pytest.mark.django_db

REPO = Path(__file__).resolve().parents[2]
BACKFILL = importlib.import_module("apps.souls.migrations.0050_backfill_diyu_station_and_birth_continent")
WANGSI_ME = "/api/v1/me/wangsi/"
TUDI = "/api/v1/death-sync/tudi-gods/"


def _events(soul, event_type):
    return list(SoulEvent.objects.filter(soul=soul, event_type=event_type).order_by("create_time", "id"))


# ── 回填 ────────────────────────────────────────────────────────────────


def _run_backfill():
    BACKFILL.backfill(live_apps, SimpleNamespace(connection=SimpleNamespace(alias="default")))


def test_the_migrations_copy_of_the_tenant_map_matches_the_runtime_one():
    chinese = tuple(code for code, civ in TENANT_CIVILIZATION.items() if civ == "CHINESE")
    assert chinese == BACKFILL.CHINESE_TENANT_CODES
    assert set(BACKFILL.KNOWN_TENANT_CODES) == set(TENANT_CIVILIZATION)


def test_backfill_fills_continent_and_infers_the_station_from_where_the_soul_is(cn_tenant, eu_tenant):
    def bare(name, state, **fields):
        return Soul.objects.create(name=name, tenant=cn_tenant, current_state=state, **fields)

    alive = bare("在世", SoulState.ALIVE)
    kept = bare("已有部洲", SoulState.ALIVE, birth_continent="XINIU")
    judging = bare("刚死", SoulState.JUDGING)
    in_court = bare("在殿", SoulState.JUDGING)
    court = Realm.objects.create(realm_code="DY_COURT_01_QINGUANG", civilization="CHINESE", name_local="第一殿",
                                 realm_type="HELL", tenant=cn_tenant)
    SoulPathService.enter(in_court, court, tenant_id=cn_tenant.pk)
    Soul.all_objects.filter(pk=in_court.pk).update(diyu_station="")  # 进殿那一刻自动写的站,当作存量没有
    souped = bare("饮汤", SoulState.REINCARNATING, soup_taken_at="2026-10-01T00:00:00Z")
    waiting = bare("待转世", SoulState.REINCARNATING)
    disposed = bare("在狱", SoulState.DISPOSED)
    placed = bare("官员挪过", SoulState.JUDGING, diyu_station="WANGXIANG_TERRACE")
    eu = Soul.objects.create(name="Dante", tenant=eu_tenant, current_state=SoulState.JUDGING)

    _run_backfill()

    got = {s.name: (s.birth_continent, s.diyu_station) for s in Soul.all_objects.filter(
        pk__in=[x.pk for x in (alive, kept, judging, in_court, souped, waiting, disposed, placed, eu)])}
    assert got == {
        "在世": ("NANZHAN", ""),
        "已有部洲": ("XINIU", ""),
        "刚死": ("NANZHAN", "TUDI_TEMPLE"),
        "在殿": ("NANZHAN", "FENGDU_CITY"),
        "饮汤": ("NANZHAN", "HUANHUN_CLIFF"),
        "待转世": ("NANZHAN", ""),
        "在狱": ("NANZHAN", ""),
        "官员挪过": ("NANZHAN", "WANGXIANG_TERRACE"),
        "Dante": ("", ""),
    }
    assert not _events(judging, "DIYU_STATION_CHANGED"), "回填不是一次换站"


def test_a_new_hall_declared_chinese_is_backfilled_too():
    from apps.tenants.models import Tenant

    hall = Tenant.objects.create(code="CN_NEW_HALL", display_name="新殿", declared_civilization="CHINESE")
    soul = Soul.objects.create(name="新殿亡魂", tenant=hall, current_state=SoulState.JUDGING)
    _run_backfill()
    soul.refresh_from_db()
    assert (soul.birth_continent, soul.diyu_station) == ("NANZHAN", "TUDI_TEMPLE")


# ── 灵魂 App 提申诉 ─────────────────────────────────────────────────────


def _held_case(soul, tenant):
    return Judgment.objects.create(soul=soul, civilization="CHINESE", tenant=tenant, untimely=True,
                                   held_until=date.today() + timedelta(days=400))


def test_a_soul_files_its_own_grievance_and_sees_where_it_stands(cn_tenant):
    account, client = ready_soul(cn_tenant)
    case = _held_case(account.soul, cn_tenant)
    listed = client.get(WANGSI_ME).data
    assert [(r["judgment_id"], r["held"], r["can_file"], r["refusal_code"]) for r in listed] == [
        (str(case.pk), True, True, None)]

    res = client.post(WANGSI_ME, {"judgment": str(case.pk), "plea": "为人所害"}, format="json")
    assert res.status_code == 201, res.data
    assert (res.data["grievance_status"], res.data["can_file"], res.data["refusal_code"]) == (
        "FILED", False, "grievance_open")
    assert [e.payload for e in _events(account.soul, "WANGSI_GRIEVANCE_FILED")] == [{
        "judgment_id": str(case.pk), "status": "FILED", "grievance_level": "", "via": "soul"}]

    again = client.post(WANGSI_ME, {"judgment": str(case.pk), "plea": "再提"}, format="json")
    assert (again.status_code, again.data["code"]) == (409, "grievance_open")


def test_a_soul_cannot_file_for_another_soul_or_a_case_not_held(cn_tenant):
    account, client = ready_soul(cn_tenant)
    other, _ = ready_soul(cn_tenant, name="别人")
    theirs = _held_case(other.soul, cn_tenant)
    res = client.post(WANGSI_ME, {"judgment": str(theirs.pk), "plea": "冤"}, format="json")
    assert (res.status_code, res.data["code"]) == (404, "not_found")
    assert Judgment.all_objects.get(pk=theirs.pk).grievance_status == ""

    released = Judgment.objects.create(soul=account.soul, civilization="CHINESE", tenant=cn_tenant, untimely=True,
                                       held_until=date.today() - timedelta(days=1))
    res = client.post(WANGSI_ME, {"judgment": str(released.pk), "plea": "冤"}, format="json")
    assert (res.status_code, res.data["code"]) == (409, "not_in_wangsi")
    assert client.post(WANGSI_ME, {"judgment": str(released.pk), "plea": ""}, format="json").status_code == 400
    # 列表只有自己的、枉死的案子
    Judgment.objects.create(soul=account.soul, civilization="CHINESE", tenant=cn_tenant)
    assert [r["judgment_id"] for r in client.get(WANGSI_ME).data] == [str(released.pk)]


def test_the_decision_lands_on_the_timeline(cn_tenant, admin_user):
    account, client = ready_soul(cn_tenant)
    case = _held_case(account.soul, cn_tenant)
    Judgment.all_objects.filter(pk=case.pk).update(grievance_level=GrievanceLevel.SEVERE)
    wangsi.file_grievance(case.pk, admin_user, "冤")
    wangsi.decide_grievance(case.pk, admin_user, upheld=True, note="属实")
    assert [e.payload for e in _events(account.soul, "WANGSI_GRIEVANCE_UPHELD")] == [{
        "judgment_id": str(case.pk), "status": "UPHELD", "grievance_level": "SEVERE"}]
    assert _events(account.soul, "WANGSI_GRIEVANCE_FILED")[0].payload["via"] == "officer"
    row = client.get(WANGSI_ME).data[0]
    assert (row["held"], row["grievance_status"], row["grievance_note"]) == (False, "UPHELD", "属实")


def test_a_rejected_grievance_is_on_the_timeline(cn_tenant, admin_user):
    account, _client = ready_soul(cn_tenant)
    case = _held_case(account.soul, cn_tenant)
    wangsi.file_grievance(case.pk, None, "冤", account=account)
    wangsi.decide_grievance(case.pk, admin_user, upheld=False, note="不属实")
    assert [e.payload["status"] for e in _events(account.soul, "WANGSI_GRIEVANCE_REJECTED")] == ["REJECTED"]


# ── 土地公的上级只能是县城隍 ────────────────────────────────────────────


def test_a_tudi_god_reports_only_to_a_county_city_god_or_an_unranked_one(cn_tenant):
    lead = sp.officer("tudi_rank", "MODERATOR", cn_tenant)
    client = officer_client(lead)
    prefecture = CityGod.objects.create(tenant=cn_tenant, name="杭州府城隍", rank=CityGodRank.PREFECTURE)
    county = CityGod.objects.create(tenant=cn_tenant, name="临安县城隍", rank=CityGodRank.COUNTY)
    unranked = CityGod.objects.create(tenant=cn_tenant, name="未定级城隍")

    res = client.post(TUDI, {"name": "青山镇土地", "city_god": str(prefecture.pk)}, format="json")
    assert res.status_code == 400 and res.data["city_god"]["code"] == "tudi_city_god_not_county", res.data
    assert not TudiGod.objects.filter(name="青山镇土地").exists()

    res = client.post(TUDI, {"name": "青山镇土地", "city_god": str(county.pk)}, format="json")
    assert res.status_code == 201, res.data
    res = client.patch(f"{TUDI}{res.data['id']}/", {"city_god": str(prefecture.pk)}, format="json")
    assert res.status_code == 400 and "city_god" in res.data
    res = client.post(TUDI, {"name": "白水乡土地", "city_god": str(unranked.pk)}, format="json")
    assert res.status_code == 201, res.data
    # 名下有土地公的城隍不能改成别的级;没有土地公的照改。
    res = client.patch(f"/api/v1/judgment/city-gods/{county.pk}/", {"rank": "PREFECTURE"}, format="json")
    assert res.status_code == 400 and res.data["rank"]["code"] == "city_god_has_tudi_gods", res.data
    assert CityGod.all_objects.get(pk=county.pk).rank == CityGodRank.COUNTY
    res = client.patch(f"/api/v1/judgment/city-gods/{prefecture.pk}/", {"rank": "DEPARTMENT"}, format="json")
    assert res.status_code == 200, res.data


# ── 文案 ────────────────────────────────────────────────────────────────


def _bundle(name):
    return json.loads((REPO / "packages" / "core" / "messages" / f"{name}.json").read_text(encoding="utf-8"))


def test_city_god_titles_follow_the_ming_enfeoffment():
    zh = _bundle("zh-Hans")["cityGods"]["rank_titles"]
    assert (zh["PREFECTURE"], zh["DEPARTMENT"], zh["COUNTY"]) == ("威灵公", "灵佑侯", "显佑伯")
    assert zh["PROVINCE"] == "承天鉴国司民升福明灵王"
    doc = (REPO / "docs" / "08_城隍体系详解.md").read_text(encoding="utf-8")
    assert "显正伯" not in doc and "子爵" not in doc
