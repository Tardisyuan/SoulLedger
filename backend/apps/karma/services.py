"""
Karma calculation service with time decay and Redis caching.
"""
import math
from datetime import datetime
from django.core.cache import cache
from django.utils import timezone
from apps.souls.models import Soul

KARMA_CACHE_TTL = 60 * 5  # 5 minutes


class KarmaService:
    """
    All karma-related business logic with time decay.
    """

    @staticmethod
    def _get_record_age_years(event_date, recorded_at) -> float:
        """Calculate age in years since event_date or recorded_at."""
        if event_date:
            reference_date = event_date
        else:
            reference_date = recorded_at.date() if hasattr(recorded_at, 'date') else recorded_at
        today = timezone.now().date()
        delta = today - reference_date
        return delta.days / 365.25

    @staticmethod
    def _decay_weight(original_weight: int, years: float) -> float:
        """
        Apply exponential time decay: effective = original × e^(-0.01×years)
        """
        return original_weight * math.exp(-0.01 * years)

    @classmethod
    def recalculate_soul_karma(cls, soul: Soul) -> dict:
        """
        Recalculate merit/demerit totals with time decay from all records.
        Updates soul's denormalised merit/demerit scores.
        """
        records = soul.records.all()

        merit = 0
        demerit = 0

        for r in records:
            years = cls._get_record_age_years(r.event_date, r.recorded_at)
            effective_weight = cls._decay_weight(r.weight, years)

            if r.record_type == "MERIT":
                merit += effective_weight
            elif r.record_type == "DEMERIT":
                demerit += effective_weight

        soul.merit_score = round(merit)
        soul.demerit_score = round(demerit)
        soul.save(update_fields=["merit_score", "demerit_score", "updated_at"])

        # Invalidate cache
        cls._invalidate_cache(soul.id)

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
        cache_key = f"karma:summary:{soul.id}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        records = soul.records.all().order_by("-recorded_at")

        merit = 0
        demerit = 0
        record_summaries = []

        for r in records:
            years = cls._get_record_age_years(r.event_date, r.recorded_at)
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
                "decay_factor": round(math.exp(-0.01 * years), 4),
                "civilization": r.civilization,
                "recorded_at": r.recorded_at.isoformat(),
                "event_date": r.event_date.isoformat() if r.event_date else None,
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

    @staticmethod
    def _invalidate_cache(soul_id):
        """Invalidate karma cache for a soul."""
        cache_key = f"karma:summary:{soul_id}"
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
            "inherited_merit": round(effective["effective_merit"] * 0.2),
            "inherited_demerit": round(effective["effective_demerit"] * 0.2),
            "inheritance_note": "20% of effective karma passes to next incarnation",
        }
