"""
Ledger calculation service with time decay and Redis caching.

Named "ledger", not "karma", because that is what the mechanic actually is:
every deed carries a signed point value and the totals net off against each
other. That is the Ming-Qing 功过格 — the ledgers of merit and demerit behind
袁黃《了凡四訓》 — and it is specifically *not* karma in the Buddhist sense,
where good and bad deeds do not cancel but ripen separately. "Karma" also
misdescribed the decay applied below: karma is the one concept in the survey
that emphatically does not fade with time, whereas a merit ledger scored
against the vantage point of a life's end plainly does.
"""
import datetime
import math

from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import APIException

# 常量住在 `apps/ledger/constants.py`,这里重导出。
#
# 它们本来占这个文件的 220 行 —— 而每个数字下面的论证比数字长得多。
# 拆走的是「这些数从哪来」,留下的是「拿这些数算什么」。
#
# **重导出是为了不动既有 import**,不是说常量住在这里。
from apps.ledger.constants import (  # noqa: F401
    CIVILIZATION_DECAY_RATE,
    DECAY_RATE,
    INHERITANCE_DEMERIT,
    INHERITANCE_MERIT,
    LEDGER_CACHE_TTL,
    NON_FUNGIBLE_CIVILIZATIONS,
    REBIRTH_CAPABLE_CIVILIZATIONS,
    TERMINAL_COSMOLOGY_REASON,
)
from apps.ledger.fungibility import class_for_category, granularity_of
from apps.ledger.models import SoulRecord  # noqa: F401 — re-exported from souls for BC
from apps.ledger.readings import get_civilization_reading
from apps.souls.dates import year_span
from apps.souls.models import Soul


class RebirthNotApplicable(APIException):
    """The soul's cosmology has no next life, so inheritance is meaningless.

    409 rather than 404: the soul exists and reads back perfectly well, it is
    the *operation* that its cosmology does not permit. Returning a number here
    would be a well-formed answer to a question the cosmology forbids asking.

    Subclasses DRF's APIException so that any DRF view raising it — including
    the reincarnation viewset, which has no handler of its own — answers 409
    rather than 500.
    """

    status_code = status.HTTP_409_CONFLICT
    default_code = "REBIRTH_NOT_APPLICABLE"

    def __init__(self, soul: Soul):
        civilization = str(soul.civilization)
        super().__init__({
            "code": self.default_code,
            "civilization": civilization,
            "detail": TERMINAL_COSMOLOGY_REASON.get(
                soul.civilization,
                f"{civilization} judgment is terminal; there is no next life "
                f"to inherit into.",
            ),
        })


class LedgerService:
    """
    All ledger-related business logic with time decay.
    """

    @staticmethod
    def _day_of_year(month, day) -> int:
        """Ordinal day-of-year for a (possibly partial) month/day.

        The reference year must be a LEAP year. This used to say 2001 and
        explain that "leap-day correctness doesn't matter here" because the
        result only estimates a sub-year fraction. That reasoning is about the
        *output*; the problem is the *input*. `datetime.date(2001, 2, 29)`
        raises ValueError, and February 29th is a date this project accepts:
        `apps/souls/dates.py::validate_historical_date` checks month length
        with `calendar.monthrange` against the real year, so 2020-02-29 passes
        validation and is stored.

        What followed, measured 2026-08-29:

            validate_historical_date(2020, 2, 29)  -> accepted
            SoulRecord with event date 2020-02-29  -> ValueError: day is out of
                                                      range for month
            Soul with death 2020-02-29             -> same

        and the death-date case is unrecoverable: the decay anchor is
        recomputed on every call, so balance, effective ledger, inheritance,
        recalculate and `next_pending` all raise for that soul forever, and
        every later SoulRecord write on it does too. `recalculate_tenant` dies
        mid-iteration and abandons the rest of that tenant's fan-out.

        2004 is a leap year, so every (month, day) the validator admits can be
        constructed. The ordinal for dates after February differs by one from
        the 2001 answer; that shift is uniform across both ends of every
        subtraction this feeds, and it is a fraction-of-a-year estimate either
        way.

        Falls back to day 183 (~mid-year) when there's no month/day precision
        at all, which is the least-biased guess for a year-only historical
        record.
        """
        if month is None:
            return 183
        return datetime.date(2004, month, day or 15).timetuple().tm_yday

    @staticmethod
    def _get_decay_anchor(soul: Soul) -> tuple:
        """The date this soul's ledger stops moving — what decay measures *to*.

        A life's deeds are weighed against each other from the vantage point of
        that life's end, not of the observer's calendar. Measuring to today
        made decay a function of how long ago the *civilization* was rather
        than of anything the soul did: at DECAY_RATE = 0.01 a 612 BCE deed
        retains 3.5e-12 of its weight, so every ancient soul scored 0 merit and
        0 demerit, and disposition/services.py's `karma >= 0` then routed it
        straight to heaven. Decay did not make old souls weightless, it made
        them saints.

        Anchored to death, the same rate expresses the only thing decay was
        ever for — recency *within* a life — and a soul who lived seventy years
        gets the identical gradient whether it died in 612 BCE or 2020 CE.
        Scores also stop drifting under the nightly recalculate task, so a
        verdict rendered in 2020 can still be re-derived in 2026.

        Living souls (death_year is None) keep measuring to today. That is
        correct for them: their story is still running.

        A soul whose current_state says dead but which carries no death year
        lands in the same branch and measures to today. That fallback is
        deliberate, not incidental — we have no anchor, and inventing one (the
        judgment date, the record's own timestamp) would bake a fabricated date
        into every score derived from it. Today is at least the old, known
        behaviour.
        """
        if soul.death_year is not None:
            return soul.death_year, soul.death_month, soul.death_day
        today = timezone.now().date()
        return today.year, today.month, today.day

    @staticmethod
    def _get_record_age_years(event_year, event_month, event_day, recorded_at, anchor) -> float:
        """
        Years from the record's event date — or recorded_at, if no event date
        was given — to ``anchor``. See _get_decay_anchor for what the anchor is.

        event_year/month/day follow the historical (no year 0) convention
        from apps.souls.dates — a negative year is BCE. The whole-year part
        of the span accounts for the missing year 0 (e.g. 612 BCE to 2 CE is
        613 years, not 614); the fractional part is estimated from day-of-year
        so decay still moves smoothly day-to-day for a living soul.

        Never returns a negative span. A deed dated after the anchor is either
        a data error or a posthumous record, and e^(-r·y) with a negative y
        *amplifies* a weight instead of decaying it — a deed 50 years after
        death would count 1.65× its original. Decay may reduce a deed's weight;
        it must never inflate it, so the span is clamped at 0 and the decay
        factor can never exceed 1.0.
        """
        anchor_year, anchor_month, anchor_day = anchor

        if event_year is None:
            # No event date on the record — fall back to when it was written
            # down, as before. recorded_at is always a CE timestamp, but the
            # anchor may well be BCE, so route it through the same year_span
            # path rather than subtracting two datetime.dates (which cannot
            # represent a BCE anchor at all).
            reference = recorded_at.date() if hasattr(recorded_at, 'date') else recorded_at
            event_year, event_month, event_day = reference.year, reference.month, reference.day

        whole_years = year_span(event_year, anchor_year)
        fraction = (
            LedgerService._day_of_year(anchor_month, anchor_day)
            - LedgerService._day_of_year(event_month, event_day)
        ) / 365.25
        return max(0.0, whole_years + fraction)

    @staticmethod
    def _decay_rate_for(soul: Soul) -> float:
        """This soul's per-year decay rate. See CIVILIZATION_DECAY_RATE.

        An unmapped cosmology — including UNKNOWN_CIVILIZATION, which
        `Soul.civilization` returns for a misconfigured tenant — keeps the
        shared DECAY_RATE. Unlike the *reading* of a ledger, which is a claim
        about what a cosmology says and so must not be guessed at, the decay
        rate is a house rule about recency that applies to any ledger. Leaving
        it at the default is not attributing a doctrine to anyone.
        """
        return CIVILIZATION_DECAY_RATE.get(soul.civilization, DECAY_RATE)

    @staticmethod
    def _decay_weight(original_weight: int, years: float, rate: float = DECAY_RATE) -> float:
        """
        Apply exponential time decay: effective = original × e^(-rate×years).

        rate comes from _decay_rate_for. At rate 0.0 the factor is exactly 1.0
        and a deed keeps its original weight for good.
        """
        return original_weight * math.exp(-rate * years)

    @classmethod
    def recalculate_soul_ledger(cls, soul: Soul) -> dict:
        """
        Recalculate merit/demerit totals with time decay from all records.
        Updates soul's denormalised merit/demerit scores.

        THE LOCK IS THE POINT. This is a read-modify-write over every record a
        soul has, and it is triggered from two places at once:
        `apps/souls/record_models.py` on every record insert, and
        `LedgerRecalculateView.post`. It had no `select_for_update`, no
        `atomic()` and no version column; `grep select_for_update apps/ledger
        apps/judgment` matched nothing.

        Measured on a PostgreSQL 16 clone of the shared box (`zz_audit_probe`,
        dropped afterwards, original verified untouched):

            baseline merit_score = 10
            records committed (weights): [10, 100, 1000]  raw sum = 1110
            STORED merit_score left by two concurrent writers: 1010
            TRUTH  from a clean re-run:                        1110
            >>> LOST UPDATE: True

        `merit_score`/`demerit_score` are the denormalised columns the whole
        system routes and sorts on -- **a score silently too low changes which
        court a soul is sent to.** Nothing detects it; only a later recalculation
        repairs it, by accident.

        `ATOMIC_REQUESTS` is not set, so in production the INSERT/SELECT/UPDATE
        were three separate autocommitted statements. Interleaving differently
        does not make the defect different.

        The lock is taken on the `Soul` row before the records are summed, so
        two recalculations of the same soul serialise. `select_for_update` needs
        a transaction, hence the `atomic()`. **SQLite serialises writers
        anyway**, so this suite cannot reproduce the race -- see
        `tests/test_ledger_recalculation_is_serialised.py` for what is testable
        here and what is not.
        """
        from django.db import transaction

        with transaction.atomic():
            # Re-read under the lock. The caller's `soul` may be a stale copy
            # read before another writer committed, and summing records is only
            # half the job -- the row this writes back to has to be the one it
            # locked.
            soul = Soul.all_objects.select_for_update().get(pk=soul.pk)
            old_merit = soul.merit_score
            old_demerit = soul.demerit_score

            records = soul.records.all()
            anchor = cls._get_decay_anchor(soul)
            rate = cls._decay_rate_for(soul)

            merit = 0
            demerit = 0

            for r in records:
                years = cls._get_record_age_years(
                    r.event_year, r.event_month, r.event_day, r.recorded_at, anchor
                )
                effective_weight = cls._decay_weight(r.weight, years, rate)

                if r.record_type == "MERIT":
                    merit += effective_weight
                elif r.record_type == "DEMERIT":
                    demerit += effective_weight

            soul.merit_score = round(merit)
            soul.demerit_score = round(demerit)
            soul.save(update_fields=["merit_score", "demerit_score", "update_time"])

        # Invalidate cache
        cls._invalidate_cache(soul)

        # Log domain event
        from apps.events.services import EventService
        EventService.log_karma_recalculated(
            soul,
            old_merit,
            soul.merit_score,
            old_demerit=old_demerit,
            new_demerit=soul.demerit_score,
        )

        return {
            "soul_id": str(soul.id),
            "merit_score": soul.merit_score,
            "demerit_score": soul.demerit_score,
            "karmic_balance": soul.merit_score - soul.demerit_score,
        }

    @classmethod
    def get_ledger_summary(cls, soul: Soul) -> dict:
        """
        Return full ledger summary with time decay for a soul.
        Cached in Redis for LEDGER_CACHE_TTL seconds.
        """
        tenant_code = soul.tenant.code if soul.tenant else "global"
        # Renamed from "karma:summary:..." along with the rest of the app. No
        # invalidation pass is needed for the old keys: nothing reads or writes
        # them any more, and LEDGER_CACHE_TTL is five minutes, so they are
        # orphaned for one TTL and then gone.
        cache_key = f"ledger:summary:{tenant_code}:{soul.id}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        records = soul.records.all().order_by("-recorded_at")
        anchor = cls._get_decay_anchor(soul)
        rate = cls._decay_rate_for(soul)

        merit = 0
        demerit = 0
        # Both record counts, because two readings are reckoned in deeds rather
        # than in weight: the European one qualifies culpa with how many wrongs
        # produced it, and the Greek one counts each road's deeds because
        # Republic X repays tenfold *per deed done*. `merit_count` is the
        # symmetric half of that and was missing, which is why the Greek reading
        # could describe only the road to the left.
        merit_count = 0
        demerit_count = 0
        record_summaries = []
        # Merit and demerit again, split by which pool the deed falls in, so
        # the reading can apply 「功過有不可折者」 — a hundred merits of spent
        # cash do not discharge the hundred faults of a killing. Accumulated
        # from the same unrounded `effective_weight` as the totals above, for
        # the reason spelled out below: a total is not the sum of its displayed
        # parts. See apps/ledger/fungibility.py.
        class_totals = {}

        for r in records:
            years = cls._get_record_age_years(
                r.event_year, r.event_month, r.event_day, r.recorded_at, anchor
            )
            effective_weight = cls._decay_weight(r.weight, years, rate)
            # Round for display only, and accumulate the unrounded value.
            #
            # Two decimal places is the right precision to *show* a decayed
            # weight; it is the wrong precision to add up. Rounding each
            # record before accumulating buries a ±0.005 error per record in
            # the total, and this endpoint's total is compared against
            # soul.merit_score, which recalculate_soul_ledger derives by
            # accumulating unrounded and rounding once. Twenty-five deeds of
            # weight 1 at two years' decay is 24.5050 accumulated exactly and
            # 24.5000 accumulated from rounded parts — 25 and 24 after the
            # final round. The same soul's score, one point apart, depending
            # on which function you asked.
            #
            # A total is not the sum of the displayed parts, so the displayed
            # parts do not get to define it. The per-record figure below is
            # unchanged; only the total moves, onto the same definition the
            # denormalised field already uses.
            displayed_weight = round(effective_weight, 2)

            # Only MERIT and DEMERIT open a pool. JUDGMENT and DISPOSITION
            # records score nothing, and giving them an all-zero class would
            # put empty rows in the reading that look like a classification
            # somebody made.
            fungibility_class = class_for_category(r.category)
            if r.record_type in ("MERIT", "DEMERIT"):
                pool = class_totals.setdefault(
                    fungibility_class,
                    {
                        "merit": 0.0, "demerit": 0.0,
                        # 零積不抵整發 needs to know which part of each total was
                        # earned or incurred 一次 — at one stroke — and which was
                        # reached over several occasions. A pool that carries
                        # only two sums cannot say, which is why the rule could
                        # not be applied before these buckets existed: by the
                        # time `offset_within_classes` sees a class the records
                        # are gone. See `granularity_of` below for what puts a
                        # record in which bucket, and why "unknown" is a bucket
                        # rather than a default.
                        "merit_by_grain": {"lump": 0.0, "scattered": 0.0, "unknown": 0.0},
                        "demerit_by_grain": {"lump": 0.0, "scattered": 0.0, "unknown": 0.0},
                    },
                )
                grain = granularity_of(r)
                if r.record_type == "MERIT":
                    merit += effective_weight
                    merit_count += 1
                    pool["merit"] += effective_weight
                    pool["merit_by_grain"][grain] += effective_weight
                else:
                    demerit += effective_weight
                    demerit_count += 1
                    pool["demerit"] += effective_weight
                    pool["demerit_by_grain"][grain] += effective_weight

            record_summaries.append({
                "id": str(r.id),
                "type": r.record_type,
                "category": r.category,
                # Which pool this deed can be offset against — derived from
                # `category`, never stored. Present on every record so the
                # classification behind `reading.non_fungible` is visible
                # rather than being an unexplained per-class total.
                "fungibility_class": fungibility_class,
                "description": r.description,
                "original_weight": r.weight,
                "effective_weight": displayed_weight,
                "years_elapsed": round(years, 2),
                "decay_factor": round(math.exp(-rate * years), 4),
                "civilization": r.civilization,
                "recorded_at": r.recorded_at.isoformat(),
                # Structured {year, month, day} rather than an ISO string —
                # event_year can be negative (BCE) and month/day are often
                # unknown for ancient records. See apps.souls.dates.
                "event_date": (
                    {"year": r.event_year, "month": r.event_month, "day": r.event_day}
                    if r.event_year is not None else None
                ),
                # The deed that defines the life. Stored per record but absent
                # from this payload, so the only consumer of ledger records had
                # no way to tell a defining deed from an ordinary one.
                "is_milestone": r.is_milestone,
            })

        total_merit = round(merit)
        total_demerit = round(demerit)
        result = {
            "soul_id": str(soul.id),
            "soul_name": soul.name,
            "merit_score": total_merit,
            "demerit_score": total_demerit,
            # Unchanged, and deliberately so. It is the Chinese reading served
            # to everyone, but it is also a Soul property the souls app owns and
            # a column expression querysets filter and order by in SQL, which is
            # why it cannot become pool-aware without disagreeing with itself —
            # see get_unoffset_demerit below and apps/ledger/fungibility.py.
            # `reading` below adds the instrument each cosmology actually uses,
            # and routing now reads that instrument rather than this number;
            # retiring this one is still a separate and much larger change.
            "karmic_balance": total_merit - total_demerit,
            "record_count": records.count(),
            "records": record_summaries,
            # What this soul's own cosmology reads off the ledger above — a
            # balance, a threshold, a guilt-and-penalty pair, or an explicit
            # refusal for an unmapped tenant. Clients switch on `kind`; see
            # apps/ledger/readings.py for why one shape for all of them was
            # wrong.
            "reading": get_civilization_reading(
                soul.civilization, total_merit, total_demerit,
                # Keyword, not positional. Two adjacent ints whose names are the
                # only thing telling them apart is exactly the argument pair a
                # future edit transposes in silence.
                merit_count=merit_count, demerit_count=demerit_count,
                class_totals=class_totals,
                term_start=cls._term_start_for(soul),
            ),
        }

        cache.set(cache_key, result, LEDGER_CACHE_TTL)
        return result

    @classmethod
    def _term_start_for(cls, soul: Soul):
        """This soul's term start as a (year, month, day) triple, or all None.

        WHICH DISPOSITION. A soul accumulates one per circuit — Republic X's
        souls come back, and so do Diyu's — so "the" disposition is the most
        recent live one, which is the row whose term the soul is serving or
        last served. Soft-deleted and archived rows are excluded: both are
        states an operator put a row in to take it out of the working set, and
        reading a term start off a row somebody archived would let a withdrawn
        record go on driving a number on the screen.

        `all_objects` rather than `objects`, filtered explicitly. Disposition's
        default manager is the tenant manager, whose `get_queryset` adds
        `is_deleted=False` and nothing else (apps/tenants/managers.py says so
        in its own docstring), so the two differ only in that this spells out
        what it is excluding. The tenant scope here is the soul: a disposition
        reached through `soul=soul` belongs to whatever tenant that soul does,
        and the caller has already decided it may see this soul.

        Returns the all-None triple rather than None for a soul with no
        disposition, so that `sentence_elapsed_years` sees the same shape in
        every case and there is one absent path instead of two.

        STALENESS. `get_ledger_summary` caches for LEDGER_CACHE_TTL, and
        nothing invalidates that cache when a disposition is written. So a term
        start recorded now can take up to five minutes to reach the reading —
        the same window every other figure in this payload already has, and the
        figure it feeds is measured in years.
        """
        from apps.disposition.models import Disposition

        disposition = (
            Disposition.all_objects
            .filter(soul=soul, is_deleted=False, is_archived=False)
            .order_by("-created_at")
            .values_list("term_start_year", "term_start_month", "term_start_day")
            .first()
        )
        return disposition if disposition is not None else (None, None, None)

    @classmethod
    def get_unoffset_demerit(cls, soul: Soul) -> float | None:
        """Fault that no merit of its own kind could discharge — or None.

        This is the routing-layer half of 「功過有不可折者」. `get_ledger_summary`
        already computes the figure and reports it inside
        `reading["non_fungible"]`; this is the accessor for callers that need to
        *act* on it rather than display it, and today that means
        `DispositionService._route_chinese` picking a court.

        Returns None — not 0 — in the two cases where this system has no
        partitioned reading to offer, because 0 is a claim ("nothing stands
        against this soul") and None is the absence of one:

        * The soul's cosmology is not in NON_FUNGIBLE_CIVILIZATIONS. 功過格 does
          not govern an Egyptian weighing or a Latin culpa, and handing either
          a number derived from it would apply the Chinese rule to somebody
          else's afterlife — the exact flattening apps/ledger/readings.py
          exists to refuse.
        * The ledger holds no MERIT or DEMERIT records to partition. A caller
          that cannot say where the points came from gets no claim about
          fungibility rather than a fabricated one, which is the same
          discipline `_chinese_reading` applies when `class_totals` is None.

          In production the two answers coincide: merit_score and demerit_score
          are read-only through the API and are only ever written by
          `recalculate_soul_ledger`, which derives them from those same
          records, so a soul with no scored records also has a balance of 0 and
          would route to the floor either way. They diverge only for a soul
          whose denormalised scores were set by something other than its
          records — a fixture, a data migration, a direct ORM write. For that
          soul the denormalised score is what `karmic_balance` says and what
          the rest of the system displays, and refusing to overrule it with a
          partition we were unable to compute is the conservative answer.
        """
        if soul.civilization not in NON_FUNGIBLE_CIVILIZATIONS:
            return None
        non_fungible = cls.get_ledger_summary(soul)["reading"].get("non_fungible")
        if not non_fungible or not non_fungible["by_class"]:
            return None
        return non_fungible["unoffset_demerit"]

    @classmethod
    def _invalidate_cache(cls, soul: Soul):
        """Invalidate ledger cache for a soul (tenant-namespaced)."""
        tenant_code = soul.tenant.code if soul.tenant else "global"
        cache_key = f"ledger:summary:{tenant_code}:{soul.id}"
        cache.delete(cache_key)

    @classmethod
    def get_effective_ledger(cls, soul: Soul) -> dict:
        """
        Returns the effective ledger with time decay applied.
        Used for reincarnation inheritance calculation.
        """
        summary = cls.get_ledger_summary(soul)
        return {
            "soul_id": str(soul.id),
            "effective_merit": summary["merit_score"],
            "effective_demerit": summary["demerit_score"],
            "effective_balance": summary["karmic_balance"],
        }

    @classmethod
    def assert_rebirth_capable(cls, soul: Soul) -> None:
        """Raise RebirthNotApplicable unless this soul's cosmology has a next life.

        The single gate for both the reporting endpoint and the reincarnation
        service, so the API cannot answer "no rebirth here" while the rebirth
        machinery quietly goes ahead anyway.
        """
        if soul.civilization not in REBIRTH_CAPABLE_CIVILIZATIONS:
            raise RebirthNotApplicable(soul)

    @classmethod
    def get_reincarnation_inheritance(cls, soul: Soul) -> dict:
        """
        Calculate what the ledger passes to the next life:
        merit × INHERITANCE_MERIT, demerit × INHERITANCE_DEMERIT.

        Raises RebirthNotApplicable (409) for a terminal cosmology.
        """
        cls.assert_rebirth_capable(soul)
        effective = cls.get_effective_ledger(soul)
        return {
            "soul_id": str(soul.id),
            "inherited_merit": round(effective["effective_merit"] * INHERITANCE_MERIT),
            "inherited_demerit": round(effective["effective_demerit"] * INHERITANCE_DEMERIT),
            # The rates themselves, not a sentence about them. This replaced an
            # `inheritance_note` string — see the RESOLVED(i18n) note on
            # TERMINAL_COSMOLOGY_REASON above for why that one moved out and the
            # 409 `detail` did not.
            #
            # Fractions rather than the 20/100 percentages the card draws with,
            # because these ARE the constants: shipping the same float the
            # arithmetic two lines up used makes it impossible for the displayed
            # rate and the applied rate to disagree, which is exactly what
            # happened while the frontend kept its own literals. Formatting a
            # fraction as a percentage is the display layer's job and it has a
            # locale to do it in; this layer has neither.
            "inheritance_merit_rate": INHERITANCE_MERIT,
            "inheritance_demerit_rate": INHERITANCE_DEMERIT,
        }
