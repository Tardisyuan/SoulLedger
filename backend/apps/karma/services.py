"""
Karma calculation service.
"""
from apps.souls.models import Soul


class KarmaService:
    """
    All karma-related business logic.
    """

    @staticmethod
    def recalculate_soul_karma(soul: Soul) -> dict:
        """
        Recalculate merit/demerit totals from all records and update soul.
        Returns the new balance summary.
        """
        records = soul.records.all()

        merit = sum(r.weight for r in records if r.record_type == "MERIT")
        demerit = sum(r.weight for r in records if r.record_type == "DEMERIT")

        soul.merit_score = merit
        soul.demerit_score = demerit
        soul.save(update_fields=["merit_score", "demerit_score", "updated_at"])

        return {
            "soul_id": str(soul.id),
            "merit_score": merit,
            "demerit_score": demerit,
            "karmic_balance": merit - demerit,
        }

    @staticmethod
    def get_karmic_summary(soul: Soul) -> dict:
        """Return full karma summary for a soul."""
        records = soul.records.all().order_by("-recorded_at")

        return {
            "soul_id": str(soul.id),
            "soul_name": soul.name,
            "merit_score": soul.merit_score,
            "demerit_score": soul.demerit_score,
            "karmic_balance": soul.karmic_balance,
            "record_count": records.count(),
            "records": [
                {
                    "id": str(r.id),
                    "type": r.record_type,
                    "description": r.description,
                    "weight": r.weight,
                    "civilization": r.civilization,
                    "recorded_at": r.recorded_at.isoformat(),
                }
                for r in records
            ],
        }
