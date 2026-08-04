"""
Karma calculation service with time decay and Redis caching.
"""
import datetime
import math

from django.core.cache import cache
from django.utils import timezone

from apps.karma.models import SoulRecord  # noqa: F401 — re-exported from souls for BC
from apps.souls.dates import year_span
from apps.souls.models import Soul

KARMA_CACHE_TTL = 60 * 5  # 5 minutes
INHERITANCE_FACTOR = 0.2
DECAY_RATE = 0.01  # per year


class KarmaService:
    """
    All karma-related business logic with time decay.
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
    def _get_record_age_years(event_year, event_month, event_day, recorded_at) -> float:
        """
        Calculate age in years since the record's event date, or
        recorded_at if no event date was given.

        event_year/month/day follow the historical (no year 0) convention
        from apps.souls.dates — a negative year is BCE. The whole-year part
        of the span accounts for the missing year 0 (e.g. 612 BCE to 2026 CE
        is 2637 years, not 2638); the fractional part is estimated from
        day-of-year so decay still moves smoothly day-to-day.
        """
        today = timezone.now().date()
        if event_year is not None:
            whole_years = year_span(event_year, today.year)
            fraction = (today.timetuple().tm_yday - KarmaService._day_of_year(event_month, event_day)) / 365.25
            return whole_years + fraction
        reference_date = recorded_at.date() if hasattr(recorded_at, 'date') else recorded_at
        delta = today - reference_date
        return delta.days / 365.25

    @staticmethod
    def _decay_weight(original_weight: int, years: float) -> float:
        """
        Apply exponential time decay: effective = original × e^(-0.01×years)
        """
        return original_weight * math.exp(-DECAY_RATE * years)

    @classmethod
    def recalculate_soul_karma(cls, soul: Soul) -> dict:
        """
        Recalculate merit/demerit totals with time decay from all records.
        Updates soul's denormalised merit/demerit scores.
        """
        old_merit = soul.merit_score

        records = soul.records.all()

        merit = 0
        demerit = 0

        for r in records:
            years = cls._get_record_age_years(r.event_year, r.event_month, r.event_day, r.recorded_at)
            effective_weight = cls._decay_weight(r.weight, years)

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
    def get_karmic_summary(cls, soul: Soul) -> dict:
        """
        Return full karma summary with time decay for a soul.
        Cached in Redis for KARMA_CACHE_TTL seconds.
        """
        tenant_code = soul.tenant.code if soul.tenant else "global"
        cache_key = f"karma:summary:{tenant_code}:{soul.id}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        records = soul.records.all().order_by("-recorded_at")

        merit = 0
        demerit = 0
        record_summaries = []

        for r in records:
            years = cls._get_record_age_years(r.event_year, r.event_month, r.event_day, r.recorded_at)
            effective_weight = cls._decay_weight(r.weight, years)
            effective_weight = round(effective_weight, 2)

            if r.record_type == "MERIT":
                merit += effective_weight
            elif r.record_type == "DEMERIT":
                demerit += effective_weight

            record_summaries.append({
                "id": str(r.id),
                "type": r.record_type,
                "category": r.category,
                "description": r.description,
                "original_weight": r.weight,
                "effective_weight": effective_weight,
                "years_elapsed": round(years, 2),
                "decay_factor": round(math.exp(-DECAY_RATE * years), 4),
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
                # from this payload, so the only consumer of karma records had
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
            "karmic_balance": total_merit - total_demerit,
            "record_count": records.count(),
            "records": record_summaries,
        }

        cache.set(cache_key, result, KARMA_CACHE_TTL)
        return result

    @classmethod
    def _invalidate_cache(cls, soul: Soul):
        """Invalidate karma cache for a soul (tenant-namespaced)."""
        tenant_code = soul.tenant.code if soul.tenant else "global"
        cache_key = f"karma:summary:{tenant_code}:{soul.id}"
        cache.delete(cache_key)

    @classmethod
    def get_effective_karma(cls, soul: Soul) -> dict:
        """
        Returns effective karma with time decay applied.
        Used for reincarnation inheritance calculation.
        """
        summary = cls.get_karmic_summary(soul)
        return {
            "soul_id": str(soul.id),
            "effective_merit": summary["merit_score"],
            "effective_demerit": summary["demerit_score"],
            "effective_balance": summary["karmic_balance"],
        }

    @classmethod
    def get_reincarnation_inheritance(cls, soul: Soul) -> dict:
        """
        Calculate what karma is passed to next life.
        Per spec: merit_score × 0.2, demerit_score × 0.2
        """
        effective = cls.get_effective_karma(soul)
        return {
            "soul_id": str(soul.id),
            "inherited_merit": round(effective["effective_merit"] * INHERITANCE_FACTOR),
            "inherited_demerit": round(effective["effective_demerit"] * INHERITANCE_FACTOR),
            "inheritance_note": "20% of effective karma passes to next incarnation",
        }
