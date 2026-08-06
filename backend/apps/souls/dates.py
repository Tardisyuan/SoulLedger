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
from typing import NamedTuple

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


# ----------------------------------------------------------------------
# Cross-date sanity rules.
#
# Everything above this line validates one date on its own: is it a real
# calendar date. Nothing above it can tell you that a soul died before it
# was born, because that only becomes visible when you look at two dates
# together.
#
# This mattered less when ledger decay measured from a deed to *today*.
# A soul mis-dated to antiquity scored 3.5e-12 and its ledger visibly
# collapsed, which was ugly but was at least a signal. Decay is now
# anchored to the soul's own death (see LedgerService._get_decay_anchor),
# which is correct — a 68-year life yields the same factors whether it
# ended in 612 BCE or 1958 CE — and the side effect is that the ledger
# looks perfectly healthy no matter how wrong the dates are. The signal
# has to be rebuilt on purpose, so here it is.
#
# What these rules catch, and what they do not
# --------------------------------------------
# They catch a date being in the wrong era *when the error is partial*,
# which is the realistic way it happens — someone moves one date and not
# the others:
#
#   - birth moved, death left behind (or the reverse) -> a 511-year
#     lifespan, which is `implausible_lifespan`
#   - the soul moved, its records left behind -> `event_before_birth` by
#     four centuries
#   - the records moved, the soul left behind -> the same rule, or
#     `event_after_death` by a wide margin
#
# They do NOT catch a soul whose birth, death and every record were all
# shifted into the same wrong era together. That soul is internally
# consistent: a 68-year life with its deeds spread sensibly through it,
# and every rule above passes. It is also exactly the case the ledger can
# no longer flag, since death-anchored decay gives that soul the same
# factors it would have had in the right era.
#
# This is a real gap and it is not closeable from the data alone. Nothing
# inside the row says which era is right — that fact lives in the sources
# the soul was transcribed from, and it is not in this database. Two
# things that look like they might close it do not:
#
#   - Civilization is not an era. Chinese and European souls exist in
#     every century; only the Egyptian tenant has any prior towards
#     antiquity, and that is an observation about this deployment's
#     content rather than about history.
#   - Cohort outliers ("every other soul in this tenant is 16th century")
#     are a statistical hint, not a rule. A ledger of the dead spans all
#     of history by construction, so the outlier is as likely to be the
#     one correct row as the one wrong one.
#
# Naming the gap is more useful than a rule that appears to close it.
# ----------------------------------------------------------------------

ERROR = "error"
WARNING = "warning"


class DateProblem(NamedTuple):
    """One thing wrong with a set of dates.

    ``severity`` is ERROR (the dates cannot all be right, refuse the write)
    or WARNING (unusual but legitimately possible, report it and let it
    through). ``code`` is stable and machine-readable; ``message`` is aimed
    at whoever has to go and look at the record.

    ``acknowledged`` is only ever True for a WARNING an operator has
    reviewed and dismissed for the *current* pair of dates — see
    ``date_warning_fingerprint`` below. It defaults False, so every caller
    that builds a ``DateProblem`` without knowing about acknowledgment
    (the management command, the reject-on-write path, every existing
    test) keeps working unchanged.
    """

    severity: str
    code: str
    message: str
    acknowledged: bool = False


# The longest life this system will accept without complaint.
#
# A PRODUCT DECISION, not a fact. The longest verified human life is Jeanne
# Calment's 122 years, and 150 leaves generous headroom above it for the
# poorly-attested ages that ancient sources routinely report — long enough
# that no real record here should ever hit it, short enough that the errors
# this rule exists to catch cannot hide under it. Those errors are
# century-scale: a transposed year, a soul entered in the wrong era, a
# European date left in the 20th century after the rest of its cohort moved
# back to the 1500s. All of them overshoot 150 by an order of magnitude.
#
# It is deliberately not a mythological bound. Souls here are people who
# lived; the cosmology starts at their death. If this deployment ever needs
# to record Methuselah, raise the number and say so here — do not quietly
# widen it to make one awkward row saveable.
MAX_PLAUSIBLE_LIFESPAN_YEARS = 150


def format_historical_date(year, month, day) -> str:
    """Human-readable date for an error message: "612 BCE", "1943-05-02 CE"."""
    if year is None:
        return "unset"
    era = "BCE" if year < 0 else "CE"
    text = str(abs(year))
    if month is not None:
        text += f"-{month:02d}"
        if day is not None:
            text += f"-{day:02d}"
    return f"{text} {era}"


def compare_historical_dates(a, b) -> int:
    """Order two (year, month, day) triples: -1 if a < b, 1 if a > b, else 0.

    Ordering signed years is ordinary integer comparison — the missing year
    0 shifts no year's position in the sequence, it only shortens the
    distance across the boundary (that is ``year_span``'s problem, not
    this function's).

    Returns 0 when the two dates cannot be separated at the precision
    available: same year but either month unknown, or same month but either
    day unknown. That is the conservative answer on purpose. These
    comparisons decide whether to reject a write, and "born some time in
    1943, died some time in 1943" is not evidence that anything is wrong.
    """
    ay, am, ad = a
    by, bm, bd = b
    if ay != by:
        return -1 if ay < by else 1
    if am is None or bm is None:
        return 0
    if am != bm:
        return -1 if am < bm else 1
    if ad is None or bd is None:
        return 0
    if ad != bd:
        return -1 if ad < bd else 1
    return 0


def lifespan_years(birth, death):
    """Whole years lived, or None if either end is unknown.

    ``birth``/``death`` are (year, month, day) triples. Spans go through
    ``year_span`` so the missing year 0 is accounted for: 612 BCE to 580
    BCE is 32 years, and 50 BCE to 10 CE is 59, not 60.

    Subtracts a year when the birthday had not come round again in the year
    of death, the ordinary way an age is counted. Unknown months or days
    mean no subtraction, so the answer is an upper bound accurate to within
    a year — ample for a rule whose threshold is 150.

    May be negative, which is how a caller learns the two dates are in the
    wrong order.
    """
    birth_year, birth_month, birth_day = birth
    death_year, death_month, death_day = death
    if birth_year is None or death_year is None:
        return None
    span = year_span(birth_year, death_year)
    # Same arbitrary year on both sides so only month/day decide the order.
    # (Year 1, not year 0 — the latter does not exist in this convention and
    # would be rejected anywhere else in this module.)
    if compare_historical_dates((1, birth_month, birth_day), (1, death_month, death_day)) > 0:
        span -= 1
    return span


def check_soul_dates(birth, death) -> list[DateProblem]:
    """Sanity-check a soul's own two dates against each other.

    ``birth``/``death`` are (year, month, day) triples; either may be all
    None, which is fine and common — a living soul has no death date, and
    an ancient one often has no birth date anyone recorded.
    """
    problems = []
    if birth[0] is None or death[0] is None:
        return problems

    if compare_historical_dates(death, birth) < 0:
        # No degrees here: whatever else is true, these two dates cannot
        # both be right. Report it and stop — the lifespan below would be
        # negative and would only restate the same fact in bigger numbers.
        problems.append(DateProblem(
            ERROR,
            "death_before_birth",
            f"death date {format_historical_date(*death)} is before birth date "
            f"{format_historical_date(*birth)}. A soul cannot die before it is born, "
            f"so one of the two dates is wrong.",
        ))
        return problems

    span = lifespan_years(birth, death)
    if span is not None and span > MAX_PLAUSIBLE_LIFESPAN_YEARS:
        problems.append(DateProblem(
            ERROR,
            "implausible_lifespan",
            f"birth {format_historical_date(*birth)} to death "
            f"{format_historical_date(*death)} is a lifespan of {span} years, beyond the "
            f"{MAX_PLAUSIBLE_LIFESPAN_YEARS}-year sanity bound. Check both years — a "
            f"lifespan this long is far more likely a wrong era or a transposed year "
            f"than a fact.",
        ))
    return problems


def date_warning_fingerprint(event, death) -> str:
    """Stable fingerprint of the two values that decide ``event_after_death``.

    That warning is a pure function of exactly two things: this record's
    event date and its soul's death date. Nothing else can make it appear
    or disappear. So a fingerprint of just those two triples is enough to
    tell, later, whether an acknowledgment still applies — if either date
    has moved since, the fingerprint changes and the old acknowledgment no
    longer describes the pair of dates in front of it.

    Not a cryptographic hash on purpose: a plain delimited encoding is
    just as collision-free here (the inputs are small bounded integers,
    not attacker-controlled blobs) and it stays legible in a database
    shell, which matters more for a field whose whole job is "does this
    still match".
    """
    ey, em, ed = event
    dy, dm, dd = death
    return f"{ey}-{em}-{ed}|{dy}-{dm}-{dd}"


def check_record_date(event, birth, death, *, ack_fingerprint: str | None = None) -> list[DateProblem]:
    """Sanity-check a record's event date against the soul it belongs to.

    ``event`` may be all None — a record with no event date at all is
    legitimate and common for ancient sources, and nothing here requires
    one.

    Before birth is an ERROR: a record is evidence about this soul, and
    there is no soul yet to be evidence about.

    After death is only a WARNING, because posthumous records are real.
    A judgment is entered after the death that occasioned it; a deed can
    surface in the sources centuries later; a disposition is by definition
    after the fact. The decay code already takes this position —
    ``LedgerService._get_record_age_years`` clamps a post-anchor span to
    zero rather than treating it as impossible — and turning a case the
    ledger deliberately tolerates into a rejected write would be a
    contradiction, not a tightening. It is still worth surfacing: a deed
    dated after its doer's death is *sometimes* posthumous and *sometimes*
    a typo, and only a person looking at the record can tell which.

    ``ack_fingerprint`` is the caller's stored
    ``SoulRecord.date_warning_ack_fingerprint`` (or None if never
    acknowledged). When it matches ``date_warning_fingerprint(event,
    death)`` for *this* check, the ``event_after_death`` problem — if any —
    comes back with ``acknowledged=True``. It is still returned, not
    dropped: suppressing it here would let a caller that does not
    understand acknowledgment (the management command, older code) draw
    the wrong conclusion. The caller decides what "acknowledged" should
    mean for its audience.
    """
    problems = []
    if event[0] is None:
        return problems

    if birth[0] is not None and compare_historical_dates(event, birth) < 0:
        problems.append(DateProblem(
            ERROR,
            "event_before_birth",
            f"event date {format_historical_date(*event)} is before the soul's birth "
            f"({format_historical_date(*birth)}). A record cannot predate the soul it "
            f"belongs to — check the event year, or the soul's birth year.",
        ))

    if death[0] is not None and compare_historical_dates(event, death) > 0:
        years = year_span(death[0], event[0])
        acknowledged = (
            ack_fingerprint is not None
            and ack_fingerprint == date_warning_fingerprint(event, death)
        )
        problems.append(DateProblem(
            WARNING,
            "event_after_death",
            f"event date {format_historical_date(*event)} is {years} year(s) after the "
            f"soul's death ({format_historical_date(*death)}). Legitimate for a "
            f"posthumous record; check it is not a mis-typed year.",
            acknowledged=acknowledged,
        ))
    return problems
