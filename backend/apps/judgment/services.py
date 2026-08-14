"""
Judgment domain services — cross-context orchestration for judgment lifecycle.
"""
from django.db import transaction
from django.utils import timezone

from apps.souls.models import SoulState


class CitationRefusedError(Exception):
    """A statute may not be cited on this judgment, with the reason why.

    An exception rather than a boolean because every refusal here is something
    the operator has to be told: a cross-tenant article, an article from
    another cosmology, and an article that does not exist are three different
    mistakes and only one of them is a typo.
    """


class StatuteCitationService:
    """Attaching and detaching the articles a verdict rests on.

    Every rule below is enforced HERE rather than in the serializer, because
    citations are written from two places — the `citations` action and the
    `conclude` payload — and a check that lives in one serializer is a check
    the other path does not have. That is the shape of the tenant gaps
    apps/core/tenant.py was written to close, one layer up.
    """

    @staticmethod
    def resolve(judgment, statute_id):
        """The Statute this judgment may cite, or `CitationRefusedError`.

        Looked up through `Statute.all_objects` and then checked, rather than
        through a pre-filtered queryset: "no such article" and "that article
        belongs to another tenant" must not collapse into the same 404, or a
        cross-tenant reference reads to the operator as a bad id and gets
        retried forever.
        """
        from apps.judgment.models import Statute

        statute = Statute.all_objects.filter(pk=statute_id).first()
        if statute is None:
            raise CitationRefusedError(f"No statute with id {statute_id}.")
        if statute.is_deleted:
            raise CitationRefusedError(
                f"Statute {statute.code} has been retired and cannot be newly "
                f"cited. Citations already recorded against it stand."
            )
        if statute.tenant_id != judgment.tenant_id:
            raise CitationRefusedError(
                f"Statute {statute.code} belongs to another tenant. A verdict "
                f"can only rest on its own jurisdiction's articles."
            )
        if statute.civilization != judgment.civilization:
            raise CitationRefusedError(
                f"Statute {statute.code} is {statute.civilization} and this "
                f"judgment is {judgment.civilization}. The three cosmologies "
                f"do not share a rulebook."
            )
        return statute

    @staticmethod
    def assert_amendable(judgment):
        """Refuse to edit the grounds of a judgment that has already been given.

        Same stance as `Judgment.can_delete`: once a verdict is recorded the
        proceeding is judicial history. Grounds added afterwards would be a
        rationalisation written after the fact, which is the opposite of what
        an explainable verdict is for — so they go in with the verdict
        (`conclude(..., statute_ids=[...])`) or not at all.
        """
        if judgment.is_final or judgment.verdict is not None:
            raise CitationRefusedError(
                "This judgment has been concluded; its cited grounds are part "
                "of the record and can no longer be changed."
            )

    @classmethod
    def cite(cls, judgment, statute_id, note="", *, enforce_amendable=True):
        """Record one article as a ground of this judgment. Idempotent."""
        from apps.judgment.models import JudgmentCitation

        if enforce_amendable:
            cls.assert_amendable(judgment)
        statute = cls.resolve(judgment, statute_id)
        citation, created = JudgmentCitation.all_objects.get_or_create(
            judgment=judgment,
            statute=statute,
            defaults={"note": note, "tenant": judgment.tenant},
        )
        if not created and note and citation.note != note:
            citation.note = note
            citation.save(update_fields=["note", "update_time", "update_user", "version"])
        return citation

    @classmethod
    def cite_many(cls, judgment, statute_ids, *, enforce_amendable=True):
        """Record several grounds at once — the ordinary case, since a verdict
        usually rests on more than one article.

        All-or-nothing: one bad id refuses the whole set rather than leaving a
        partially cited judgment behind. The caller is inside
        `conclude_judgment`'s transaction when this runs at conclusion time,
        so a refusal there rolls the verdict back with it.
        """
        if enforce_amendable:
            cls.assert_amendable(judgment)
        statutes = [cls.resolve(judgment, statute_id) for statute_id in statute_ids]
        return [
            cls.cite(judgment, statute.pk, enforce_amendable=False)
            for statute in statutes
        ]

    @classmethod
    def uncite(cls, judgment, statute_id):
        """Remove a ground. Returns True when something was removed.

        A real delete, not a soft one, and deliberately: `assert_amendable`
        has already established the judgment carries no verdict, so what is
        being removed is draft reasoning on an open case — the same category as
        the triage queue's skip set, which §4.2 keeps off the server precisely
        so that working through a queue does not write history. Grounds become
        history at the moment the verdict does.
        """
        from apps.judgment.models import JudgmentCitation

        cls.assert_amendable(judgment)
        # Resolve first, so removing a cross-tenant id reports the same refusal
        # adding it would have — never a silent "nothing to do".
        statute = cls.resolve(judgment, statute_id)
        deleted, _ = JudgmentCitation.all_objects.filter(
            judgment=judgment, statute=statute
        ).delete()
        return bool(deleted)


class JudgmentConclusionService:
    """
    Orchestrates the judgment conclusion saga across multiple bounded contexts:
    judgment → disposition → workflow → soul state → event log.
    """

    @staticmethod
    def conclude_judgment(
        judgment,
        verdict: str,
        notes: str = "",
        create_workflow: bool = False,
        statute_ids=None,
    ) -> bool:
        """
        Execute the full judgment conclusion saga.
        Wrapped in transaction.atomic() for consistency.

        Steps:
        0. Record the cited articles the verdict rests on
        1. Update judgment state (verdict, notes, final flag)
        2. Create disposition from judgment
        3. Optionally create approval workflow
        4. Transition soul to DISPOSED
        5. Log domain event

        `statute_ids` is recorded FIRST and inside the same transaction. Two
        consequences, both wanted: a refusal (unknown article, another
        tenant's, another cosmology's) aborts the conclusion rather than
        producing a verdict whose stated grounds silently failed to land; and
        the citations are written while the judgment is still amendable, which
        is the only window `StatuteCitationService.assert_amendable` allows.
        """
        with transaction.atomic():
            # Step 0: Grounds, before the verdict they explain.
            if statute_ids:
                StatuteCitationService.cite_many(judgment, statute_ids)

            # Step 1: Update judgment state
            judgment.verdict = verdict
            judgment.notes = notes
            judgment.is_final = True
            judgment.concluded_at = timezone.now()
            judgment.save()

            # Step 2: Create disposition (cross-context: judgment → disposition)
            from apps.disposition.services import DispositionService
            DispositionService.create_from_judgment(judgment)

            # Step 3: Optionally create workflow (cross-context: judgment → workflow)
            if create_workflow:
                from apps.workflow.services import WorkflowService
                WorkflowService.create_from_judgment(judgment)

            # Step 4: Transition soul state (cross-context: judgment → souls)
            judgment.soul.transition_to(SoulState.DISPOSED, f"Judgment concluded: {verdict}")

        # Step 5: Log domain event (outside transaction for performance)
        from apps.events.services import EventService
        EventService.log_judgment_concluded(judgment)

        return True
