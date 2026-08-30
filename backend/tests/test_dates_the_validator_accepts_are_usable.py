"""Every date `validate_historical_date` accepts must survive the whole system.

`apps/souls/dates.py` is the project's date authority. Two consumers disagreed
with it, in different ways, and both were unrecoverable rather than cosmetic.

**February 29th bricked a soul.** `LedgerService._day_of_year` built
`datetime.date(2001, month, day)`, and 2001 is not a leap year. The validator
uses `calendar.monthrange` against the *real* year, so 2020-02-29 passes and
is stored. The decay anchor is recomputed on every call, so balance, effective
ledger, inheritance, recalculate and `next_pending` raised for that soul
forever, and every later SoulRecord write on it did too. The docstring said
"leap-day correctness doesn't matter here" -- reasoning about the output while
the problem was the input.

**A BCE death date was overwritten with today.** `Soul.transition_to` tested
`not locked_soul.death_date`, a legacy compatibility property whose
`to_legacy_date` returns None for anything `datetime.date` cannot express --
every BCE year, and every partial date. Measured: a soul stored with
death_year=-399, month=5, day=7 had its date rewritten to 2026-08-29 by one
transition to JUDGING. Nothing was missing; the date was complete. Egyptian and
Greek material is BCE by nature, and the ledger's decay baseline is the death
date, so the baseline moved with it.

These are parametrized over the shapes the validator admits rather than over
the two that were reported, because "the validator and its consumers agree" is
the property, and picking the two known cases would leave the next
disagreement to be found the same way.
"""
import pytest

from apps.souls.dates import validate_historical_date
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

# Shapes `validate_historical_date` accepts. Each is a case some consumer has
# to be able to handle; the two marked were the ones that broke.
ACCEPTED_DATES = [
    (2020, 2, 29),    # leap day -- broke _day_of_year
    (2024, 2, 29),
    (-399, 5, 7),     # BCE, complete -- broke transition_to
    (-1200, 1, 1),
    (1888, 11, 2),
    (1543, None, None),   # year only
    (2020, 6, None),      # year and month
    (1, 1, 1),
    (-1, 12, 31),         # 1 BCE. Year 0 is deliberately absent -- the
                          # validator rejects it, because there is no year
                          # between 1 BCE and 1 CE. My first draft of this list
                          # had (0, 3, 15) in it on an assumption I had not
                          # checked; the validator said so.
]


@pytest.mark.parametrize("year,month,day", ACCEPTED_DATES)
def test_the_validator_accepts_these(year, month, day):
    """The premise. If this fails the rest of the file is measuring nothing."""
    # It raises rather than returning findings -- checked, not assumed.
    validate_historical_date(year, month, day)


def test_year_zero_is_still_rejected():
    """The list above is "what the validator accepts". This pins its edge.

    Without this, someone widening `ACCEPTED_DATES` to include year 0 would
    make the parametrized tests fail and the obvious fix would be to make the
    validator accept it.
    """
    with pytest.raises(ValueError, match="year 0"):
        validate_historical_date(0, 3, 15)


@pytest.mark.parametrize("year,month,day", ACCEPTED_DATES)
def test_the_decay_anchor_can_be_computed_for_every_accepted_date(year, month, day):
    """`_day_of_year` must handle every (month, day) the validator admits."""
    from apps.ledger.services import LedgerService

    ordinal = LedgerService._day_of_year(month, day)
    assert 1 <= ordinal <= 366, f"{(month, day)} -> {ordinal}"


@pytest.mark.django_db
@pytest.mark.parametrize("year,month,day", ACCEPTED_DATES)
def test_a_soul_with_this_death_date_keeps_it_through_judgment(year, month, day):
    """The transition must not rewrite a date it merely cannot render."""
    tenant = Tenant.objects.get_or_create(
        code="DV_T", defaults={"display_name": "Dates"}
    )[0]
    soul = Soul.objects.create(
        name=f"Soul{year}_{month}_{day}",
        current_state=SoulState.ALIVE,
        tenant=tenant,
        death_year=year, death_month=month, death_day=day,
    )
    assert soul.transition_to(SoulState.JUDGING, "test") is True
    soul.refresh_from_db()
    assert (soul.death_year, soul.death_month, soul.death_day) == (year, month, day), (
        f"the recorded death date changed to "
        f"{(soul.death_year, soul.death_month, soul.death_day)}. "
        f"`death_date` is a legacy property that returns None for anything "
        f"datetime.date cannot express; testing it reads 'unrepresentable' as "
        f"'absent'."
    )


@pytest.mark.django_db
def test_a_soul_with_no_death_date_still_gets_one_at_judgment():
    """Positive control: the branch that fills in a missing date must survive.

    Making the test above pass by never writing a death date at all would be
    the obvious wrong fix, and only this catches it.
    """
    tenant = Tenant.objects.get_or_create(
        code="DV_T2", defaults={"display_name": "Dates2"}
    )[0]
    soul = Soul.objects.create(
        name="NoDeathDate", current_state=SoulState.ALIVE, tenant=tenant,
    )
    assert soul.death_year is None
    assert soul.transition_to(SoulState.JUDGING, "test") is True
    soul.refresh_from_db()
    assert soul.death_year is not None, (
        "a soul that died with no recorded date should get today's"
    )


@pytest.mark.django_db
def test_a_leap_day_soul_can_have_its_ledger_read():
    """End to end: the shape that bricked a soul permanently."""
    from apps.ledger.services import LedgerService

    tenant = Tenant.objects.get_or_create(
        code="DV_T3", defaults={"display_name": "Dates3"}
    )[0]
    soul = Soul.objects.create(
        name="LeapSoul", current_state=SoulState.JUDGING, tenant=tenant,
        death_year=2020, death_month=2, death_day=29,
    )
    summary = LedgerService.get_ledger_summary(soul)
    assert summary is not None, (
        "the ledger could not be summarised for a soul whose death date the "
        "validator accepts -- every read path on this soul raised, forever"
    )
