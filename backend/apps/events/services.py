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


# Alias for backward compatibility
log_soul_state_change = EventService.log_soul_state_change
log_disposition_created = EventService.log_disposition_created
