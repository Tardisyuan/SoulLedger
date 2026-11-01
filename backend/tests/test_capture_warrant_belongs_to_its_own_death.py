"""勾魂牒与它那一次死亡(审查 2026-11-01):

* `attach_judgment` 只把案子挂到本次死亡交接的那张牒上,前一世留下的「已交接、没有案」的旧牒不动。
* 土地公登记时,`close_on_death` 写的事件点名案子实际去的城隍(土地公的上级),不是按出身地配的那位。
"""
from datetime import date, timedelta

import pytest
from django.utils import timezone

from apps.death_sync.models import TudiGod
from apps.dispatch import capture
from apps.dispatch.models import CaptureWarrant
from apps.events.models import SoulEvent
from apps.judgment.models import CityGod, Judgment
from apps.reincarnation.models import Reincarnation
from apps.souls.models import Soul
from tests import sentence_plan_support as sp
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

TUDI = "/api/v1/death-sync/tudi-gods/"


def _reborn_with_an_old_warrant(tenant):
    """这一世在世;上一世留下一张已交接、没有案的牒,之后才转世。"""
    god = CityGod.objects.create(tenant=tenant, name="杭州府城隍", regions=["杭州"])
    soul = Soul.objects.create(name="再世", tenant=tenant, origin_location="杭州", fated_death_year=2000,
                               fated_death_month=1, fated_death_day=1)
    old = CaptureWarrant.objects.create(tenant=tenant, soul=soul, status="HANDED_OVER",
                                        handed_over_at=timezone.now() - timedelta(days=30))
    Reincarnation.objects.create(soul=soul, target_realm="人道", tenant=tenant)
    return soul, old, god


def _assert_old_untouched(old):
    before = old.version
    old = CaptureWarrant.objects.get(pk=old.pk)
    assert (old.judgment_id, old.city_god_id, old.version) == (None, None, before)


def test_a_death_elsewhere_hangs_the_case_on_this_lifes_warrant_not_the_last_lifes(cn_tenant):
    soul, old, god = _reborn_with_an_old_warrant(cn_tenant)

    case = soul.die(death_date=date.today())

    _assert_old_untouched(old)
    new = CaptureWarrant.objects.exclude(pk=old.pk).get(soul=soul)
    assert (new.status, new.judgment_id, new.city_god_id) == ("HANDED_OVER", case.pk, god.pk)
    # 建(1)、close_on_death(2)、挂案(3):挂案那一笔走了审计字段。此前是 queryset.update,停在 2。
    assert new.version == 3


def test_with_no_warrant_of_this_life_the_last_lifes_is_not_taken_instead(cn_tenant):
    """这一世没有交接的牒时,什么都不挂,不退而求其次拿上一世那张。
    变异:`attach_judgment` 去掉 `handed_over_at__gt=last_rebirth` → 上一世的牒被挂上,红
    (2026-11-02 实测:只有前两条测试时,这条变异是绿的 —— 取最新一张的排序把它盖住了)。"""
    soul, old, _ = _reborn_with_an_old_warrant(cn_tenant)
    case = soul.die(death_date=date.today())
    CaptureWarrant.objects.exclude(pk=old.pk).filter(soul=soul).delete()

    capture.attach_judgment(soul, case)

    _assert_old_untouched(old)


def test_a_hand_over_leaves_the_last_lifes_warrant_alone_too(cn_tenant):
    soul, old, _ = _reborn_with_an_old_warrant(cn_tenant)
    warrant = capture.issue(soul)
    capture.capture(warrant.pk)

    capture.hand_over(warrant.pk)

    _assert_old_untouched(old)
    assert CaptureWarrant.objects.get(pk=warrant.pk).judgment_id == Judgment.objects.get(soul=soul).pk


def _register_by_tudi(tenant, soul):
    lingan = CityGod.objects.create(tenant=tenant, name="临安县城隍", regions=["临安"])
    clerk = sp.officer("tudi_clerk_events", "JUDGE", tenant)
    tudi = TudiGod.objects.create(tenant=tenant, name="青山镇土地", regions=["青山镇"], city_god=lingan)
    tudi.officers.add(clerk)
    res = officer_client(clerk).post(f"{TUDI}{tudi.pk}/register-death/", {
        "soul_lookup": {"soul_id": str(soul.pk)}, "death_date": "2026-10-01"}, format="json")
    assert res.status_code == 201, res.data
    assert res.data["status"] == "PROCESSED", res.data
    return lingan


def _city_gods_named(soul, event_type):
    return [e.payload["city_god_name"] for e in SoulEvent.objects.filter(soul=soul, event_type=event_type)]


def test_a_tudi_registration_names_the_city_god_the_case_went_to(cn_tenant):
    CityGod.objects.create(tenant=cn_tenant, name="杭州府城隍", regions=["杭州"])  # 按出身地会配给他
    soul = Soul.objects.create(name="报庙", tenant=cn_tenant, origin_location="杭州")

    lingan = _register_by_tudi(cn_tenant, soul)

    assert _city_gods_named(soul, "CAPTURE_WARRANT_ISSUED") == ["临安县城隍"]
    assert _city_gods_named(soul, "CAPTURE_HANDED_OVER") == ["临安县城隍"]
    warrant = CaptureWarrant.objects.get(soul=soul)
    assert warrant.city_god_id == lingan.pk == Judgment.objects.get(soul=soul).city_god_id


def test_a_warrant_already_issued_by_birthplace_hands_over_to_the_tudis_city_god(cn_tenant):
    CityGod.objects.create(tenant=cn_tenant, name="杭州府城隍", regions=["杭州"])
    soul = Soul.objects.create(name="先发牒", tenant=cn_tenant, origin_location="杭州", fated_death_year=2000,
                               fated_death_month=1, fated_death_day=1)
    capture.issue(soul)

    _register_by_tudi(cn_tenant, soul)

    # 发牒那一刻确实是杭州府城隍发的:那一行不改;交接那一行说案子去了哪里。
    assert _city_gods_named(soul, "CAPTURE_WARRANT_ISSUED") == ["杭州府城隍"]
    assert _city_gods_named(soul, "CAPTURE_HANDED_OVER") == ["临安县城隍"]


def test_a_death_with_no_reporting_city_god_still_matches_by_place(cn_tenant):
    CityGod.objects.create(tenant=cn_tenant, name="杭州府城隍", regions=["杭州"])
    soul = Soul.objects.create(name="按地名", tenant=cn_tenant, origin_location="杭州")

    soul.die(death_date=date.today())

    assert _city_gods_named(soul, "CAPTURE_HANDED_OVER") == ["杭州府城隍"]
    assert capture._reported_to.get() is None
