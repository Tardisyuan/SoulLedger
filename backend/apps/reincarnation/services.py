"""
Reincarnation service — executes rebirth cycles.
"""
from apps.souls.models import Soul, SoulState
from apps.disposition.models import Disposition


class ReincarnationService:
    """
    Handles reincarnation execution and rebirth completion.
    """

    @staticmethod
    def execute(disposition: Disposition) -> bool:
        """
        Trigger reincarnation from a disposition.
        Disposition must be executed first via DispositionService.execute().
        """
        disposition.soul.transition_to(
            SoulState.REINCARNATING,
            f"Reincarnation triggered from disposition {disposition.id}"
        )
        # Log domain event
        from apps.events.services import EventService
        from apps.reincarnation.models import Reincarnation
        # The reincarnation record is created in complete_rebirth, log with disposition info
        EventService.log(disposition.soul, "REINCARNATION_TRIGGERED", {
            "disposition_id": str(disposition.id),
            "destination_realm": disposition.destination_realm.realm_code if disposition.destination_realm else None,
        })
        return True

    @staticmethod
    def complete_rebirth(
        soul: Soul,
        disposition: Disposition = None,
        new_identity: str = "",
        rebirth_form: str = "HUMAN",
        notes: str = "",
    ):
        """
        Complete a reincarnation cycle:
        1. Create Reincarnation record
        2. Reset karma on soul
        3. If memory reset: clear name/description
        4. Transition soul back to ALIVE with new identity
        """
        from django.db import transaction
        from apps.reincarnation.models import Reincarnation
        from apps.events.services import EventService

        # Determine target realm from disposition
        target_realm = ""
        previous_realm = ""
        if disposition and disposition.destination_realm:
            target_realm = disposition.destination_realm.realm_code
            previous_realm = disposition.destination_realm.realm_code

        # Count previous cycles
        cycle_count = soul.reincarnations.count() + 1

        with transaction.atomic():
            # Create reincarnation record
            reincarnation = Reincarnation.objects.create(
                soul=soul,
                disposition=disposition,
                target_realm=target_realm,
                rebirth_form=rebirth_form,
                cycle_count=cycle_count,
                previous_realm=previous_realm,
                new_identity=new_identity or soul.name,
                notes=notes,
            )

            # Memory reset
            if disposition and disposition.memory_reset != "NONE":
                # Partial reset: keep birth_name, clear description
                soul.description = ""

            # Apply karma carryover (reduce scores by 80% for next life)
            soul.merit_score = int(soul.merit_score * 0.2)
            soul.demerit_score = int(soul.demerit_score * 0.2)

            # Reset soul to ALIVE with new identity
            soul.name = new_identity or soul.name
            soul.birth_name = soul.birth_name or new_identity
            soul.death_date = None
            soul.origin_location = ""
            soul.save()

            soul.transition_to(SoulState.ALIVE, f"Rebirth complete (cycle {cycle_count})")

        EventService.log(
            soul,
            "REINCARNATION_COMPLETED",
            {
                "reincarnation_id": str(reincarnation.id),
                "cycle_count": cycle_count,
                "new_identity": new_identity or soul.name,
                "rebirth_form": rebirth_form,
            }
        )

        return reincarnation
