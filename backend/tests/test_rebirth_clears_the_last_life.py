"""转世清掉上一世「一世一记」的字段,并按新生的部洲给默认阳寿(2026-10-29 审查 + 用户决定)。

规则在 `apps/reincarnation/services.py::complete_rebirth` 与 `continent_fated_death`。人寿取 docs/07 §人道表:
东胜 250、南瞻 100、西牛 500、北俱卢 1000。
"""
from datetime import date, timedelta

import pytest
from django.utils import timezone

from apps.dispatch import capture
from apps.judgment.claims import ferry_barred
from apps.reincarnation.services import ReincarnationService, continent_fated_death
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db


def _reborn(tenant, continent="", **fields):
    # 地府转世前要饮孟婆汤(`needs_soup`);这里只测转世那一笔,直接记作已饮。
    soul = Soul.objects.create(name="前世", tenant=tenant, current_state=SoulState.REINCARNATING,
                               soup_taken_at=timezone.now(), **fields)
    ReincarnationService.complete_rebirth(soul=Soul.objects.get(pk=soul.pk), rebirth_continent=continent)
    return Soul.objects.get(pk=soul.pk)


def test_the_last_lifes_fated_date_does_not_follow_into_the_next(cn_tenant):
    soul = _reborn(cn_tenant, fated_death_year=2000, fated_death_month=1, fated_death_day=1)
    assert (soul.fated_death_year, soul.fated_death_month, soul.fated_death_day) == (None, None, None)
    # 不在待发勾魂牒名单上,发牒也拒绝。
    assert not capture.due_souls(Soul.objects.filter(pk=soul.pk)).exists()
    with pytest.raises(capture.CaptureRefused):
        capture.issue(soul)
    # 下一世死亡不再按旧阳寿判枉死。
    assert soul.die(death_date=date.today()).untimely is False


def test_a_fated_date_still_ahead_is_cleared_too(cn_tenant):
    """旧阳寿还没到时最隐蔽:下一世早早死去,会按上一世的生死簿判成枉死。"""
    later = date.today() + timedelta(days=400)
    soul = _reborn(cn_tenant, fated_death_year=later.year, fated_death_month=later.month, fated_death_day=later.day)
    assert soul.fated_death_year is None
    assert soul.die(death_date=date.today()).untimely is False


def test_greek_ferry_passage_and_region_are_cleared():
    gr = Tenant.objects.get_or_create(code="GR_HADES", defaults={"display_name": "Hades"})[0]
    soul = _reborn(gr, ferry_passage="UNBURIED", origin_region="ASIA")
    assert (soul.ferry_passage, soul.origin_region) == ("", "")
    # 拦审读的是灵魂此刻的 ferry_passage:清掉之后下一世的原审不再拦在岸边。
    assert not ferry_barred(soul.die(death_date=date.today()))


def test_the_per_life_european_and_egyptian_facts_are_cleared(cn_tenant):
    # 字段本身与文明无关地存在;暂居他乡的灵魂可能带着它们回到可转世的原属文明。
    soul = _reborn(cn_tenant, duat_passage="NAMELESS", baptism="BAPTISED", denied_immortality=True,
                   neutral_in_life=True)
    assert soul.duat_passage == ""
    assert soul.baptism == Soul.Baptism.UNRECORDED
    assert soul.denied_immortality is None and soul.neutral_in_life is None


@pytest.mark.parametrize("continent, years", [("DONGSHENG", 250), ("NANZHAN", 100), ("XINIU", 500),
                                              ("BEIJULU", 1000)])
def test_a_continent_gives_the_default_lifespan(cn_tenant, continent, years):
    today = timezone.localdate()
    soul = _reborn(cn_tenant, continent=continent, fated_death_year=2000, fated_death_month=1, fated_death_day=1)
    assert (soul.fated_death_year, soul.fated_death_month, soul.fated_death_day) == \
        continent_fated_death(continent, today)
    assert soul.fated_death_year == today.year + years


def test_no_continent_no_default(cn_tenant):
    assert _reborn(cn_tenant).fated_death_year is None


def test_a_leap_day_birth_lands_on_the_28th():
    assert continent_fated_death("NANZHAN", date(2024, 2, 29)) == (2124, 2, 29)  # 2124 闰
    assert continent_fated_death("XINIU", date(2000, 2, 29)) == (2500, 2, 28)  # 2500 整百不整四百,不闰
    assert continent_fated_death("BEIJULU", date(2000, 2, 29)) == (3000, 2, 28)
    assert continent_fated_death("DONGSHENG", date(2000, 2, 29)) == (2250, 2, 28)
    assert continent_fated_death("", date(2000, 1, 1)) is None
