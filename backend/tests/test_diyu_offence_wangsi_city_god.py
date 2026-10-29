"""地府三组缺口(2026-10-28,以文档为准):

A. 罪目分殿 —— 十殿按罪行类型分殿(docs/01 十殿表、docs/11 §2.2、§3.1 第四步);没填罪目才退回按严重度。
B. 枉死城 —— 死因分类、冤情等级、申诉属实且冤情重大则提前释放(docs/10 §2.2、§4.2、§6.1、§6.2)。
C. 城隍四级与诸司(docs/08 §二、§三)。

前端的选项表(`packages/core/src/domain/diyuCase.ts`、`cityGods.ts`)是后端枚举的镜像,这里逐项对照。
"""
import re
from datetime import date, timedelta
from pathlib import Path

import pytest

from apps.disposition.services import DispositionService
from apps.judgment import claims, wangsi
from apps.judgment.claims import ClaimRefusedError
from apps.judgment.models import (
    OFFENCE_COURT,
    ChineseOffence,
    CityGod,
    CityGodBureau,
    CityGodRank,
    GrievanceLevel,
    GrievanceStatus,
    Judgment,
    Verdict,
    WrongfulDeathCause,
)
from apps.souls.models import Soul, SoulState
from tests.city_god_support import default_city_god, die_and_send_on

REPO_ROOT = Path(__file__).resolve().parents[2]
DOMAIN = REPO_ROOT / "packages" / "core" / "src" / "domain"


# ── A. 罪目分殿 ─────────────────────────────────────────────────────────


def test_every_offence_names_a_punishment_court():
    assert set(OFFENCE_COURT) == set(ChineseOffence.values)
    assert set(OFFENCE_COURT.values()) == set(range(2, 10)), "二至九殿每一殿都该掌至少一类罪"


def test_a_failed_case_with_an_offence_goes_to_the_court_that_tries_it_whatever_its_severity():
    for offence, court in OFFENCE_COURT.items():
        for severity in (0, 15, 95):
            assert DispositionService._route_chinese(None, Verdict.FAILED, -severity, severity, offence=offence) \
                == DispositionService.CHINESE_HELL_TIERS[court]


def test_without_an_offence_the_severity_band_still_decides():
    assert DispositionService._route_chinese(None, Verdict.FAILED, -25) == DispositionService.CHINESE_HELL_TIERS[3]
    assert DispositionService._route_chinese(None, Verdict.FAILED, -25, offence="") \
        == DispositionService.CHINESE_HELL_TIERS[3]


def test_an_offence_does_not_override_a_non_failed_verdict():
    assert DispositionService._route_chinese(None, Verdict.PASSED, 0, offence=ChineseOffence.MURDER) \
        == DispositionService.CHINESE_HEAVEN
    assert DispositionService._route_chinese(None, Verdict.PURGATORY, 0, offence=ChineseOffence.MURDER) \
        == DispositionService.CHINESE_PURGATORY


def _soul(tenant, fated=None):
    soul = Soul.objects.create(name="李四", tenant=tenant, current_state=SoulState.ALIVE)
    if fated:
        soul.fated_death_year, soul.fated_death_month, soul.fated_death_day = fated.year, fated.month, fated.day
        soul.save()
    return soul


@pytest.fixture
def cn_tenant(cn_tenant):
    """地府开案要有城隍收案(用户 2026-10-29):本殿的兜底城隍;案子收下就解送(这里测的不是初审)。"""
    default_city_god(cn_tenant)
    return cn_tenant


@pytest.mark.django_db
def test_the_router_reads_the_judgments_offence(cn_tenant):
    judgment = die_and_send_on(_soul(cn_tenant), death_date=date.today())
    judgment.offence = ChineseOffence.BONES_FOR_MEDICINE
    judgment.save(update_fields=["offence"])
    code = DispositionService._route_to_realm(judgment.soul, Verdict.FAILED, judgment=judgment)
    assert code == DispositionService.CHINESE_HELL_TIERS[7]


@pytest.mark.django_db
def test_an_officer_records_the_offence_and_it_cannot_change_after_conclusion(cn_tenant, cn_admin_user):
    from tests.soul_account_support import officer_client

    judgment = die_and_send_on(_soul(cn_tenant), death_date=date.today())
    client = officer_client(cn_admin_user)
    url = f"/api/v1/judgment/{judgment.pk}/"
    res = client.patch(url, {"offence": "SEPARATING_KIN"}, format="json")
    assert res.status_code == 200 and res.data["offence"] == "SEPARATING_KIN", res.data
    assert client.patch(url, {"offence": "NOT_AN_OFFENCE"}, format="json").status_code == 400
    Judgment.all_objects.filter(pk=judgment.pk).update(verdict=Verdict.FAILED, is_final=True)
    res = client.patch(url, {"offence": "MURDER"}, format="json")
    assert res.status_code == 400 and "offence" in res.data


# ── B. 枉死城 ──────────────────────────────────────────────────────────


@pytest.fixture
def held(cn_tenant):
    return die_and_send_on(_soul(cn_tenant, date.today() + timedelta(days=400)), death_date=date.today())


@pytest.mark.django_db
def test_cause_and_level_are_recorded_only_on_an_untimely_case(cn_tenant, cn_admin_user, held):
    from tests.soul_account_support import officer_client

    client = officer_client(cn_admin_user)
    res = client.patch(f"/api/v1/judgment/{held.pk}/",
                       {"wrongful_death_cause": WrongfulDeathCause.VICTIM, "grievance_level": GrievanceLevel.SEVERE},
                       format="json")
    assert res.status_code == 200, res.data
    assert (res.data["wrongful_death_cause"], res.data["grievance_level"]) == ("VICTIM", "SEVERE")
    timely = die_and_send_on(_soul(cn_tenant), death_date=date.today())
    res = client.patch(f"/api/v1/judgment/{timely.pk}/", {"grievance_level": "MAJOR"}, format="json")
    assert res.status_code == 400 and "grievance_level" in res.data


@pytest.mark.django_db
def test_an_upheld_major_grievance_releases_the_soul_early(cn_admin_user, judge_user, held):
    Judgment.all_objects.filter(pk=held.pk).update(grievance_level=GrievanceLevel.MAJOR)
    wangsi.file_grievance(held.pk, cn_admin_user, "为人所害")
    with pytest.raises(wangsi.WangsiRefusedError) as again:
        wangsi.file_grievance(held.pk, cn_admin_user, "再提")
    assert again.value.code == "grievance_open"
    wangsi.decide_grievance(held.pk, cn_admin_user, upheld=True, note="属实")
    held.refresh_from_db()
    assert held.grievance_status == GrievanceStatus.UPHELD and held.held_until is None and held.untimely
    claims.claim(held.pk, judge_user)  # 不再拦


@pytest.mark.django_db
def test_a_minor_grievance_cannot_release_and_a_rejected_one_stays_held(cn_admin_user, judge_user, held):
    Judgment.all_objects.filter(pk=held.pk).update(grievance_level=GrievanceLevel.MINOR)
    wangsi.file_grievance(held.pk, cn_admin_user, "冤")
    with pytest.raises(wangsi.WangsiRefusedError) as refused:
        wangsi.decide_grievance(held.pk, cn_admin_user, upheld=True, note="属实")
    assert refused.value.code == "grievance_not_major"
    wangsi.decide_grievance(held.pk, cn_admin_user, upheld=False, note="不属实")
    held.refresh_from_db()
    assert held.grievance_status == GrievanceStatus.REJECTED and held.held_until is not None
    with pytest.raises(ClaimRefusedError) as still:
        claims.claim(held.pk, judge_user)
    assert still.value.code == "held_until_fated_date"
    wangsi.file_grievance(held.pk, cn_admin_user, "补了证据再提")  # 不属实之后可以再提


@pytest.mark.django_db
def test_only_a_case_still_held_takes_a_grievance(cn_tenant, cn_admin_user):
    timely = die_and_send_on(_soul(cn_tenant), death_date=date.today())
    with pytest.raises(wangsi.WangsiRefusedError) as refused:
        wangsi.file_grievance(timely.pk, cn_admin_user, "冤")
    assert refused.value.code == "not_in_wangsi"


@pytest.mark.django_db
def test_an_officer_without_assign_cannot_decide_a_case_with_no_city_god(cn_admin_user, judge_user, held):
    Judgment.all_objects.filter(pk=held.pk).update(grievance_level=GrievanceLevel.SEVERE)
    wangsi.file_grievance(held.pk, cn_admin_user, "冤")
    with pytest.raises(wangsi.WangsiRefusedError) as refused:
        wangsi.decide_grievance(held.pk, judge_user, upheld=True, note="属实")
    assert refused.value.code == "not_city_god_officer" and refused.value.status == 403


@pytest.mark.django_db
def test_the_endpoints_answer_the_whole_judgment(cn_admin_user, held):
    from tests.soul_account_support import officer_client

    Judgment.all_objects.filter(pk=held.pk).update(grievance_level=GrievanceLevel.SEVERE)
    client = officer_client(cn_admin_user)
    res = client.post(f"/api/v1/judgment/wangsi/{held.pk}/grievance/", {"plea": "冤"}, format="json")
    assert res.status_code == 200 and res.data["grievance_status"] == "FILED", res.data
    res = client.post(f"/api/v1/judgment/wangsi/{held.pk}/decide/", {"upheld": True, "note": "属实"}, format="json")
    assert res.status_code == 200 and res.data["held_until"] is None, res.data
    res = client.post(f"/api/v1/judgment/wangsi/{held.pk}/decide/", {"upheld": True, "note": "再审"}, format="json")
    # 到期 / 出城后仍可审(fda5396a),所以第二次被拒的原因是「没有待审的申诉」,不是「不在枉死城」。
    assert res.status_code == 409 and res.data["code"] == "no_grievance_filed"


# ── C. 城隍四级与诸司 ──────────────────────────────────────────────────


@pytest.mark.django_db
def test_a_city_god_carries_a_rank_and_its_bureaus_in_enum_order(cn_tenant, cn_admin_user):
    from tests.soul_account_support import officer_client

    client = officer_client(cn_admin_user)
    res = client.post("/api/v1/judgment/city-gods/", {
        "name": "杭州府城隍", "rank": CityGodRank.PREFECTURE,
        "bureaus": ["XINGFA", "YINYANG", "XINGFA"],
    }, format="json")
    assert res.status_code == 201, res.data
    assert res.data["rank"] == "PREFECTURE" and res.data["bureaus"] == ["YINYANG", "XINGFA"]
    assert CityGod.all_objects.get(pk=res.data["id"]).bureaus == ["YINYANG", "XINGFA"]
    res = client.patch(f"/api/v1/judgment/city-gods/{res.data['id']}/", {"bureaus": ["NOT_A_BUREAU"]}, format="json")
    assert res.status_code == 400


# ── 前端镜像 ──────────────────────────────────────────────────────────


def _quoted(text):
    return re.findall(r'"([A-Z_]+)"', text)


def test_the_frontend_offence_groups_mirror_the_backend():
    text = (DOMAIN / "diyuCase.ts").read_text(encoding="utf-8")
    groups = re.findall(r"court: (\d+), offences: \[([^\]]*)\]", text)
    assert groups, "OFFENCES_BY_COURT not found"
    mirrored = {name: int(court) for court, body in groups for name in _quoted(body)}
    assert mirrored == {str(k): v for k, v in OFFENCE_COURT.items()}
    causes = re.search(r"WRONGFUL_DEATH_CAUSES = \[([^\]]*)\]", text).group(1)
    levels = re.search(r"GRIEVANCE_LEVELS = \[([^\]]*)\]", text).group(1)
    assert _quoted(causes) == list(WrongfulDeathCause.values)
    assert _quoted(levels) == list(GrievanceLevel.values)


def test_the_frontend_city_god_tables_mirror_the_backend():
    text = (DOMAIN / "cityGods.ts").read_text(encoding="utf-8")
    ranks = re.search(r"CITY_GOD_RANKS = \[([^\]]*)\]", text).group(1)
    assert _quoted(ranks) == list(CityGodRank.values)
    bureaus = [b for body in re.findall(r"bureaus: \[([^\]]*)\]", text) for b in _quoted(body)]
    assert bureaus == list(CityGodBureau.values)
    assert len(bureaus) == 25, "阴阳司 + 六部各四司"
