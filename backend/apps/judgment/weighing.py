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


#: What a retrial carries over from the case it hears again (2026-10-29): the case's facts as registered — the
#: offence the court routes by (地府 罪目) and the 枉死城 columns (横死, held until the fated date, the cause, the
#: grievance and its decision). Not the evidence admitted (`EvidenceAdmission`), not the soul's confession
#: (`confession`), and not the 42 denials heard nor how they were taken (`NegativeConfession`): the new hearing
#: rules on them afresh (user 2026-10-29, review E / I; `tests/test_flow_decisions_2026_10_29.py`).
RETRIAL_CARRIES = (
    "offence", "untimely", "held_until", "wrongful_death_cause",
    "grievance_level", "grievance_status", "grievance_plea", "grievance_note", "grievance_decided_at",
)


def open_retrial(judgment, reason=WeighingResult.WAVERING.value, method=JudgmentMethod.HEART_WEIGHING) -> Judgment:
    """The new weighing a wavering scale (or a refused flow) calls for: same soul, life, court, kind and plan.

    Also the European RETRY (`judgment/services.py`), with that case's own `method`: a RETRY is not a
    purgatory sentence there (docs/01_欧洲天堂地狱整体架构.md §1.2), so the case is heard again."""
    retrial = Judgment.objects.create(
        soul=judgment.soul, tenant=judgment.tenant, civilization=judgment.civilization,
        realm=judgment.realm, court=judgment.court, kind=judgment.kind,
        amends_plan_id=judgment.amends_plan_id, cycle=judgment.cycle,
        judgment_method=method, retrial_of=judgment,
        **{field: getattr(judgment, field) for field in RETRIAL_CARRIES},
    )
    from apps.events.services import EventService

    EventService.log(judgment.soul, "JUDGMENT_INITIATED", {
        "judgment_id": str(retrial.pk), "retrial_of": str(judgment.pk),
        "reason": reason,
    })
    return retrial


def reweigh_after_rejection(flow) -> Judgment | None:
    """A station refused an original judgment's approval flow: the case is heard again (user 2026-10-27 for the
    Egyptian weighing; 2026-10-29 for every civilization's original judgment).

    The refused conclusion placed nothing yet — its disposition cannot execute before the flow completes
    (`unfinished_flow`) — so it is withdrawn: the disposition and the sentence plan it opened are voided by the system (soft-deleted, not
    in the recycle bin, not restorable), the soul takes the system-only edge DISPOSED → JUDGING, and a new case (`retrial_of`, same
    method) is opened with JUDGMENT_INITIATED. Same transaction as the decision that rejected the flow. Returns None, leaving the old
    way out (reopen or appeal), when the soul was already placed or the case is not a concluded original.
    """
    judgment = flow.judgment
    if judgment is None or judgment.kind != JudgmentKind.ORIGINAL or not judgment.is_final:
        return None
    from apps.core.recycle_bin import system_void
    from apps.disposition.models import Disposition
    from apps.sentence_plan.models import SentenceNode, SentencePlan
    from apps.souls.models import Soul, SoulState

    soul = Soul.all_objects.select_for_update().get(pk=judgment.soul_id)
    dispositions = Disposition.all_objects.filter(judgment_id=judgment.pk, is_deleted=False)
    # LOST too (review K): a soul that went missing in transit while the flow ran was never placed — its disposition
    # is unexecuted — and used to leave the disposition stuck at `approval_rejected`.
    if (soul.current_state not in (SoulState.DISPOSED, SoulState.LOST)
            or dispositions.filter(is_executed=True).exists()):
        return None
    # The withdrawn conclusion's appeals go with it (2026-10-29): an appeal still open would otherwise amend a
    # verdict that no longer stands. Voided like a devoured soul's (`appeals.void_open_appeals`), same transaction.
    from apps.judgment import appeals

    appeals.void_open_appeals(soul, judgment_id=judgment.pk, because="case_reopened",
                              end_reason=appeals.END_REASON_REOPENED)
    # The soul leaves the station the withdrawn disposition put it in (2026-10-29): its path went there when the
    # disposition was written (`SoulPathService.enter`) and must not stay open once the disposition is void.
    from apps.realms.path import SoulPathService

    for realm in {d.destination_realm for d in dispositions.select_related("destination_realm")}:
        if realm is not None:
            SoulPathService.leave(soul, realm=realm)
    # A system void, not a deletion: out of the recycle bin and never restorable (user 2026-10-27).
    plan_ids = list(SentencePlan.all_objects.filter(origin_judgment_id=judgment.pk, is_deleted=False)
                    .values_list("pk", flat=True))
    why = f"weighing_rejected:{judgment.pk}"
    void = system_void(SentenceNode.all_objects.filter(plan_id__in=plan_ids, is_deleted=False), why)
    system_void(SentencePlan.all_objects.filter(pk__in=plan_ids), why, void)
    system_void(dispositions, why, void)
    # The state machine's system-only edge (Soul.SYSTEM_ONLY_TRANSITIONS); it writes STATE_CHANGED itself.
    if not soul.transition_to(SoulState.JUDGING, "Approval flow rejected", system="weighing_rejected"):
        # A business refusal, not a crash (2026-10-29): the decision that refused the flow is rolled back and
        # answered 409 with this code (`workflow/views.py::_hook_refusals`).
        raise WeighingRefusedError(f"Soul {soul.pk} could not go back to JUDGING after its approval flow was "
                                   f"rejected", "soul_cannot_reopen", status=409)
    return open_retrial(judgment, reason="REJECTED", method=judgment.judgment_method)


def origin_flow_open(*, judgment=None, soul=None) -> bool:
    """An original judgment's own approval flow is still running (PENDING / IN_PROGRESS) — for `judgment`, or for
    any original judgment of `soul` (user 2026-10-29, review B and R). Until it ends, the conclusion is not final
    in fact: no appeal, no escalated appeal, no rebirth (`origin_flow_open`). A flow that ended — completed,
    refused, cancelled — does not count: a refusal reopens the case (`reweigh_after_rejection`)."""
    from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus, judgment_deciding

    flows = judgment_deciding(ApprovalWorkflow._base_manager.filter(
        judgment__kind=JudgmentKind.ORIGINAL, is_deleted=False,
        status__in=(ApprovalWorkflowStatus.PENDING, ApprovalWorkflowStatus.IN_PROGRESS)))
    if judgment is not None:
        flows = flows.filter(judgment_id=judgment.pk)
    else:
        flows = flows.filter(soul_id=soul.pk)
    return flows.exists()


_UNREAD = object()


def unfinished_flow(disposition, flow_status=_UNREAD) -> str | None:
    """Why this disposition may not execute yet, or None (user 2026-10-29; Egypt: docs/02 §2.1, §5.1–5.2).

    An original judgment's disposition waits for its approval flow to be COMPLETED. Egypt's is the weighing flow
    (Thoth reads, the tribunal confirms, Horus leads, Osiris receives — or Ammit devours): `weighing_in_progress`
    / `weighing_rejected`; every other civilization's: `approval_in_progress` / `approval_rejected`. A refused flow
    normally withdraws its disposition and opens a new case (`reweigh_after_rejection`); the `…_rejected` code is
    the one that could not (the soul already placed: reopen or appeal). A case concluded without a flow (before
    this rule, an early death, or not an original) is not held. `flow_status` is the flow's status when the caller
    already read it (the list's `judgment_flow_status` annotation; None = no flow).
    """
    judgment = disposition.judgment
    # A wavering scale sends the soul nowhere (02 §5.3): a disposition written before that rule, parked at
    # the Duat entry by an undecided Egyptian verdict, must not execute into SETTLED at no station.
    realm = disposition.destination_realm
    if (judgment is not None and judgment.civilization == "EGYPTIAN"
            and realm is not None and realm.realm_code == "EG_DUAT_ENTRY"):
        return "weighing_wavers"
    if judgment is None or judgment.kind != JudgmentKind.ORIGINAL:
        return None
    from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus

    if flow_status is _UNREAD:
        # A flow started by hand naming the judgment does not hold it (`ApprovalWorkflow.decides_judgment`).
        flow = ApprovalWorkflow.objects.filter(judgment=judgment).first()
        flow_status = flow.status if flow is not None and flow.decides_judgment else None
    if flow_status is None or flow_status == ApprovalWorkflowStatus.COMPLETED:
        return None
    if flow_status == ApprovalWorkflowStatus.CANCELLED:
        # Ended by a cancelled cross-realm judgment (review C): not passed, so not released.
        return "approval_cancelled"
    prefix = "weighing" if applies(judgment) else "approval"
    return f"{prefix}_rejected" if flow_status == ApprovalWorkflowStatus.REJECTED else f"{prefix}_in_progress"
