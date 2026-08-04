"""
Helpers for BC-aware historical dates.

Ancient dates (a soul born in 612 BCE, an event recorded in the Duat in
3000 BCE) cannot be stored in ``django.db.models.DateField`` — Postgres
supports "0612-03-15 BC" natively, but ``datetime.date`` has
``MINYEAR = 1`` and blows up the moment psycopg tries to hand the row
back to Python. So instead of one DateField we store three plain
integers: ``<prefix>_year`` / ``<prefix>_month`` / ``<prefix>_day``.

Year convention — signed, historical (proleptic), **no year 0**:
    -612  -> "612 BCE"
     1    -> "1 CE"
    year == 0 is invalid and rejected.

This matches how people actually write history ("612 BC"), unlike ISO
8601 astronomical year numbering (which would use 0 for 1 BCE and shift
everything else by one). The lack of a year 0 means naive subtraction
across the BCE/CE boundary is off by one — see ``year_span`` below.

Precision is year-level by default; month/day are optional (most ancient
records only carry a year). ``month``/``day`` still use the ordinary
1-12 / 1-31 (calendar-aware) ranges — this module treats them as
proleptic Gregorian for the purposes of leap-year validation, which is
already an approximation for pre-Gregorian eras and is treated as such.
"""
import calendar
import datetime
import re

_LEGACY_STR_RE = re.compile(r"^(-?\d{1,6})-(\d{1,2})-(\d{1,2})$")


def _astronomical_year(year: int) -> int:
    """Historical (no year 0) -> astronomical (0 = 1 BCE) numbering.

    Only used internally for leap-year math (``calendar`` assumes
    astronomical numbering, where every 4th year including "year 0" is
    a leap year).
    """
    return year + 1 if year < 0 else year


def validate_historical_date(year, month, day) -> None:
    """Raise ValueError if (year, month, day) is not a sane historical date.

    ``month``/``day`` may be None (lower precision); ``year`` may be
    None only if month/day are also both None.
    """
    if year is None:
        if month is not None or day is not None:
            raise ValueError("month/day require a year")
        return
    if not isinstance(year, int) or isinstance(year, bool):
        raise ValueError(f"year must be an integer, got {year!r}")
    if year == 0:
        raise ValueError(
            "year 0 does not exist — there is no year between 1 BCE and 1 CE. "
            "Use signed years instead, e.g. -1 = 1 BCE, -612 = 612 BCE."
        )
    if month is None:
        if day is not None:
            raise ValueError("day requires month")
        return
    if not isinstance(month, int) or isinstance(month, bool) or not (1 <= month <= 12):
        raise ValueError(f"month must be between 1 and 12, got {month!r}")
    if day is None:
        return
    max_day = calendar.monthrange(_astronomical_year(year), month)[1]
    if not isinstance(day, int) or isinstance(day, bool) or not (1 <= day <= max_day):
        raise ValueError(f"day must be between 1 and {max_day} for month {month}, got {day!r}")


def parse_historical_date(value):
    """Parse a legacy or BC-capable date value into a (year, month, day) tuple.

    Accepts:
      - None / "" -> (None, None, None)
      - datetime.date / datetime.datetime -> exact (year, month, day)
        (always CE, since Python dates can't represent BCE)
      - "YYYY-MM-DD" or "-YYYY-MM-DD" string (back-compat with clients that
        only ever sent plain ISO dates, plus a signed extension for BCE)
      - dict {"year": int, "month": int|None, "day": int|None}
      - (year, month, day) tuple/list

    Raises ValueError on malformed input or an invalid calendar date.
    """
    if value is None or value == "":
        return None, None, None

    if isinstance(value, datetime.date | datetime.datetime):
        year, month, day = value.year, value.month, value.day

    elif isinstance(value, dict):
        year = value.get("year")
        month = value.get("month")
        day = value.get("day")

    elif isinstance(value, list | tuple):
        if len(value) != 3:
            raise ValueError(f"expected [year, month, day], got {value!r}")
        year, month, day = value

    elif isinstance(value, str):
        m = _LEGACY_STR_RE.match(value.strip())
        if not m:
            raise ValueError(f"unrecognised date string: {value!r}")
        year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))

    else:
        raise ValueError(f"unsupported date value: {value!r}")

    validate_historical_date(year, month, day)
    return year, month, day


def to_representation(year, month, day):
    """Structured API output for a historical date, or None if unset."""
    if year is None:
        return None
    return {"year": year, "month": month, "day": day}


def to_legacy_date(year, month, day):
    """Best-effort ``datetime.date`` for callers that predate BC support.

    Returns None when the date can't be represented as a Python date:
    unset, BCE (year < 1), or missing month/day precision.
    """
    if year is None or year < 1 or month is None or day is None:
        return None
    try:
        return datetime.date(year, month, day)
    except ValueError:
        return None


def year_span(from_year: int, to_year: int) -> int:
    """Whole years between two historical (no-year-0) years, ``to - from``.

    Both same era: ordinary subtraction. Crossing the BCE/CE boundary
    subtracts one extra year because there is no year 0 — e.g. 612 BCE
    (-612) to 2026 CE is 2637 years, not 2638.
    """
    if (from_year < 0) != (to_year < 0):
        return to_year - from_year - 1
    return to_year - from_year
