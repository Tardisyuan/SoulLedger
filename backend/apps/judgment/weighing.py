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
from apps.judgment.models import Judgment, JudgmentKind, JudgmentMethod, Verdict, WeighingResult

WAVERING_VERDICTS = (Verdict.PURGATORY, Verdict.RETRY)


class WeighingRefusedError(Exception):
    def __init__(self, message, code, status=400, **extra):
        super().__init__(message)
        self.code = code
        self.status = status
        self.extra = extra


def applies(judgment) -> bool:
    """A weighed case. An AMENDMENT changes a sentence plan at a stop; it weighs nothing."""
    return judgment.judgment_method == JudgmentMethod.HEART_WEIGHING and judgment.kind != JudgmentKind.AMENDMENT


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


def open_retrial(judgment) -> Judgment:
    """The new weighing a wavering scale calls for: same soul, life, court, kind and plan."""
    retrial = Judgment.objects.create(
        soul=judgment.soul, tenant=judgment.tenant, civilization=judgment.civilization,
        realm=judgment.realm, court=judgment.court, kind=judgment.kind,
        amends_plan_id=judgment.amends_plan_id, cycle=judgment.cycle,
        judgment_method=JudgmentMethod.HEART_WEIGHING, retrial_of=judgment,
    )
    from apps.events.services import EventService

    EventService.log(judgment.soul, "JUDGMENT_INITIATED", {
        "judgment_id": str(retrial.pk), "retrial_of": str(judgment.pk),
        "reason": WeighingResult.WAVERING.value,
    })
    return retrial
