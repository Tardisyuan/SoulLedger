"""The Egyptian verdict comes from the weighing (docs/02 §2.1, §3, §5; 01 §3.3).

Anubis weighs, Thoth records, and the result is the scale's: a heart not
heavier than the feather passes (02 §5.1), a heavier one goes to Ammit (02
§5.2). The officer does not pick between the two — a verdict that contradicts
the scale is refused (`verdict_contradicts_weighing`). What the officer may
say is that the scale wavers (02 §5.3: 托特记录 · 可能需要更多证据 · 延迟审判):
a PURGATORY / RETRY verdict on a weighed case records WAVERING and opens a new
weighing of the same kind; no destination, no disposition, no plan node, so the
soul is never left SETTLED at no station (user decision 2026-10-27).

The scale reads the case's admitted evidence — the same sums the desk shows —
through the Egyptian reading (demerit lightened by merit, 02 §3.2).
"""
from apps.judgment.models import DuatStage, Judgment, JudgmentKind, JudgmentMethod, Verdict, WeighingResult

WAVERING_VERDICTS = (Verdict.PURGATORY, Verdict.RETRY)


class WeighingRefusedError(Exception):
    def __init__(self, message, code, status=400, **extra):
        super().__init__(message)
        self.code = code
        self.status = status
        self.extra = extra


def applies(judgment) -> bool:
    """A weighed case. An AMENDMENT changes a sentence plan at a stop; it weighs nothing. Nor is an early death
    weighed: it goes straight to the Field of Reeds (docs/01 §4.2, `Soul._after_egyptian_death`)."""
    return (judgment.judgment_method == JudgmentMethod.HEART_WEIGHING and judgment.kind != JudgmentKind.AMENDMENT
            and judgment.duat_stage != DuatStage.EARLY_DEATH)


def scale(judgment) -> dict:
    """The Egyptian reading over this case's admitted evidence."""
    from apps.judgment.services import EvidenceAdmissionService
    from apps.ledger.services import LedgerService

    return LedgerService.get_admitted_weighing(
        judgment.soul, judgment.cycle, EvidenceAdmissionService.not_admitted_ids(judgment))


def weighed_verdict(reading: dict) -> str:
    return Verdict.FAILED if reading["heavier_than_feather"] else Verdict.PASSED


def weigh(judgment, verdict) -> tuple[str, int]:
    """(WeighingResult, heart_weight) for this conclusion, or refuse a verdict the scale did not give."""
    reading = scale(judgment)
    if verdict in WAVERING_VERDICTS:
        return WeighingResult.WAVERING, reading["heart_weight"]
    expected = weighed_verdict(reading)
    if verdict != expected:
        raise WeighingRefusedError(
            f"The heart weighs {reading['heart_weight']} against a feather of {reading['counterweight']}; "
            f"the scale gives {expected}, not {verdict}",
            "verdict_contradicts_weighing", weighed_verdict=expected,
            heart_weight=reading["heart_weight"], counterweight=reading["counterweight"],
        )
    return (WeighingResult.HEAVIER if expected == Verdict.FAILED else WeighingResult.LIGHTER,
            reading["heart_weight"])


def open_retrial(judgment, reason=WeighingResult.WAVERING.value, method=JudgmentMethod.HEART_WEIGHING) -> Judgment:
    """The new weighing a wavering scale (or a refused flow) calls for: same soul, life, court, kind and plan.

    Also the European RETRY (`judgment/services.py`), with that case's own `method`: a RETRY is not a
    purgatory sentence there (docs/01_欧洲天堂地狱整体架构.md §1.2), so the case is heard again."""
    retrial = Judgment.objects.create(
        soul=judgment.soul, tenant=judgment.tenant, civilization=judgment.civilization,
        realm=judgment.realm, court=judgment.court, kind=judgment.kind,
        amends_plan_id=judgment.amends_plan_id, cycle=judgment.cycle,
        judgment_method=method, retrial_of=judgment,
    )
    from apps.events.services import EventService

    EventService.log(judgment.soul, "JUDGMENT_INITIATED", {
        "judgment_id": str(retrial.pk), "retrial_of": str(judgment.pk),
        "reason": reason,
    })
    return retrial


def reweigh_after_rejection(flow) -> Judgment | None:
    """A station refused the weighing flow: weigh again, the same path as a wavering scale (user 2026-10-27).

    The refused conclusion placed nothing yet — its disposition cannot execute before the flow completes
    (`unfinished_flow`) — so it is withdrawn: the disposition and the sentence plan it opened are voided by the system (soft-deleted, not
    in the recycle bin, not restorable), the soul takes the system-only edge DISPOSED → JUDGING, and a new weighing (`retrial_of`) is opened with
    JUDGMENT_INITIATED. Same transaction as the decision that rejected the flow. Returns None, leaving the old
    way out (reopen or appeal), when the soul was already placed or the case is not an original weighing.
    """
    judgment = flow.judgment
    if judgment is None or not applies(judgment) or judgment.kind != JudgmentKind.ORIGINAL or not judgment.is_final:
        return None
    from apps.core.recycle_bin import system_void
    from apps.disposition.models import Disposition
    from apps.sentence_plan.models import SentenceNode, SentencePlan
    from apps.souls.models import Soul, SoulState

    soul = Soul.all_objects.select_for_update().get(pk=judgment.soul_id)
    dispositions = Disposition.all_objects.filter(judgment_id=judgment.pk, is_deleted=False)
    if soul.current_state != SoulState.DISPOSED or dispositions.filter(is_executed=True).exists():
        return None
    # A system void, not a deletion: out of the recycle bin and never restorable (user 2026-10-27).
    plan_ids = list(SentencePlan.all_objects.filter(origin_judgment_id=judgment.pk, is_deleted=False)
                    .values_list("pk", flat=True))
    why = f"weighing_rejected:{judgment.pk}"
    void = system_void(SentenceNode.all_objects.filter(plan_id__in=plan_ids, is_deleted=False), why)
    system_void(SentencePlan.all_objects.filter(pk__in=plan_ids), why, void)
    system_void(dispositions, why, void)
    # The state machine's system-only edge (Soul.SYSTEM_ONLY_TRANSITIONS); it writes STATE_CHANGED itself.
    if not soul.transition_to(SoulState.JUDGING, "Weighing flow rejected", system="weighing_rejected"):
        raise RuntimeError(f"Soul {soul.pk} could not go back to JUDGING after its weighing was rejected")
    return open_retrial(judgment, reason="REJECTED")


def unfinished_flow(disposition) -> str | None:
    """Why this disposition may not execute yet, or None (docs/02 §2.1, §5.1–5.2).

    Thoth reads, the tribunal confirms, Horus leads, Osiris receives — or Ammit devours — and only then is
    the soul placed. So an Egyptian disposition waits for its weighing flow to be COMPLETED: one still
    running is `weighing_in_progress`, a refused one normally withdraws its disposition and opens a new
    weighing (`reweigh_after_rejection`); one that could not (the soul already placed) is `weighing_rejected`
    (reopen or appeal the case). A case concluded without a flow (before this rule, or a reopened one) is not held.
    """
    judgment = disposition.judgment
    # A wavering scale sends the soul nowhere (02 §5.3): a disposition written before that rule, parked at
    # the Duat entry by an undecided Egyptian verdict, must not execute into SETTLED at no station.
    realm = disposition.destination_realm
    if (judgment is not None and judgment.civilization == "EGYPTIAN"
            and realm is not None and realm.realm_code == "EG_DUAT_ENTRY"):
        return "weighing_wavers"
    if judgment is None or not applies(judgment):
        return None
    from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus

    flow = ApprovalWorkflow.objects.filter(judgment=judgment).only("status").first()
    if flow is None or flow.status == ApprovalWorkflowStatus.COMPLETED:
        return None
    return "weighing_rejected" if flow.status == ApprovalWorkflowStatus.REJECTED else "weighing_in_progress"
