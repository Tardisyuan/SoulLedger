"""案卷台的来源(apps/judgment/sources.py):队列行的 `source`、列表的 `?source=`、
`queue-counts/` 的 `sources` 与 `elsewhere`,以及两样数都按殿隔离。"""
from datetime import date, timedelta

import pytest

from apps.dispatch.models import CrossTenantJudgment, JudgmentStatus
from apps.judgment import sources
from apps.judgment.models import CityGod, Judgment, JudgmentAppeal
from apps.soul_accounts.models import RebirthApplication, RebirthApplicationStatus
from apps.souls.models import Soul, SoulState
from apps.workflow.models import ApprovalWorkflow, CaseType
from tests import sentence_plan_support as sp
from tests.soul_account_support import officer_client, ready_soul

pytestmark = pytest.mark.django_db

BASE = "/api/v1/judgment/"


def _case(tenant, name, *, home=None, **fields):
    soul = Soul.objects.create(name=name, tenant=tenant, home_tenant=home or tenant, current_state=SoulState.JUDGING)
    return Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=tenant,
                                   evidence_json={}, **fields)


def _application(tenant, name, status):
    account, _ = ready_soul(tenant, name=name, state=SoulState.REINCARNATING)
    return RebirthApplication.objects.create(
        soul=account.soul, account=account, cycle=account.cycle, desired_form="HUMAN", status=status,
        workflow=ApprovalWorkflow.objects.create(soul=account.soul, workflow_name="x",
                                                 case_type=CaseType.REBIRTH_APPLICATION))


def _hall(tenant, away_home):
    """一个殿里每样各一件。返回 {名字: 对象}。"""
    god = CityGod.objects.create(tenant=tenant, name=f"{tenant.code} 城隍", regions=["杭州"])
    rows = {
        "plain": _case(tenant, "普通"),
        "sent_on": _case(tenant, "解送"),
        "away": _case(tenant, "暂居", home=away_home),
        "joint": _case(tenant, "联审"),
        "at_city_god": _case(tenant, "初审中"),
        "appealed": _case(tenant, "已结申诉"),
    }
    Judgment.all_objects.filter(pk=rows["sent_on"].pk).update(city_god=god, city_god_status="SENT_ON")
    Judgment.all_objects.filter(pk=rows["at_city_god"].pk).update(city_god=god, city_god_status="PENDING")
    Judgment.all_objects.filter(pk=rows["appealed"].pk).update(verdict="FAILED", is_final=True)
    rows["bench"] = CrossTenantJudgment.objects.create(
        title="联审", description="x", initiating_tenant=tenant, tenant=tenant, judgment=rows["joint"],
        status=JudgmentStatus.ACTIVE)
    rows["appeal"] = JudgmentAppeal.objects.create(
        judgment=rows["appealed"], soul=rows["appealed"].soul, tenant=tenant, round=1, reason="冤",
        original_verdict="FAILED")
    yesterday = date.today() - timedelta(days=1)
    rows["due"] = Soul.objects.create(
        name="阳寿尽", tenant=tenant, current_state=SoulState.ALIVE, fated_death_year=yesterday.year,
        fated_death_month=yesterday.month, fated_death_day=yesterday.day)
    # 转生申请(第七个来源):审核中、申诉中各一件算;已驳回的不算。
    rows["applying"] = _application(tenant, "申请转生", RebirthApplicationStatus.UNDER_REVIEW)
    rows["appealing"] = _application(tenant, "申诉转生", RebirthApplicationStatus.APPEALING)
    rows["refused"] = _application(tenant, "驳回转生", RebirthApplicationStatus.REJECTED)
    return rows


@pytest.fixture
def world(cn_tenant, eu_tenant):
    # 暂居灵魂的原属取第三、第四个殿:原属对暂居地的审判只读可见(apps/core/tenant.py),
    # 取对方的殿会让两边的列表互相多出一行,这里要测的是隔离本身。
    return {
        "cn": _hall(cn_tenant, away_home=sp.tenant("GR_HADES")),
        "eu": _hall(eu_tenant, away_home=sp.tenant("EG_DUAT")),
        "cn_judge": officer_client(sp.officer("cn_judge", "JUDGE", cn_tenant)),
        "eu_judge": officer_client(sp.officer("eu_judge", "JUDGE", eu_tenant)),
    }


EXPECTED_SOURCE = {"plain": "queue", "sent_on": "city_god", "away": "cross", "joint": "cross"}


def _rows(response):
    assert response.status_code == 200, response.data
    return {row["id"]: row["source"] for row in response.data["results"]}


def test_each_queue_row_carries_its_source(world):
    got = _rows(world["cn_judge"].get(BASE, {"group": "unclaimed"}))
    assert got == {str(world["cn"][name].pk): source for name, source in EXPECTED_SOURCE.items()}


def test_the_single_object_path_agrees_with_the_list_annotation(world):
    """`source_of`(认领、`next/` 等单件回包)与列表的 `annotate` 是两份实现,必须给同一个答案。"""
    for name, source in EXPECTED_SOURCE.items():
        assert sources.source_of(Judgment.objects.get(pk=world["cn"][name].pk)) == source, name
    detail = world["cn_judge"].get(f"{BASE}{world['cn']['joint'].pk}/")
    assert detail.status_code == 200 and detail.data["source"] == "cross"


def test_the_source_filter_returns_that_source_only(world):
    client, cn = world["cn_judge"], world["cn"]
    for wanted in sources.VALUES:
        got = _rows(client.get(BASE, {"group": "unclaimed", "source": wanted}))
        expected = {str(cn[name].pk) for name, source in EXPECTED_SOURCE.items() if source == wanted}
        assert set(got) == expected, wanted
        assert set(got.values()) <= {wanted}
    assert client.get(BASE, {"source": "triage"}).status_code == 400


def test_a_concluded_joint_judgment_no_longer_makes_the_case_cross(world):
    bench = world["cn"]["bench"]
    CrossTenantJudgment.all_objects.filter(pk=bench.pk).update(status=JudgmentStatus.CONCLUDED)
    got = _rows(world["cn_judge"].get(BASE, {"group": "unclaimed"}))
    assert got[str(world["cn"]["joint"].pk)] == "queue"


def test_counts_carry_the_sources_and_the_counts_elsewhere(world):
    counts = world["cn_judge"].get(f"{BASE}queue-counts/").data
    assert counts["total"] == 4  # 初审中的不在十殿队列,已结的不是未结
    assert counts["sources"] == {"queue": 1, "city_god": 1, "cross": 2}
    assert sum(counts["sources"].values()) == counts["total"]
    assert counts["elsewhere"] == {"appeal": 1, "city_god_review": 1, "cross_judgment": 1, "capture_due": 1,
                                   "rebirth_application": 2}


def test_the_source_param_narrows_the_groups_but_not_the_sources(world):
    counts = world["cn_judge"].get(f"{BASE}queue-counts/", {"source": "cross"}).data
    assert counts["total"] == 2 and counts["unclaimed"] == 2
    assert counts["sources"] == {"queue": 1, "city_god": 1, "cross": 2}
    assert world["cn_judge"].get(f"{BASE}queue-counts/", {"source": "nope"}).status_code == 400


def test_counts_are_each_halls_own(world):
    """两个殿各有同样一套;谁也不该数到对方的。欧洲殿没有勾魂牒(只在地府)。"""
    cn = world["cn_judge"].get(f"{BASE}queue-counts/").data
    eu = world["eu_judge"].get(f"{BASE}queue-counts/").data
    for counts in (cn, eu):
        assert counts["sources"] == {"queue": 1, "city_god": 1, "cross": 2}
        assert counts["elsewhere"]["appeal"] == 1
        assert counts["elsewhere"]["city_god_review"] == 1
        assert counts["elsewhere"]["cross_judgment"] == 1
        assert counts["elsewhere"]["rebirth_application"] == 2  # 对方殿的两件不在里面
    assert cn["elsewhere"]["capture_due"] == 1
    assert eu["elsewhere"]["capture_due"] == 0
    assert _rows(world["eu_judge"].get(BASE, {"source": "cross"})).keys() == {
        str(world["eu"]["away"].pk), str(world["eu"]["joint"].pk)}


def test_a_count_elsewhere_is_null_without_its_read_codename(world, monkeypatch):
    from apps.core import permissions

    real = permissions.user_has_permission
    monkeypatch.setattr(permissions, "user_has_permission",
                        lambda user, codename: codename not in {"capture.read", "workflow.read"} and real(user, codename))
    elsewhere = world["cn_judge"].get(f"{BASE}queue-counts/").data["elsewhere"]
    assert elsewhere["capture_due"] is None
    assert elsewhere["rebirth_application"] is None
    assert elsewhere["appeal"] == 1
