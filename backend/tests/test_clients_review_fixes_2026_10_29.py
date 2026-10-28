"""客户端审查(2026-10-29)要的三处后端:

- `JudgmentSerializer.wangsi_held`:官员端「还押 / 已到期」按服务端日期判,不拿手机日期比 `held_until`。
- `JudgmentSerializer.conclude_refusal`:审判台置灰「落判」读它(`claims.assert_concludable` 的码),不在前端重抄规则。
- 官员端待办「枉死申诉」按申诉提出的时刻(`grievance_filed_at`)排、显示它;已归档的不列。
"""
from datetime import date, timedelta

import pytest
from django.utils import timezone

from apps.judgment import wangsi
from apps.judgment.models import CityGod, DuatStage, Judgment
from apps.officer_app import todo
from apps.souls.models import Soul, SoulState
from tests import sentence_plan_support as sp
from tests.city_god_support import default_city_god, die_and_send_on
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db


def _soul(tenant, fated=None, name="李四"):
    soul = Soul.objects.create(name=name, tenant=tenant, current_state=SoulState.ALIVE, origin_location="常熟")
    if fated:
        soul.fated_death_year, soul.fated_death_month, soul.fated_death_day = fated.year, fated.month, fated.day
        soul.save()
    return soul


def _read(admin_user, case):
    return officer_client(admin_user).get(f"/api/v1/judgment/{case.pk}/").data


def test_a_held_case_says_so_and_cannot_be_concluded(cn_tenant, admin_user):
    default_city_god(cn_tenant)
    held = die_and_send_on(_soul(cn_tenant, date.today() + timedelta(days=400)), death_date=date.today())
    data = _read(admin_user, held)
    assert (data["wangsi_held"], data["conclude_refusal"]) == (True, "held_until_fated_date")

    # 阳寿已到:不再还押,能结案 —— 两列都跟着变(断缺席:不是恒为 True / 恒有码)
    Judgment.all_objects.filter(pk=held.pk).update(held_until=date.today() - timedelta(days=1))
    data = _read(admin_user, held)
    assert (data["wangsi_held"], data["conclude_refusal"]) == (False, "")


def test_a_timely_case_is_not_held_and_the_refusal_names_each_rule(cn_tenant, admin_user):
    default_city_god(cn_tenant)
    case = die_and_send_on(_soul(cn_tenant), death_date=date.today())
    data = _read(admin_user, case)
    assert (data["wangsi_held"], data["conclude_refusal"]) == (False, "")

    Judgment.all_objects.filter(pk=case.pk).update(duat_stage=DuatStage.NAMELESS)
    assert _read(admin_user, case)["conclude_refusal"] == "duat_unfinished"
    Judgment.all_objects.filter(pk=case.pk).update(
        duat_stage=DuatStage.EMBALMING, held_until=date.today() + timedelta(days=30))
    data = _read(admin_user, case)
    # 木乃伊制作中也有 held_until,但不是枉死:wangsi_held 必须是 False
    assert (data["wangsi_held"], data["conclude_refusal"]) == (False, "embalming")


def test_a_case_still_with_the_city_god_reports_at_city_god(cn_tenant, admin_user):
    CityGod.objects.create(tenant=cn_tenant, name="常熟县城隍", regions=["常熟"])
    case = _soul(cn_tenant).die(death_date=date.today())
    assert _read(admin_user, case)["conclude_refusal"] == "at_city_god"


@pytest.fixture
def hall(cn_tenant):
    clerk = sp.officer("wangsi_clerk", "JUDGE", cn_tenant)
    god = CityGod.objects.create(tenant=cn_tenant, name="常熟县城隍", regions=["常熟"])
    god.officers.add(clerk)
    return clerk


def test_the_wangsi_todo_dates_a_grievance_by_when_it_was_filed(hall, cn_tenant):
    fated = date.today() + timedelta(days=400)
    older = _soul(cn_tenant, fated, "钱谦益").die(death_date=date.today())
    newer = _soul(cn_tenant, fated, "阮大铖").die(death_date=date.today())
    wangsi.file_grievance(older.pk, hall, "为人所害")
    wangsi.file_grievance(newer.pk, hall, "冤")
    older.refresh_from_db()
    assert older.grievance_filed_at is not None
    # 之后改了旧那件(改冤情等级会动 update_time):它仍排在前,日期仍是提出那一刻
    Judgment.all_objects.filter(pk=older.pk).update(update_time=timezone.now() + timedelta(hours=1))

    items = todo.build(hall)["wangsi"]["items"]
    assert [i["id"] for i in items] == [str(older.pk), str(newer.pk)]
    assert items[0]["created_at"] == older.grievance_filed_at

    # 已归档的不列
    Judgment.all_objects.filter(pk=older.pk).update(is_archived=True)
    ids = [i["id"] for i in todo.build(hall)["wangsi"]["items"]]
    assert str(older.pk) not in ids and ids == [str(newer.pk)]


def test_capture_due_counts_every_due_soul_not_just_the_rows_it_returns(cn_tenant, monkeypatch):
    from apps.dispatch import capture_views

    monkeypatch.setattr(capture_views, "DUE_LIMIT", 1)
    for name in ("甲", "乙"):
        Soul.objects.create(name=name, tenant=cn_tenant, fated_death_year=2000, fated_death_month=1, fated_death_day=1)
    client = officer_client(sp.officer("cap_lead", "MODERATOR", cn_tenant))
    data = client.get("/api/v1/dispatch/capture-warrants/due/").data
    assert data["count"] == 2 and len(data["results"]) == 1
