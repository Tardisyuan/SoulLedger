"""The unburied cross after a hundred years (Aen. 6.325-330; docs/01_希腊冥府整体架构.md §2.3; user 2026-10-28).

"centum errant annos volitantque haec litora circum; / tum demum admissi stagna exoptata revisunt." Only the
unburied: no source gives the fare a term, so NO_FARE waits as before; nor does a soul whose death is not recorded.
The hundred years run from the latest date the recorded death can be (`apps/souls/acheron.py`).
"""
from datetime import date
from types import SimpleNamespace

import pytest

from apps.authentication.models import User
from apps.judgment import claims
from apps.judgment.claims import ClaimRefusedError
from apps.souls import acheron
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from apps.tenants.overview import hall_row
from tests.soul_account_support import officer_client

TODAY = date(2026, 10, 28)


@pytest.fixture
def gr_tenant():
    return Tenant.objects.get_or_create(code="GR_HADES", defaults={"display_name": "Hades"})[0]


@pytest.fixture
def judge(gr_tenant):
    return User.objects.create_user(username="gr_judge", role="JUDGE", tenant=gr_tenant)


def _soul(passage="UNBURIED", year=None, month=None, day=None):
    return SimpleNamespace(ferry_passage=passage, death_year=year, death_month=month, death_day=day)


@pytest.mark.parametrize("death, crossed", [
    ((1926, 10, 28), True),     # a hundred years to the day
    ((1926, 10, 29), False),    # a day short
    ((1926, 10, None), False),  # some day in October 1926: maybe the 31st
    ((1926, 9, None), True),
    ((1926, None, None), False),  # some time in 1926: maybe December
    ((1925, None, None), True),
    ((-399, 5, 7), True),       # Socrates
    ((2000, 1, 1), False),
    ((None, None, None), False),  # no death date: waits
])
def test_the_hundred_years_are_counted_from_the_latest_possible_death(death, crossed):
    assert acheron.crossed(_soul("UNBURIED", *death), TODAY) is crossed


def test_the_fare_has_no_term():
    """Virgil's hundred years are the unburied's (inhumata, 6.325); the obol is Lucian's, with no term."""
    assert acheron.crossed(_soul("NO_FARE", -399, 5, 7), TODAY) is False
    assert acheron.crossed(_soul("", -399, 5, 7), TODAY) is False  # buried: never waited, nothing to cross


@pytest.mark.django_db
@pytest.mark.parametrize("today", [TODAY, date(2026, 12, 31), date(2026, 2, 28), date(2026, 10, 31)])
def test_the_queryset_reader_agrees_with_the_one_soul_reader(gr_tenant, today):
    deaths = [(y, m, d) for y in (1925, 1926, 1927) for m, d in
              ((None, None), (2, None), (2, 28), (10, None), (10, 28), (10, 31), (12, None), (12, 31))]
    deaths += [(None, None, None), (-399, 5, 7)]
    souls = [Soul.all_objects.create(name=f"s{i}", tenant=gr_tenant, ferry_passage="UNBURIED",
                                     death_year=y, death_month=m, death_day=d)
             for i, (y, m, d) in enumerate(deaths)]
    souls.append(Soul.all_objects.create(name="fare", tenant=gr_tenant, ferry_passage="NO_FARE", death_year=-399))
    by_q = set(Soul.all_objects.filter(pk__in=[s.pk for s in souls]).filter(acheron.crossed_q(today))
               .values_list("pk", flat=True))
    by_soul = {s.pk for s in souls if acheron.crossed(s, today)}
    assert by_q == by_soul
    assert by_soul  # the grid has souls on both sides
    assert len(by_soul) < len(souls)


def _died(tenant, passage, year, month=None, day=None):
    """Dies today (which opens the case), then the death is re-dated to `year` as an officer would record it."""
    soul = Soul.objects.create(name="Elpenor", tenant=tenant, current_state=SoulState.ALIVE, ferry_passage=passage)
    case = soul.die(death_date=date.today())
    Soul.all_objects.filter(pk=soul.pk).update(death_year=year, death_month=month, death_day=day)
    case.soul.refresh_from_db()
    return soul, case


@pytest.mark.django_db
def test_an_unburied_soul_a_century_dead_is_heard(gr_tenant, judge, admin_user):
    soul, case = _died(gr_tenant, "UNBURIED", 1850, 3, 1)
    assert hall_row(gr_tenant)["judgments"]["held"] == 0
    assert hall_row(gr_tenant)["judgments"]["unclaimed"] == 1
    res = officer_client(admin_user).get(f"/api/v1/souls/{soul.pk}/")
    assert res.status_code == 200 and res.data["ferry_century_passed"] is True, res.data
    assert res.data["ferry_passage"] == "UNBURIED"  # the record stands; only the wait is over
    claims.claim(case.pk, judge)


@pytest.mark.django_db
@pytest.mark.parametrize("passage, year", [
    ("UNBURIED", date.today().year - 50),  # not yet a hundred years
    ("UNBURIED", None),                    # no death date
    ("NO_FARE", 1850),                     # the fare has no term
])
def test_the_rest_still_wait_on_the_bank(gr_tenant, judge, admin_user, passage, year):
    soul, case = _died(gr_tenant, passage, year)
    with pytest.raises(ClaimRefusedError) as refused:
        claims.claim(case.pk, judge)
    assert refused.value.code == "unferried"
    with pytest.raises(ClaimRefusedError):
        case.conclude("PASSED")
    assert hall_row(gr_tenant)["judgments"]["held"] == 1
    res = officer_client(admin_user).get(f"/api/v1/souls/{soul.pk}/")
    assert res.data["ferry_century_passed"] is False, res.data
