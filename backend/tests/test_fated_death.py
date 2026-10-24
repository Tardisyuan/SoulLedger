"""阳寿核对(2026-10-24 用户决定):地府灵魂死在生死簿所记阳寿之前 = 横死，先入枉死城，到应死日前审判不能认领。"""
from datetime import date, timedelta

import pytest

from apps.judgment import claims
from apps.judgment.claims import ClaimRefusedError
from apps.souls.models import Soul, SoulState

pytestmark = pytest.mark.django_db


def _soul(tenant, fated):
    soul = Soul.objects.create(name="张三", tenant=tenant, current_state=SoulState.ALIVE)
    if fated:
        soul.fated_death_year, soul.fated_death_month, soul.fated_death_day = fated.year, fated.month, fated.day
        soul.save()
    return soul


def test_dying_before_the_fated_date_holds_the_judgment(cn_tenant, judge_user):
    fated = date.today() + timedelta(days=400)
    judgment = _soul(cn_tenant, fated).die(death_date=date.today())
    assert judgment.untimely is True and judgment.held_until == fated
    with pytest.raises(ClaimRefusedError) as refused:
        claims.claim(judgment.pk, judge_user)
    assert refused.value.code == "held_until_fated_date"


def test_no_fated_date_or_a_timely_death_is_judged_as_usual(cn_tenant, judge_user):
    plain = _soul(cn_tenant, None).die(death_date=date.today())
    assert plain.untimely is False and plain.held_until is None
    late = _soul(cn_tenant, date.today() - timedelta(days=1)).die(death_date=date.today())
    assert late.untimely is False
    claims.claim(late.pk, judge_user)


def test_a_held_judgment_cannot_be_concluded_by_any_path(cn_tenant):
    """2026-10-24: before, only claiming checked held_until; an in-process (workflow-driven, by=None) conclude
    went straight through."""
    from apps.judgment.services import JudgmentConclusionService

    judgment = _soul(cn_tenant, date.today() + timedelta(days=30)).die(death_date=date.today())
    with pytest.raises(ClaimRefusedError) as refused:
        JudgmentConclusionService.conclude_judgment(judgment, "PASSED")
    assert refused.value.code == "held_until_fated_date"
