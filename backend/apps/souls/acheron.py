"""The unburied cross after a hundred years (Aen. 6.325-330; docs/01_希腊冥府整体架构.md §2.3; user 2026-10-28).

Charon ferries only the buried; the unburied wander the bank of Acheron a hundred years, then are taken across
("centum errant annos volitantque haec litora circum; / tum demum admissi stagna exoptata revisunt", 6.329-330).
Virgil's passage is about the unburied (inhumata, 6.325) and nothing else, and docs §2.3 gives the fare no
term: a soul with NO_FARE waits as before. Nor does a soul whose death date is not recorded.

The hundred years run from the LATEST date the recorded death can be: an unknown month counts as December, an
unknown day as the month's last. So a soul is let across only once a hundred years have certainly passed.
Two readers of one rule — `crossed` for one soul, `crossed_q` for a queryset (`apps/tenants/overview.py`);
`tests/test_greek_unburied_cross_after_a_century.py` holds them to the same answer.
"""
import calendar
import datetime

from django.db.models import Q

from apps.souls.dates import whole_years_between

YEARS = 100
UNBURIED = "UNBURIED"


def _month_length(month: int) -> int:
    # Leap years do not matter here: February's latest day only decides on 28 vs 29 Feb, and 29 is the safe side.
    return calendar.monthrange(2000, month)[1]


def crossed(soul, today: datetime.date) -> bool:
    """True when an UNBURIED soul has certainly waited a hundred years since its death."""
    if soul.ferry_passage != UNBURIED or soul.death_year is None:
        return False
    month = soul.death_month or 12
    day = soul.death_day or _month_length(month)
    return whole_years_between((soul.death_year, month, day), (today.year, today.month, today.day)) >= YEARS


def crossed_q(today: datetime.date, prefix: str = "") -> Q:
    """`crossed` as a filter on Soul (`prefix` e.g. "soul__" from Judgment).

    The latest possible death is on or before (today.year - 100, today.month, today.day). today.year - 100 is
    a CE year for as long as this code runs, so no year-0 correction is needed.
    """
    def f(**kw):
        return Q(**{prefix + k: v for k, v in kw.items()})

    year, month, day = today.year - YEARS, today.month, today.day
    same_year = f(death_month__lt=month) | f(death_month=month, death_day__lte=day)
    if _month_length(month) <= day:
        same_year |= f(death_month=month, death_day__isnull=True)
    if (month, day) == (12, 31):
        same_year |= f(death_month__isnull=True)
    return f(ferry_passage=UNBURIED) & (f(death_year__lt=year) | (f(death_year=year) & same_year))


def crosses_on(soul) -> datetime.date | None:
    """The first day `crossed` is true for this soul (the soul App shows it, 2026-10-29). None when the soul
    does not cross this way (NO_FARE, buried), the death year is unknown, or the day fell before 1 CE."""
    if soul.ferry_passage != UNBURIED or soul.death_year is None:
        return None
    month = soul.death_month or 12
    day = soul.death_day or _month_length(month)
    # There is no year 0: a hundred years after 50 BCE (-50) is 51 CE.
    year = soul.death_year + YEARS + (1 if soul.death_year < 0 <= soul.death_year + YEARS else 0)
    if year < 1:
        return None
    on = datetime.date(year, month, min(day, calendar.monthrange(year, month)[1]))
    # Step to the exact first day `crossed` agrees with (29 Feb, an unknown day): one reader of the rule, not two.
    while not crossed(soul, on):
        on += datetime.timedelta(days=1)
    return on
