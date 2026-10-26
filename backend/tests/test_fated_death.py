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


def test_a_fated_date_the_death_check_cannot_compare_is_refused_on_entry(cn_tenant, admin_user):
    """Review #6 (2026-10-27): a BCE or year-only fated date was accepted and then silently ignored by `Soul.die`."""
    from tests.soul_account_support import officer_client

    soul = _soul(cn_tenant, None)
    client = officer_client(admin_user)
    url = f"/api/v1/souls/{soul.pk}/"
    for value in ({"year": -200, "month": 3, "day": 1}, {"year": 2030, "month": None, "day": None}):
        res = client.patch(url, {"fated_death_date": value}, format="json")
        assert res.status_code == 400 and "fated_death_date" in res.data, res.data
    assert client.patch(url, {"fated_death_date": "2030-03-01"}, format="json").status_code == 200
    assert client.patch(url, {"fated_death_date": None}, format="json").status_code == 200


def test_a_case_opened_by_hand_for_a_living_soul_is_held_too(cn_tenant, admin_user, judge_user):
    """Review #7 (2026-10-27): `POST /judgment/` for an ALIVE soul skipped 枉死城. (A second open case stays allowed
    for ADMIN — user decision 2026-09-12, tests/test_admin_is_exempt_from_the_case_state_rules.py.)"""
    from tests.soul_account_support import officer_client

    fated = date.today() + timedelta(days=400)
    soul = _soul(cn_tenant, fated)
    client = officer_client(admin_user)
    res = client.post("/api/v1/judgment/", {"soul": str(soul.pk), "court": "第一殿"}, format="json")
    assert res.status_code == 201, res.data
    from apps.judgment.models import Judgment

    judgment = Judgment.all_objects.get(pk=res.data["id"])
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
