"""The 42 denials of BD 125B, heard one by one in a weighed case (docs/02_奥西里斯审判详解.md §2.2, §四).

The deceased denies one wrong before each of the 42 assessors; the officer records, per denial, whether it is
true (`NegativeConfession`). The clauses are the seeded EG-NC-01..42 articles (`StatuteCorpus.NEGATIVE_CONFESSION`,
text read off each assessor). Recorded only while the case is open and only on a case that is weighed
(`weighing.applies`); frozen with the verdict, so the record beside `weighing_result` is what was heard before the
scale was read. It does not move the scale: no source gives a false denial a weight, and the scale reads the
admitted ledger (docs/02 §3.2). The tally is shown beside the scale (`tally`).
"""
from django.db import transaction

from apps.judgment import weighing
from apps.judgment.models import Judgment, NegativeConfession, Statute, StatuteCorpus


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
        statute = Statute.all_objects.filter(
            tenant_id=locked.tenant_id, corpus=StatuteCorpus.NEGATIVE_CONFESSION, ordinal=ordinal, is_deleted=False,
        ).first()
        if statute is None:
            raise ConfessionRefusedError(f"No assessor {ordinal} in this hall.", "unknown_clause", status=404)
        row = NegativeConfession.all_objects.filter(judgment=locked, statute=statute, is_deleted=False).first()
        if row is None:
            row = NegativeConfession(judgment=locked, statute=statute, tenant_id=locked.tenant_id)
        row.truthful = truthful
        row.note = (note or "").strip()
        row.save()
        return row
