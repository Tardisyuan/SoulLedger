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

from apps.ledger.fungibility import class_for_category
from apps.ledger.models import SoulRecord  # noqa: F401 — re-exported from souls for BC
from apps.ledger.readings import get_civilization_reading
from apps.souls.dates import year_span
from apps.souls.models import Civilization, Soul

LEDGER_CACHE_TTL = 60 * 5  # 5 minutes
DECAY_RATE = 0.01  # per year — the rate for any cosmology not listed below.

# How fast a deed fades, per cosmology.
#
# Be clear about what this table is. Strictly, *no* tradition surveyed here
# attenuates a deed by elapsed time: 功過格 is cumulative and its entries do not
# expire, Buddhist kamma is the one concept in the survey that explicitly does
# not weaken with the years, Plato's is a sentence served rather than a stain
# that fades, and the Catholic practice of denominating indulgences in days was
# abolished in 1967 (Indulgentiarum Doctrina) precisely because the units misled
# people into reading remission as a quantity of time. Decay survives everywhere
# else in this table as a *product* choice — intra-life recency, anchored to the
# soul's death, so that what a person did at 65 weighs more at judgment than
# what they did at 20 (see _get_decay_anchor). That is a defensible thing for
# this system to want. It is not a thing any of these cosmologies asserts.
#
# EUROPEAN is 0.0 not because Dante is uniquely exempt on doctrine, but because
# European is the one place we published a label that denies decay outright. The
# civilization heading now reads 审判与补赎 — judgment and satisfaction, where
# reduction comes from contrition and the act performed, never from elapsed time
# — and it shipped in the same push as a global decay rate that erodes every
# deed by elapsed time and had no civilization branch at all. A label that
# contradicts the arithmetic under it is worse than either alone, and of the two
# it is the arithmetic that was never argued for.
#
# A dict rather than `if civ == EUROPEAN`, so that a cosmology wanting its own
# answer gets an entry rather than a branch.
#
# GREEK HAS NO ENTRY, AND THAT IS THE ANSWER RATHER THAN THE ABSENCE OF ONE.
# This comment used to end by predicting that Plato's thousand-year circuit
# would want a rate of its own — "a sentence with a clock, and whatever number
# that wants, it will not be this one". It wants none. A rate here scales the
# *weight* of a deed by elapsed time, and nothing on the Greek side reads a
# weight: `_greek_reading` counts wrongs (Republic X 615a-b repays tenfold per
# wrong done, and `weight` is this house's own severity scale, not Plato's),
# and `DispositionService._route_greek` reads the verdict alone, because a fork
# has two roads and no depth to grade. An entry would be a rate governing
# nothing, and choosing 0.0 for it would additionally assert that Greek deeds
# do not fade — a doctrine nobody here has argued for, on a mechanic no Greek
# reading consults.
#
# What the missing entry actually does is leave a Greek soul on the shared
# DECAY_RATE for its displayed merit/demerit sums, via `.get(..., DECAY_RATE)`.
# That is deliberate and is the same call `_decay_rate_for` documents for an
# unmapped tenant: decay is a house rule about recency, the sums are raw
# arithmetic true of any ledger, and applying it there attributes nothing to
# Plato. tests/test_greek_sentence_basis.py pins the absence so that filling
# the dict in for symmetry has to be a decision.
CIVILIZATION_DECAY_RATE = {
    Civilization.CHINESE: DECAY_RATE,
    Civilization.EGYPTIAN: DECAY_RATE,
    Civilization.EUROPEAN: 0.0,
}

# Fraction of a life's ledger that follows the soul through the gate.
#
# Merit thins. That number is product-invented — no tradition surveyed puts a
# coefficient on carryover — and it is kept at 0.2 because a rebirth needs to
# feel like a fresh start to be worth playing for.
INHERITANCE_MERIT = 0.2
# Demerit does not thin. Unripened karma carries at full strength: this is not
# a game-balance number, it is the one point Buddhism is unambiguous about —
# kamma that has not yet ripened does not weaken on the way through the gate,
# and *aparāpariya-vedanīya* kamma (effective in any subsequent life) is
# explicitly stated never to lapse while saṃsāra continues.
#
# The symmetric 0.2 this replaces made reincarnation an 80% amnesty on
# everything: a mass murderer's ledger was cut by four fifths by the mere fact
# of dying, and it compounded across cycles (0.2 → 0.04 → 0.008), so three
# lives erased anything at all.
INHERITANCE_DEMERIT = 1.0

# Inheritance presupposes rebirth, and two of the four cosmologies here have
# one. Egyptian judgment ends at Aaru or Ammit; European (Dante) judgment ends
# at Heaven, Hell, or Purgatory-then-Heaven, and Purgatorio empties upward,
# never back into a new life. Held as a set rather than an `if civ == CHINESE`
# so that adding a rebirth-capable civilization is one line.
#
# GREEK IS THAT ONE LINE, AND IT IS THE NORM RATHER THAN THE WHOLE STORY.
# Republic X 615a-b sentences the unjust to a thousand-year circuit and 617d-620d
# then has them choose a new life at the Spindle of Necessity, so rebirth is
# what ordinarily happens to a Greek soul and the set says so. Gorgias 525c
# states an exception in the other direction — those whose wrongs are incurable
# (ἀνίατοι) are made everlasting examples instead — and the owner's ruling is
# that both hold. The exception is not encoded anywhere, here or in
# `DispositionService._route_greek`, because Plato's criterion is curability
# and nothing in this system records anything that bears on it; see that
# method's docstring, and tests/test_greek_sentence_basis.py, which pins the
# gap as a contradiction rather than letting a threshold be invented for it.
#
# For the same reason GREEK is deliberately absent from
# TERMINAL_COSMOLOGY_REASON below: a cosmology cannot be in both, the norm is
# rebirth, and half an entry covering only the incurable would describe a
# population this system cannot pick out.
REBIRTH_CAPABLE_CIVILIZATIONS = frozenset({Civilization.CHINESE, Civilization.GREEK})

# Cosmologies whose routing is bound by 「功過有不可折者」.
#
# 功過格 is a Chinese instrument and the 凡例 limit on 功過相抵 is a limit on a
# Chinese arithmetic. The other two cosmologies here have no offsetting step for
# it to constrain: an Egyptian heart is weighed against the feather with merit
# absent from the scale entirely, and European culpa is retired by absolution
# rather than by a good deed (see apps/ledger/readings.py). A pool split has
# nothing to say about either, so neither is in this set and neither routes any
# differently than it did.
#
# A frozenset rather than `if civ == CHINESE` for the same reason
# REBIRTH_CAPABLE_CIVILIZATIONS is one: whether Plato's thousand-year circuit
# has a non-fungibility rule was a question somebody had to answer on purpose,
# in one place, rather than by discovering which branch of an if-chain it fell
# into.
#
# ANSWERED: GREEK IS NOT IN THIS SET, and for the Egyptian reason rather than
# the European one. 「不可折」 is a limit on 功過相抵, and Republic X has no
# offsetting step for it to limit — 615b requites well-doing "in the same
# measure" on its own road, tenfold like the punishment and in parallel with
# it, so a good deed never discharges any part of the term owed on the other
# road. There is nothing to partition, and `get_unoffset_demerit` accordingly
# returns None for a Greek soul, which `DispositionService._route_greek` does
# not call in the first place.
NON_FUNGIBLE_CIVILIZATIONS = frozenset({Civilization.CHINESE})

# TODO(i18n): the reasons below and `inheritance_note` in
# get_reincarnation_inheritance are user-facing copy hard-coded in the service
# layer, which is the wrong place for it — it cannot be localised, and the
# frontend message catalogues already carry their own (already stale) copies of
# the same sentences. This belongs in the i18n catalogues; a later pass owns
# the copy.
TERMINAL_COSMOLOGY_REASON = {
    Civilization.EGYPTIAN: (
        "Egyptian judgment is terminal: the heart is weighed once and the soul "
        "either enters Aaru or is devoured by Ammit. There is no next life to "
        "inherit into."
    ),
    Civilization.EUROPEAN: (
        "European (Dante) judgment is terminal: Heaven, Hell, or Purgatory and "
        "then Heaven. There is no next life to inherit into."
    ),
}


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

        Uses a fixed non-leap reference year (2001) — this is only used to
        estimate the sub-year fraction of a decay calculation, not to
        validate the date, so leap-day correctness doesn't matter here.
        Falls back to day 183 (~mid-year) when there's no month/day
        precision at all, which is the least-biased guess for a
        year-only historical record.
        """
        if month is None:
            return 183
        return datetime.date(2001, month, day or 15).timetuple().tm_yday

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
        """
        old_merit = soul.merit_score

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
        EventService.log_karma_recalculated(soul, old_merit, soul.merit_score)

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
                    fungibility_class, {"merit": 0.0, "demerit": 0.0}
                )
                if r.record_type == "MERIT":
                    merit += effective_weight
                    pool["merit"] += effective_weight
                else:
                    demerit += effective_weight
                    demerit_count += 1
                    pool["demerit"] += effective_weight

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
                soul.civilization, total_merit, total_demerit, demerit_count,
                class_totals,
            ),
        }

        cache.set(cache_key, result, LEDGER_CACHE_TTL)
        return result

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
            # TODO(i18n): user-facing copy does not belong in the service
            # layer — see TERMINAL_COSMOLOGY_REASON above. Derived from the
            # constants rather than hard-coding "20%" so it can't go stale
            # against them the way the frontend catalogues already have.
            "inheritance_note": (
                f"{INHERITANCE_MERIT:.0%} of effective merit passes to the next "
                f"incarnation; unripened demerit carries in full "
                f"({INHERITANCE_DEMERIT:.0%})."
            ),
        }
