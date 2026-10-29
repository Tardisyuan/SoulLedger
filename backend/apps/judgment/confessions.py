"""The 42 denials of BD 125B, heard one by one in a weighed case (docs/02_奥西里斯审判详解.md §2.2, §四).

The deceased denies one wrong before each of the 42 assessors; the officer records, per denial, whether it is
true (`NegativeConfession`). The clauses are the seeded EG-NC-01..42 articles (`StatuteCorpus.NEGATIVE_CONFESSION`,
text read off each assessor). Recorded only while the case is open and only on a case that is weighed
(`weighing.applies`); frozen with the verdict, so the record beside `weighing_result` is what was heard before the
scale was read. It does not move the scale: no source gives a false denial a weight, and the scale reads the
admitted ledger (docs/02 §3.2). The tally is shown beside the scale (`tally`).

A FALSE DENIAL BARS PASSED (user 2026-10-28; `refuse_passed_if_untruthful`). The verdict that lets the deceased
through is Thoth's "There hath not been found any wickedness in him" (docs/02 §5.1), and the 42 denials are where
the deceased says there is none (§2.2, §四: one wrong denied before each assessor); a denial recorded as untrue is
wickedness found. So any one row with `truthful=False` refuses PASSED at conclusion, at a reopened conclusion and at
an appeal amended to PASSED (400 `untruthful_confession`, with the assessor ordinals). Nothing else changes: the scale
still gives the verdict, so a light heart with a false denial is not FAILED either — the way on is WAVERING, which
weighs again (§5.3: more evidence). No rows, or only true / unrecorded ones: not checked.
"""
from django.db import transaction

from apps.judgment import weighing
from apps.judgment.models import Judgment, NegativeConfession, Statute, StatuteCorpus, Verdict


class ConfessionRefusedError(Exception):
    def __init__(self, message, code, status=400):
        super().__init__(message)
        self.code = code
        self.status = status


def clauses(judgment):
    """The 42 articles of this case's hall, in assessor order (`ordinal` = `assessor_index`)."""
    return list(
        Statute.all_objects.filter(
            tenant_id=judgment.tenant_id, corpus=StatuteCorpus.NEGATIVE_CONFESSION, is_deleted=False,
        ).select_related("source_actor").order_by("ordinal", "code")
    )


def heard(judgment) -> dict:
    """statute_id → NegativeConfession for this case."""
    return {row.statute_id: row for row in NegativeConfession.all_objects.filter(judgment=judgment, is_deleted=False)}


def tally(judgment) -> dict | None:
    """{"truthful", "untruthful", "unheard", "total"} for a weighed case; None otherwise."""
    if not weighing.applies(judgment):
        return None
    total = Statute.all_objects.filter(
        tenant_id=judgment.tenant_id, corpus=StatuteCorpus.NEGATIVE_CONFESSION, is_deleted=False).count()
    rows = list(NegativeConfession.all_objects.filter(judgment=judgment, is_deleted=False)
                .values_list("truthful", flat=True))
    truthful = sum(1 for value in rows if value is True)
    untruthful = sum(1 for value in rows if value is False)
    return {"truthful": truthful, "untruthful": untruthful, "unheard": total - truthful - untruthful, "total": total}


#: BD 125B: one denial before each of the 42 assessors.
ASSESSORS = 42


def record(judgment, ordinal: int, truthful, note: str = "") -> NegativeConfession:
    """Record (or change) what was heard at one assessor. 409 `concluded` once the verdict is in;
    400 `not_weighed` on a case that is not weighed; 404 `unknown_clause` for an ordinal the hall has not seeded."""
    with transaction.atomic():
        locked = Judgment.all_objects.select_for_update(of=("self",)).get(pk=judgment.pk)
        if locked.is_final or locked.verdict is not None:
            raise ConfessionRefusedError("This judgment has been concluded; its confession is part of the record.",
                                         "concluded", status=409)
        if not weighing.applies(locked):
            raise ConfessionRefusedError("Only a weighed Egyptian case hears the 42 denials.", "not_weighed")
        # The route takes any `\d+`; past the column's range PostgreSQL raises (a 500) where SQLite just finds
        # nothing. BD 125B has 42 assessors, so anything outside 1..42 is unknown before it reaches the query.
        statute = Statute.all_objects.filter(
            tenant_id=locked.tenant_id, corpus=StatuteCorpus.NEGATIVE_CONFESSION, ordinal=ordinal, is_deleted=False,
        ).first() if 1 <= ordinal <= ASSESSORS else None
        if statute is None:
            raise ConfessionRefusedError(f"No assessor {ordinal} in this hall.", "unknown_clause", status=404)
        row = NegativeConfession.all_objects.filter(judgment=locked, statute=statute, is_deleted=False).first()
        was_complete = _complete(locked)
        if row is None:
            row = NegativeConfession(judgment=locked, statute=statute, tenant_id=locked.tenant_id)
        row.truthful = truthful
        row.note = (note or "").strip()
        row.save()
        if not was_complete and _complete(locked):
            # One timeline entry per full round, not one per denial (user 2026-10-29, review M): written when the
            # last of the hall's denials is recorded, in the same transaction (CLAUDE.md, 事件日志).
            from apps.events.services import EventService

            counts = tally(locked)
            EventService.log(locked.soul, "NEGATIVE_CONFESSION_HEARD", {
                "judgment_id": str(locked.pk), "truthful": counts["truthful"], "untruthful": counts["untruthful"],
                "total": counts["total"], "untruthful_ordinals": untruthful_ordinals(locked),
            })
        return row


def _complete(judgment) -> bool:
    """Every denial of the hall has been recorded true or untrue (none left unheard)."""
    counts = tally(judgment)
    return counts is not None and counts["total"] > 0 and counts["unheard"] == 0


def untruthful_ordinals(judgment) -> list[int]:
    """The assessors before whom this case's denial was recorded as untrue, in order."""
    return list(NegativeConfession.all_objects.filter(judgment=judgment, is_deleted=False, truthful=False)
                .order_by("statute__ordinal").values_list("statute__ordinal", flat=True))


def refuse_passed_if_untruthful(judgment, verdict) -> None:
    """400 `untruthful_confession` (with `ordinals`) when `verdict` is PASSED and any denial was recorded untrue."""
    from apps.sentence_plan.requests import PlanChangeRefusedError

    if verdict != Verdict.PASSED:
        return
    ordinals = untruthful_ordinals(judgment)
    if ordinals:
        raise PlanChangeRefusedError(
            f"A denial before assessor(s) {', '.join(map(str, ordinals))} was recorded as untrue; "
            "wickedness was found, and the verdict cannot be PASSED", "untruthful_confession", ordinals=ordinals)
