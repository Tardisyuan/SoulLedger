"""
Reincarnation service — executes rebirth cycles.
"""
from apps.disposition.models import Disposition
from apps.ledger.services import LedgerService
from apps.souls.models import Soul, SoulState


class RebirthRefusedError(Exception):
    """The soul could not make the move the rebirth depends on.

    Raised rather than returned, and raised **inside** `complete_rebirth`'s
    transaction, because by that point the row and the score rewrites are
    already staged: returning would commit them around a rebirth that did not
    happen.
    """


class ReincarnationService:
    """
    Handles reincarnation execution and rebirth completion.
    """

    @staticmethod
    def execute(disposition: Disposition) -> bool:
        """
        Trigger reincarnation from a disposition.
        Disposition must be executed first via DispositionService.execute().

        Returns False, and logs nothing, when the soul's cosmology has no next
        life for it to be waiting on.

        WHAT THIS USED TO DO. The transition's return value was dropped and the
        event was written **unconditionally**, before anything had been
        established about whether the move happened. Measured on an EG_DUAT
        soul, DISPOSED:

            DispositionService.execute   -> state SETTLED   (correct)
            ReincarnationService.execute -> True, state still SETTLED (refused)
            soul.events = ['REINCARNATION_TRIGGERED', 'STATE_CHANGED', ...]

        So every executed Egyptian or European disposition left
        `REINCARNATION_TRIGGERED` on the soul's timeline -- **exactly the lie
        `SoulState.SETTLED` exists to stop telling.** A soul admitted to the
        Field of Reeds had a record saying it had been sent to be reborn.

        Why nobody noticed: `apps/disposition/tests.py::_execute_for` calls
        `DispositionService.execute` and **never the
        `ReincarnationService.execute` that the view calls immediately after
        it** -- the fixture was one step shorter than the production path. And
        no test anywhere asserted that `REINCARNATION_TRIGGERED` must be
        *absent* for a terminal cosmology.

        THE TEST IS THE STATE, NOT THE TRANSITION. The first attempt at this
        fix gated the event on `transition_to`'s return value, and it was
        wrong in the other direction: for a rebirth-capable soul,
        `DispositionService.execute` has **already** moved it to REINCARNATING,
        so the call here is a same-state transition, which is refused, and the
        event that should be written was not. The question this event answers
        is "is this soul queued for rebirth", and the honest way to ask it is
        to look at where the soul is now.
        """
        soul = disposition.soul
        if soul.current_state != SoulState.REINCARNATING:
            soul.transition_to(
                SoulState.REINCARNATING,
                f"Reincarnation triggered from disposition {disposition.id}"
            )
            soul.refresh_from_db()
        if soul.current_state != SoulState.REINCARNATING:
            # A terminal cosmology, or a state this move is not available from.
            return False

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

        with transaction.atomic():
            # THE LOCK COMES BEFORE THE COUNT. It used to be
            #
            #     cycle_count = soul.reincarnations.count() + 1
            #     with transaction.atomic():
            #         Reincarnation.objects.create(..., cycle_count=cycle_count, ...)
            #
            # -- counted outside the transaction, with no lock on the soul.
            # Measured on a PostgreSQL 16 clone of the shared box, barrier placed
            # between "both have counted" and "both have written":
            #
            #     P2 cycle_counts = {'a': 1, 'b': 1}   distinct = 1
            #
            # **Two concurrent rebirths got the same cycle number.** The
            # reincarnation history is then one cycle short and nothing in the
            # data says so. Same shape as the ledger recalculation (H11); at the
            # time `grep select_for_update apps/reincarnation apps/disposition`
            # matched nothing.
            #
            # `soul.save()` further down is a whole-row UPDATE, so it also
            # clobbers a concurrent writer's merit/demerit -- the lock covers
            # that too, which is why it wraps the whole block and not just the
            # count.
            soul = Soul.all_objects.select_for_update().get(pk=soul.pk)
            cycle_count = soul.reincarnations.count() + 1

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
                tenant=soul.tenant,
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

            # The return value is checked, and the check is inside the
            # `atomic()` on purpose.
            #
            # Dropped, this was the worst of the three: by the time it runs the
            # `Reincarnation` row exists, `merit_score`/`demerit_score` have
            # been overwritten with the inherited values, and `name` /
            # `death_date` / `origin_location` have been rewritten — **all in
            # this same transaction**. A refused transition raised nothing, so
            # nothing rolled back, and every one of those side effects
            # committed around a soul that never became ALIVE.
            if not soul.transition_to(
                SoulState.ALIVE, f"Rebirth complete (cycle {cycle_count})"
            ):
                raise RebirthRefusedError(
                    f"Soul {soul.pk} is {soul.current_state}; it cannot be "
                    f"reborn from there. Nothing was written."
                )

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
