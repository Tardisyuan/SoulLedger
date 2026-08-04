"""
Reincarnation service — executes rebirth cycles.
"""
from apps.disposition.models import Disposition
from apps.karma.services import INHERITANCE_DEMERIT, INHERITANCE_MERIT, KarmaService
from apps.souls.models import Soul, SoulState


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
        2. Apply karma carryover to the soul
        3. If memory reset: clear name/description
        4. Transition soul back to ALIVE with new identity

        Raises KarmaService.RebirthNotApplicable (409) for a soul whose
        cosmology is terminal.
        """
        from django.db import transaction

        from apps.events.services import EventService
        from apps.reincarnation.models import Reincarnation

        # Gate the machinery, not only the reporting endpoint. An Egyptian
        # soul that /karma/inheritance/ correctly refuses to answer for must
        # not still be reincarnatable through this door — Aaru and Ammit are
        # both ends of the road, and so are Heaven and Hell.
        KarmaService.assert_rebirth_capable(soul)

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

            # Apply karma carryover. These were hard-coded 0.2 literals with no
            # import, so the constants moved the *reported* inheritance while
            # the actual rebirth math stayed where it was; they now share one
            # source of truth with KarmaService.get_reincarnation_inheritance.
            # round() rather than the old int(): truncating here while the
            # endpoint rounded meant the two disagreed by one on odd scores.
            soul.merit_score = round(soul.merit_score * INHERITANCE_MERIT)
            soul.demerit_score = round(soul.demerit_score * INHERITANCE_DEMERIT)

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
