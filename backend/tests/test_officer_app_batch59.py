"""官员 App 第五十九批的两处后端:

- 「待我处理」的「枉死申诉」一组(`apps/officer_app/todo.py::_wangsi_items`,M-3):我名下城隍的枉死案子里申诉待审
  (FILED)的,只给名下官员,计入 `total()`;审过就出组。
- 审判详情的 `flow_progress`(M-1):原审流程走到第几站、处置为什么还不能执行(`weighing.unfinished_flow` 的码)。
"""
from datetime import date, timedelta

import pytest

from apps.judgment import wangsi
from apps.judgment.models import CityGod, GrievanceLevel, Judgment
from apps.officer_app import todo
from apps.souls.models import Soul, SoulState
from tests import sentence_plan_support as sp
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db


@pytest.fixture
def hall(cn_tenant):
    clerk = sp.officer("wangsi_clerk", "JUDGE", cn_tenant)
    god = CityGod.objects.create(tenant=cn_tenant, name="常熟县城隍", regions=["常熟"])
    god.officers.add(clerk)
    return {"clerk": clerk, "lead": sp.officer("wangsi_lead", "MODERATOR", cn_tenant), "god": god}


def _untimely(tenant, name="钱谦益"):
    fated = date.today() + timedelta(days=400)
    soul = Soul.objects.create(name=name, tenant=tenant, current_state=SoulState.ALIVE, origin_location="常熟",
                               fated_death_year=fated.year, fated_death_month=fated.month, fated_death_day=fated.day)
    case = soul.die(death_date=date.today())
    assert case.untimely
    return case


def test_the_wangsi_group_lists_filed_grievances_for_the_city_gods_officers_only(hall, cn_tenant):
    clerk = hall["clerk"]
    quiet = _untimely(cn_tenant, "阮大铖")  # untimely but no grievance filed: not in the group
    case = _untimely(cn_tenant)
    Judgment.all_objects.filter(pk=case.pk).update(grievance_level=GrievanceLevel.MAJOR)
    before = todo.total(clerk)
    wangsi.file_grievance(case.pk, clerk, "为人所害")

    group = todo.build(clerk)["wangsi"]
    assert group["count"] == 1 and [i["id"] for i in group["items"]] == [str(case.pk)]
    row = group["items"][0]
    assert row["kind"] == "wangsi" and row["target"] == {"kind": "wangsi", "id": str(case.pk)}
    assert (row["title"], row["city_god_name"], row["grievance_level"]) == ("钱谦益", "常熟县城隍", "MAJOR")
    assert str(quiet.pk) not in [i["id"] for i in group["items"]]
    assert todo.total(clerk) == before + 1
    # 殿管理员也能审,但不进他的待办(同城隍初审)
    assert todo.build(hall["lead"])["wangsi"]["count"] == 0
    # 「加载更多」走同一组
    assert todo.build(clerk, kind="wangsi")["count"] == 1

    wangsi.decide_grievance(case.pk, clerk, upheld=False, note="不实")
    assert todo.build(clerk)["wangsi"]["count"] == 0


def test_the_todo_endpoint_carries_the_group_and_accepts_its_kind(hall, cn_tenant):
    case = _untimely(cn_tenant)
    wangsi.file_grievance(case.pk, hall["clerk"], "为人所害")
    client = officer_client(hall["clerk"])
    assert client.get("/api/v1/officer-app/todo/").data["wangsi"]["count"] == 1
    assert client.get("/api/v1/officer-app/todo/", {"kind": "wangsi"}).data["count"] == 1


def test_a_judgment_without_a_flow_has_no_flow_progress():
    _soul, case = sp.open_case(sp.tenant("CN_DIYU"))
    admin = officer_client(sp.officer("flow_none", "ADMIN", case.tenant))
    assert admin.get(f"/api/v1/judgment/{case.pk}/").data["flow_progress"] is None


def test_flow_progress_says_where_the_flow_is_and_why_the_disposition_waits():
    tenant = sp.tenant("CN_DIYU")
    _soul, case = sp.open_case(tenant)
    assert case.conclude("FAILED", "") is True
    admin = officer_client(sp.officer("flow_reader", "ADMIN", tenant))

    progress = admin.get(f"/api/v1/judgment/{case.pk}/").data["flow_progress"]
    assert progress["status"] == "IN_PROGRESS" and progress["waiting"] == "approval_in_progress"
    assert 1 <= progress["index"] <= progress["total"]

    sp.walk_flow(case)
    done = admin.get(f"/api/v1/judgment/{case.pk}/").data["flow_progress"]
    assert done["status"] == "COMPLETED" and done["waiting"] is None
    assert done["index"] == done["total"]
