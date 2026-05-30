"""
Event logging service.
"""
from apps.souls.models import Soul


class EventService:
    """
    Centralised audit logging for all soul-related events.
    """

    @staticmethod
    def log(soul: Soul, event_type: str, payload: dict, actor: str = "system") -> None:
        from apps.events.models import SoulEvent
        SoulEvent.objects.create(
            tenant=soul.tenant,
            soul=soul,
            event_type=event_type,
            payload=payload,
            actor=actor,
        )

    @staticmethod
    def log_soul_created(soul: Soul, actor: str = "system") -> None:
        EventService.log(soul, "SOUL_CREATED", {
            "name": soul.name,
            "civilization": soul.civilization,
            "birth_date": str(soul.birth_date) if soul.birth_date else None,
        }, actor)

    @staticmethod
    def log_soul_state_change(
        soul: Soul, old_state: str, new_state: str, reason: str, actor: str = "system"
    ) -> None:
        EventService.log(soul, "STATE_CHANGED", {
            "old_state": old_state,
            "new_state": new_state,
            "reason": reason,
        }, actor)

    @staticmethod
    def log_disposition_created(disposition, actor: str = "system") -> None:
        EventService.log(disposition.soul, "DISPOSITION_CREATED", {
            "disposition_id": str(disposition.id),
            "realm": disposition.destination_realm.realm_code if disposition.destination_realm else None,
            "is_eternal": disposition.is_eternal,
        }, actor)

    @staticmethod
    def log_judgment_concluded(judgment, actor: str = "system") -> None:
        court_code = None
        if hasattr(judgment, 'court') and judgment.court:
            court_code = judgment.court.code if hasattr(judgment.court, 'code') else str(judgment.court)
        EventService.log(judgment.soul, "JUDGMENT_CONCLUDED", {
            "judgment_id": str(judgment.id),
            "verdict": judgment.verdict,
            "court": court_code,
        }, actor)

    @staticmethod
    def log_karma_recalculated(soul, old_score: int, new_score: int, actor: str = "system") -> None:
        EventService.log(soul, "KARMA_RECALCULATED", {
            "old_score": old_score,
            "new_score": new_score,
            "delta": new_score - old_score,
        }, actor)

    @staticmethod
    def log_reincarnation_triggered(reincarnation, actor: str = "system") -> None:
        EventService.log(reincarnation.soul, "REINCARNATION_TRIGGERED", {
            "reincarnation_id": str(reincarnation.id),
            "new_identity": reincarnation.new_identity if hasattr(reincarnation, 'new_identity') else None,
        }, actor)


# Alias for backward compatibility
log_soul_state_change = EventService.log_soul_state_change
log_disposition_created = EventService.log_disposition_created
