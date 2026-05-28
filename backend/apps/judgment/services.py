"""
Judgment domain services — cross-context orchestration for judgment lifecycle.
"""
from django.db import transaction
from django.utils import timezone

from apps.souls.models import SoulState


class JudgmentConclusionService:
    """
    Orchestrates the judgment conclusion saga across multiple bounded contexts:
    judgment → disposition → workflow → soul state → event log.
    """

    @staticmethod
    def conclude_judgment(judgment, verdict: str, notes: str = "", create_workflow: bool = False) -> bool:
        """
        Execute the full judgment conclusion saga.

        Steps:
        1. Update judgment state (verdict, notes, final flag)
        2. Create disposition from judgment
        3. Optionally create approval workflow
        4. Transition soul to DISPOSED
        5. Log domain event
        """
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

        # Step 5: Log domain event (cross-context: judgment → events)
        from apps.events.services import EventService
        EventService.log_judgment_concluded(judgment)

        return True
