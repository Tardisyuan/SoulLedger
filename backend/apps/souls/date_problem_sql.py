"""``?has_date_problem=`` as SQL: the same rules as ``dates.check_soul_dates`` and
``dates.check_record_date``, spelled as Q objects so the filter is one query
instead of a walk over every soul in the tenant.

``_ordered`` mirrors ``dates.compare_historical_dates``: two triples are only
separated by a month when BOTH months are known, and by a day when BOTH days
are known. A NULL on either side makes the SQL comparison NULL (not true), which
is exactly "cannot be separated at this precision".
``apps/souls/tests/test_date_problem_sql.py`` holds the Python walk as the
oracle and compares the two.
"""
from django.db.models import (
    Case,
    CharField,
    Count,
    Exists,
    ExpressionWrapper,
    F,
    IntegerField,
    OuterRef,
    Q,
    Subquery,
    Value,
    When,
)
from django.db.models.functions import Cast, Coalesce, Concat

from apps.souls.dates import MAX_PLAUSIBLE_LIFESPAN_YEARS


def _ordered(left, right, op) -> Q:
    """``left <op> right`` for (year, month, day) triples; op is ``lt`` or ``gt``.

    ``left`` is three field names, ``right`` three expressions (F / OuterRef).
    """
    (ly, lm, ld), (ry, rm, rd) = left, right
    return Q(**{f"{ly}__{op}": ry}) | (
        Q(**{ly: ry})
        & (
            Q(**{f"{lm}__{op}": rm})
            | (Q(**{lm: rm}) & Q(**{f"{ld}__{op}": rd}))
        )
    )


def _triple(prefix, wrap=F):
    return tuple(wrap(f"{prefix}_{part}") for part in ("year", "month", "day"))


def _names(prefix):
    return tuple(f"{prefix}_{part}" for part in ("year", "month", "day"))


def _one_if(q):
    return Case(When(q, then=Value(1)), default=Value(0), output_field=IntegerField())


def _fingerprint(event_prefix, death):
    """SQL twin of ``dates.date_warning_fingerprint`` (None renders as "None")."""
    def part(expr):
        return Coalesce(Cast(expr, CharField()), Value("None"))

    ey, em, ed = (part(F(f"{event_prefix}_{p}")) for p in ("year", "month", "day"))
    dy, dm, dd = (part(x) for x in death)
    return Concat(ey, Value("-"), em, Value("-"), ed, Value("|"), dy, Value("-"), dm, Value("-"), dd,
                  output_field=CharField())


def filter_has_date_problem(queryset, value):
    """``queryset`` narrowed to souls with (value=True) / without an unresolved problem."""
    from apps.reincarnation.models import Reincarnation
    from apps.souls.record_models import SoulRecord

    birth = _triple("birth")
    # ---- the soul's own two dates (check_soul_dates)
    both = Q(birth_year__isnull=False, death_year__isnull=False)
    cross_era = Q(birth_year__lt=0, death_year__gt=0) | Q(birth_year__gt=0, death_year__lt=0)
    # whole_years_between: minus one when the "anniversary" has not come round
    anniversary_missed = Q(birth_month__isnull=False, death_month__isnull=False) & (
        Q(birth_month__gt=F("death_month"))
        | (Q(birth_month=F("death_month")) & Q(birth_day__isnull=False, death_day__isnull=False)
           & Q(birth_day__gt=F("death_day")))
    )
    span = ExpressionWrapper(
        F("death_year") - F("birth_year") - _one_if(cross_era) - _one_if(anniversary_missed),
        output_field=IntegerField(),
    )
    soul_problem = both & (
        _ordered(_names("death"), birth, "lt") | Q(_dp_span__gt=MAX_PLAUSIBLE_LIFESPAN_YEARS)
    )

    # ---- this life's records (check_record_date), outermost soul via OuterRef
    o_birth, o_death = _triple("birth", OuterRef), _triple("death", OuterRef)
    life_index = Coalesce(
        Subquery(
            Reincarnation.objects.filter(soul=OuterRef("soul")).order_by()
            .values("soul").annotate(n=Count("pk")).values("n"),
            output_field=IntegerField(),
        ),
        Value(0),
    )
    event = _names("event")
    # A NULL on either side makes a comparison NULL, i.e. not true: "unknown" never flags.
    before_birth = _ordered(event, o_birth, "lt")
    after_death = _ordered(event, o_death, "gt")
    records = (
        SoulRecord.objects.filter(soul=OuterRef("pk"), event_year__isnull=False)
        .alias(_dp_life=life_index, _dp_fp=_fingerprint("event", o_death))
        .filter(cycle=F("_dp_life"))
        .filter(before_birth | (after_death & ~Q(date_warning_ack_fingerprint=F("_dp_fp"))))
    )

    flagged = Q(soul_problem) | Q(Exists(records))
    matched = queryset.alias(_dp_span=span).filter(flagged)
    return matched if value else queryset.exclude(pk__in=matched.values("pk"))

