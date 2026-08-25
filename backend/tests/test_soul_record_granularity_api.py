"""The two 零積不抵整發 inputs on the write path that actually exists.

souls/0028 added `statute_clause` and `occurrence_count` and
`apps/ledger/fungibility.py` reads them, but `SoulRecordSerializer` has an
explicit field list — so for one commit the rule was live with no way to feed it
except Django admin or SQL. A rule nobody can feed is a rule nobody feeds, and
`granularity_of` reads an unfed record as unknown, which means the whole of
souls/0028 was inert on every path a client uses.

WHAT THE VALIDATION IS FOR, AND WHY A BLANK IS SAFER THAN A WRONG CITATION.
`granularity_of` asks only whether the clause string is non-empty. So an
unresolvable citation does not fail — it silently promotes a record to lump or
scattered and lets the offset rule act on a per-occasion value nobody can look
up. That is the shape of the four proxies `fungibility.py` refused with
evidence, arriving through the write path instead of through a column.
"""
import io

import pytest
from django.core.management import call_command

from apps.souls.record_models import RecordCategory, SoulRecord
from apps.souls.serializers import SoulRecordSerializer

# 救濟門#7 is the article the whole granularity argument turns on: it states two
# per-occasion values in one sentence, which is why a citation names a clause
# and not an article.
GOOD_CODE = "CN-GGG-F-JJ-07"  # 救濟門#7 賑濟窮民
GOOD_CONDITION = "賑濟窮民百錢"


@pytest.fixture
def seeded(db):
    call_command("seed_mythology", stdout=io.StringIO(), stderr=io.StringIO())


def _payload(**overrides):
    data = {
        "record_type": "MERIT",
        "category": RecordCategory.CHARITY,
        "description": "賑濟",
        "weight": 10,
    }
    data.update(overrides)
    return data


def test_the_fixture_cites_a_clause_that_really_exists(seeded):
    """Guard for the guard: if the corpus stops carrying this clause, every
    "accepted" case below would be asserting that an invalid citation passes."""
    from apps.judgment.models import Statute

    statute = Statute.objects.filter(code=GOOD_CODE).first()
    assert statute is not None, f"{GOOD_CODE} is not seeded"
    conditions = [c["condition_zh"] for c in statute.payload_json["clauses"]]
    assert GOOD_CONDITION in conditions, conditions


def test_both_fields_are_on_the_serializer(seeded):
    """The bug this file exists for, stated as a set rather than a presence
    check — a field list is exactly the thing that silently omits one."""
    fields = set(SoulRecordSerializer().fields)
    assert {"statute_clause", "occurrence_count"} <= fields, sorted(fields)


def test_a_resolvable_citation_with_a_count_is_accepted(seeded):
    s = SoulRecordSerializer(data=_payload(
        statute_clause=f"{GOOD_CODE}:{GOOD_CONDITION}", occurrence_count=12
    ))
    assert s.is_valid(), s.errors


def test_neither_field_is_still_a_valid_record(seeded):
    """Every row written before souls/0028 has neither, and the write path must
    keep accepting that — the rule reads it as unknown and nets as before."""
    s = SoulRecordSerializer(data=_payload())
    assert s.is_valid(), s.errors


@pytest.mark.parametrize(
    "clause,why",
    [
        ("CN-GGG-F-XX-99:随便", "unknown statute code"),
        (f"{GOOD_CODE}:这个条件不存在", "known statute, unknown clause"),
        (GOOD_CODE, "no separator, so no clause named"),
        (f":{GOOD_CONDITION}", "no statute named"),
    ],
)
def test_an_unresolvable_citation_is_refused(seeded, clause, why):
    s = SoulRecordSerializer(data=_payload(statute_clause=clause, occurrence_count=1))
    assert not s.is_valid(), f"{why}: accepted {clause!r}"
    assert "statute_clause" in s.errors, s.errors


@pytest.mark.parametrize(
    "payload,why",
    [
        ({"occurrence_count": 12}, "a count with no clause"),
        ({"statute_clause": f"{GOOD_CODE}:{GOOD_CONDITION}"}, "a clause with no count"),
    ],
)
def test_the_two_halves_must_travel_together(seeded, payload, why):
    """Either alone is inert to the offset rule but visible on the record."""
    s = SoulRecordSerializer(data=_payload(**payload))
    assert not s.is_valid(), f"{why}: accepted"


def test_a_written_record_reaches_the_rule_as_a_granularity(seeded, soul_data=None):
    """End to end: the whole point is that the write path feeds `granularity_of`.

    Asserted through the function the offset rule actually calls, not by reading
    the columns back — reading them back would pass even if `granularity_of`
    disagreed about what counts as recorded.
    """
    from apps.ledger.fungibility import granularity_of

    record = SoulRecord(
        record_type="MERIT", category=RecordCategory.CHARITY, weight=10,
        statute_clause=f"{GOOD_CODE}:{GOOD_CONDITION}", occurrence_count=12,
    )
    assert granularity_of(record) == "scattered"

    record.occurrence_count = 1
    assert granularity_of(record) == "lump"
