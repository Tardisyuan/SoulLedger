"""
Reincarnation service — executes rebirth cycles.
"""
from apps.disposition.models import Disposition
from apps.ledger.services import LedgerService
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
        2. Apply ledger carryover to the soul
        3. If memory reset: clear name/description
        4. Transition soul back to ALIVE with new identity

        Raises LedgerService.RebirthNotApplicable (409) for a soul whose
        cosmology is terminal.
        """
        from django.db import transaction

        from apps.events.services import EventService
        from apps.reincarnation.models import Reincarnation

        # Gate the machinery, not only the reporting endpoint. An Egyptian
        # soul that /ledger/inheritance/ correctly refuses to answer for must
        # not still be reincarnatable through this door — Aaru and Ammit are
        # both ends of the road, and so are Heaven and Hell.
        LedgerService.assert_rebirth_capable(soul)

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

            # Apply ledger carryover. This used to multiply soul.merit_score /
            # soul.demerit_score directly — the *denormalised* fields that
            # only recalculate_soul_ledger writes, refreshed live on every new
            # SoulRecord but otherwise only by the nightly
            # ledger.recalculate_all task. GET /ledger/inheritance/<soul_id>/
            # (get_reincarnation_inheritance) never reads those fields at
            # all; it recomputes from the soul's records every time. The two
            # bases agreed only when the denormalised fields happened to be
            # fresh, so the endpoint could report one carryover number while
            # rebirth quietly applied another.
            #
            # Calling get_reincarnation_inheritance() here instead of
            # re-deriving the same arithmetic makes this the same call the
            # endpoint makes — not just the same inputs, the same function —
            # so there is no way for the two to drift again, including
            # through get_ledger_summary's 5-minute Redis cache: whichever
            # value (fresh or cached) the endpoint would hand back right now
            # is exactly the value applied here. A soul with no records at
            # all inherits 0/0, same as the endpoint would report for it.
            inheritance = LedgerService.get_reincarnation_inheritance(soul)
            soul.merit_score = inheritance["inherited_merit"]
            soul.demerit_score = inheritance["inherited_demerit"]

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
