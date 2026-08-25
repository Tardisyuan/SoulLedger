"""零積不抵整發 — the second 凡例 rule, and why this system does not apply it.

《文昌帝君功過格·凡例》 (1724) rules two offsets out in one sentence. The first —
「功過有不可折者。如用財之百功，不可折致死人之百過。」 — is implemented, and
tests/test_ledger_fungibility.py is where it is checked. The second is not:

    零積之十功不能折一次之十過也。

Ten merits earned a fraction at a time do not discharge one fault worth ten at a
stroke. Every test below asserts that this system STILL cannot tell the two
apart. That reads backwards for a test until you consider the two ways it goes
red: somebody implements the rule, or somebody adds the field that would let
them. Both are the moment to come back and read this file, which is the only
place the disagreement is written down — nothing in the language connects a
`min(merit, demerit)` to a claim about 一次.

Written the way tests/test_european_hell_basis.py and
tests/test_migration_reverse_scope.py::test_perm_0008_sample_scopes_contradict_perm_0017
are written, and for the same reason.

WHY NOT IN tests/test_ledger_fungibility.py. That file states its own invariant —
"INDEPENDENT OF THE CORPUS, ON PURPOSE… a failure in this file means the ledger
broke and a failure in tests/test_gongguoge.py means the transcription did".
`test_the_corpus_draws_no_granularity_line` below is corpus evidence and would
destroy that property: an edit to the transcription would redden a file whose
whole diagnostic value is that it cannot. So the second rule gets its own file,
and a red run here means the granularity question moved — in the ledger, in the
model, or in the text.

WHAT NOT TO DO WHEN SOMEBODY COMES TO CLOSE THIS. Do not backfill a granularity
tag onto the 73 transcribed segments. 「一次」 does not appear in any of them
(asserted below), and the one article that speaks about accumulation at all
grants it full value. docs/lore-verification/README.md §1 is about this exact
material — "Do not complete these lists… the one repair that is certainly
wrong" — and `8308204` is what happened the last time it was tried. What is
missing is a join on the ledger side, and apps/ledger/fungibility.py names the
two inputs it needs.
"""
from types import SimpleNamespace

import pytest

from apps.actors.mythology.gongguoge_entries import GONGGUOGE_ENTRIES
from apps.disposition.services import DispositionService
from apps.judgment.models import Verdict
from apps.ledger.fungibility import (
    CLASS_RULE_ZH,
    FUNGIBILITY_RULE_ZH,
    GRANULARITY_MISSING_INPUTS,
    GRANULARITY_RULE_ZH,
    MONEY,
    class_for_category,
    granularity_of,
    offset_within_classes,
)
from apps.ledger.services import LedgerService
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import RecordCategory, SoulRecord
from apps.tenants.models import Tenant

#: 救濟門#7: 「賑濟鰥寡孤獨窮民百錢為一功，貫錢為十功，如一錢散施，積至百錢為一
#: 功」. One article, one MONEY pool, and both granularities of the same ten
#: merits — 貫錢 handed over at once, or a hundred cash at a time until it adds
#: up. This is the pair 凡例 distinguishes and the corpus does not.
SCATTERED_MERIT_EACH = 1
SCATTERED_MERIT_COUNT = 10
LUMP_MERIT = SCATTERED_MERIT_EACH * SCATTERED_MERIT_COUNT

#: 不義門#9: 「不義而取人財物，百錢為一過，貫錢為十過。」 Ten faults on one
#: occasion, in the same MONEY pool as the merits above — so the class rule has
#: nothing to say here and granularity is the only thing that could refuse the
#: offset.
LUMP_DEMERIT = 10

#: 第二殿楚江王 — the mildest punishment court, where a soul with no fault left
#: standing lands. Named through the map for the reason apps/disposition/tests.py
#: gives.
MILDEST_COURT = DispositionService.CHINESE_HELL_TIERS[
    DispositionService.CHINESE_HELL_MIN_TIER
]


@pytest.fixture
def make_chinese_soul(db):
    """Deeds dated in the year of death, so the decay factor is exactly 1.0 and
    the reading sees nothing but the weights."""
    tenant = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "Diyu"}
    )[0]

    def _make(name):
        return Soul.objects.create(
            name=name,
            current_state=SoulState.JUDGING,
            death_year=2000,
            tenant=tenant,
        )

    return _make


def _record(soul, record_type, category, weight, description):
    return SoulRecord.objects.create(
        soul=soul,
        record_type=record_type,
        category=category,
        weight=weight,
        description=description,
        event_year=2000,
    )


def _lump_theft(soul):
    """不義取財貫錢為十過 — 一次之十過."""
    _record(soul, "DEMERIT", RecordCategory.GREED, LUMP_DEMERIT, "不義而取人財物貫錢")


@pytest.fixture
def scattered_giver_and_thief(make_chinese_soul):
    """零積之十功 against 一次之十過: ten hundred-cash alms and one lump theft."""
    soul = make_chinese_soul("零積十功而一次十過者")
    with SoulRecord.batch():
        for n in range(SCATTERED_MERIT_COUNT):
            _record(
                soul, "MERIT", RecordCategory.CHARITY, SCATTERED_MERIT_EACH,
                f"賑濟窮民百錢 #{n + 1}",
            )
        _lump_theft(soul)
    soul.refresh_from_db()
    return soul


@pytest.fixture
def lump_giver_and_thief(make_chinese_soul):
    """一次之十功 against the same 一次之十過: one 貫錢 of alms, one lump theft."""
    soul = make_chinese_soul("一次十功而一次十過者")
    with SoulRecord.batch():
        _record(soul, "MERIT", RecordCategory.CHARITY, LUMP_MERIT, "賑濟窮民貫錢")
        _lump_theft(soul)
    soul.refresh_from_db()
    return soul


def test_both_sides_of_the_fixture_are_in_the_one_attested_pool():
    """The class rule must be silent here, or these tests measure the wrong rule.

    賑濟 is 財 and 不義取財 is 財. If either category were ever remapped, the
    offsets below would be refused by 「不可折」 and the granularity tests would
    pass for a reason that has nothing to do with granularity.
    """
    assert class_for_category(RecordCategory.CHARITY) == MONEY
    assert class_for_category(RecordCategory.GREED) == MONEY


# --------------------------------------------------------------------------
# The rule, and its absence
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_scattered_merit_still_discharges_a_lump_fault(scattered_giver_and_thief):
    """CONTRADICTION, PINNED: exactly the trade 凡例 rules out, and it succeeds.

    「零積之十功不能折一次之十過也。」 Ten merits a hundred cash at a time against
    one theft of a 貫錢 — and the theft comes out discharged in full, because
    within a pool the netting is `min(merit, demerit)` and that function has no
    argument for how the ten were arrived at.

    This is not the alms-versus-killing defect returning: that one crossed pools
    and is refused (tests/test_ledger_fungibility.py). Both deeds here are 財, so
    the first 凡例 rule is satisfied and only the second is violated.
    """
    reading = LedgerService.get_ledger_summary(scattered_giver_and_thief)["reading"]
    non_fungible = reading["non_fungible"]

    assert non_fungible["by_class"][MONEY]["offset"] == LUMP_DEMERIT
    assert non_fungible["unoffset_demerit"] == 0, (
        "a lump fault is no longer discharged by scattered merit — 零積不抵整發 "
        "may have landed. Read apps/ledger/fungibility.py 'What this does not "
        "do' and delete this test on purpose."
    )
    assert non_fungible["unusable_merit"] == 0

    # And at the layer where it costs the soul something.
    assert LedgerService.get_unoffset_demerit(scattered_giver_and_thief) == 0
    assert (
        DispositionService._route_to_realm(scattered_giver_and_thief, Verdict.FAILED)
        == MILDEST_COURT
    )


@pytest.mark.django_db
def test_the_two_granularities_are_indistinguishable_to_this_system(
    scattered_giver_and_thief, lump_giver_and_thief
):
    """CONTRADICTION, PINNED: the pair the rule is about, read identically.

    One soul gave a hundred cash ten times; the other gave a 貫錢 once. 救濟門#7
    scores both at ten merits and 凡例 says only one of them may pay off the
    theft. Every figure this system produces for them is the same figure, and
    they are sentenced to the same court.

    Asserted as equality of the whole `non_fungible` block rather than of the one
    total, so that a granularity distinction appearing anywhere in the reading —
    a new key, a split pool, a flag — shows up here rather than only where
    somebody thought to look.
    """
    scattered = LedgerService.get_ledger_summary(scattered_giver_and_thief)
    lump = LedgerService.get_ledger_summary(lump_giver_and_thief)

    assert scattered["merit_score"] == lump["merit_score"] == LUMP_MERIT
    assert scattered["demerit_score"] == lump["demerit_score"] == LUMP_DEMERIT
    assert scattered["reading"]["non_fungible"] == lump["reading"]["non_fungible"], (
        "the two granularities now read differently — 零積不抵整發 may have "
        "landed; see apps/ledger/fungibility.py"
    )

    assert (
        LedgerService.get_unoffset_demerit(scattered_giver_and_thief)
        == LedgerService.get_unoffset_demerit(lump_giver_and_thief)
        == 0
    )
    assert (
        DispositionService._route_to_realm(scattered_giver_and_thief, Verdict.FAILED)
        == DispositionService._route_to_realm(lump_giver_and_thief, Verdict.FAILED)
    )


@pytest.mark.django_db
def test_the_reading_admits_the_rule_is_not_applied(scattered_giver_and_thief):
    """The absence is reported, not omitted.

    A reading that quoted both halves of the 凡例 sentence in `rule_zh` and said
    nothing further would be read as applying both. This is the same shape
    `_european_reading` uses for `poena`: report what cannot be computed, with
    the reason, rather than substitute a proxy for it.
    """
    non_fungible = LedgerService.get_ledger_summary(
        scattered_giver_and_thief
    )["reading"]["non_fungible"]

    assert non_fungible["granularity_applied"] is False, (
        "the reading now claims 零積不抵整發 is applied — if that is true, the "
        "contradiction tests in this file are the ones to delete"
    )
    assert non_fungible["granularity_rule_zh"] == GRANULARITY_RULE_ZH
    # The two inputs a SoulRecord would have to carry, named so that closing the
    # gap starts from data rather than from an invented marker.
    assert non_fungible["granularity_missing_inputs"] == [
        "statute_clause", "occurrence_count",
    ]
    assert non_fungible["granularity_unavailable"]

    # Both halves are still quoted, and still compose the sentence.
    assert non_fungible["rule_zh"] == FUNGIBILITY_RULE_ZH == (
        CLASS_RULE_ZH + GRANULARITY_RULE_ZH
    )
    assert GRANULARITY_RULE_ZH in non_fungible["rule_zh"]


@pytest.mark.django_db
def test_the_granularity_note_is_confined_to_the_chinese_reading(db):
    """功過格 is Chinese, and so is the admission that half of it is unapplied.

    An Egyptian weighing and a Latin culpa have no offsetting step for either
    凡例 rule to constrain, so a granularity key on those readings would describe
    a limit on an operation they do not perform.
    """
    for code in ("EG_DUAT", "EU_HEAVEN_HELL"):
        tenant = Tenant.objects.get_or_create(
            code=code, defaults={"display_name": code}
        )[0]
        soul = Soul.objects.create(
            name=f"{code} scattered giver", current_state=SoulState.JUDGING,
            death_year=2000, tenant=tenant,
        )
        with SoulRecord.batch():
            _record(soul, "MERIT", RecordCategory.CHARITY, LUMP_MERIT, "賑濟窮民貫錢")
            _lump_theft(soul)
        soul.refresh_from_db()

        reading = LedgerService.get_ledger_summary(soul)["reading"]
        leaked = sorted(key for key in reading if "granularity" in key)
        assert leaked == [], f"{code} was handed a 功過格 granularity claim: {leaked}"


# --------------------------------------------------------------------------
# The missing inputs, asserted as absence
# --------------------------------------------------------------------------


def test_the_soul_record_carries_exactly_the_two_inputs_the_rule_named():
    """WAS A CONTRADICTION, NOW A CONTRACT: the two fields, and only those two.

    This test used to assert that `SoulRecord` carried NO granularity field at
    all, and it was right to: `offset_within_classes` reported 零積不抵整發 as
    unimplementable, and a field appearing without the rule following would have
    been a marker somebody invented. souls/0028 added both inputs under the
    names `GRANULARITY_MISSING_INPUTS` had already chosen for them, so the
    assertion inverts — but it stays an exact set rather than becoming a
    presence check.

    WHY EXACT AND NOT "AT LEAST THESE TWO". A third granularity-shaped field is
    the shape the four refused proxies would take on a second attempt: an
    `is_lump` boolean, an `occasions_estimated` figure, a `granularity` enum
    somebody backfilled. Any of those would let the rule fire on data whose
    provenance the module spent its investigation refusing. The set is the
    statement.
    """
    fragments = (
        "granularity", "occurrence", "occasion", "clause", "statute",
        "lump", "at_once", "scattered",
    )
    names = {field.name for field in SoulRecord._meta.get_fields()}
    matching = sorted(name for name in names if any(f in name for f in fragments))
    assert matching == sorted(GRANULARITY_MISSING_INPUTS), (
        f"SoulRecord's granularity-shaped fields are {matching}; the rule reads "
        f"{sorted(GRANULARITY_MISSING_INPUTS)} and nothing else. A third one is "
        f"how a refused proxy comes back — see the four rejected in "
        f"apps/ledger/fungibility.py before adding it."
    )

    # Both nullable, because there is no backfill and inventing one was the
    # thing every proxy was refused for. A required field here would have forced
    # a value onto 100% of existing rows on the day the column landed.
    assert SoulRecord._meta.get_field("occurrence_count").null is True
    assert SoulRecord._meta.get_field("statute_clause").blank is True

    # `weight` is still not a stand-in: its own help text calls it a
    # significance figure, not a clause value.
    assert "significance" in SoulRecord._meta.get_field("weight").help_text.lower()


def test_is_milestone_is_still_display_only_and_still_not_a_granularity_flag():
    """The nearest-looking field, and why it is not the one.

    `is_milestone` marks a turning point in a life, which is not the same claim
    as "this happened on one occasion" — and SoulRecord's own comment refuses the
    repurposing outright: ticking a display checkbox is a surprising way to move
    an audited balance. LedgerServiceMilestoneTests pins the scoring half; this
    pins the wording that says why, so a granularity implementer meets the
    argument before the field.
    """
    help_text = SoulRecord._meta.get_field("is_milestone").help_text
    assert "Display only" in help_text
    assert "does NOT change the deed's weight" in help_text


# --------------------------------------------------------------------------
# The corpus, which is the half of the criterion that does exist
# --------------------------------------------------------------------------


def test_the_corpus_draws_no_granularity_line():
    """CONTRADICTION, PINNED: 太微 does not mark any article as 一次 or 零積.

    The criterion is not absent from the text — every clause states its own
    per-occasion value, and that is what 一次 means. What is absent is any
    article-level distinction that could be lifted onto a record: 「一次」 occurs
    nowhere in the 73 segments, and the only article that discusses accumulation
    grants it full value rather than marking it down.

    Expectations hand-written rather than derived from the table, per the rule
    tests/test_purgatorio_terraces.py states.
    """
    assert len(GONGGUOGE_ENTRIES) == 73

    marked = [
        (gate, ordinal) for gate, ordinal, _tz, _te, text, _c, _x in GONGGUOGE_ENTRIES
        if "一次" in text
    ]
    assert marked == [], (
        f"the corpus now says 一次 at {marked}. If that is a transcription "
        f"correction it is evidence about the granularity rule; if it is a "
        f"completion, read docs/lore-verification/README.md §1 first."
    )

    # 救濟門#7 is the whole of what 太微 says about accumulating a merit, and it
    # says the accumulated hundred cash is worth the same 一功 as the hundred
    # cash given at once. 「積至」 occurs here and nowhere else.
    accumulating = [
        (gate, ordinal, text)
        for gate, ordinal, _tz, _te, text, _c, _x in GONGGUOGE_ENTRIES
        if "積至" in text
    ]
    assert [(gate, ordinal) for gate, ordinal, _t in accumulating] == [("JJ", 7)]
    assert "如一錢散施，積至百錢為一功" in accumulating[0][2]
    assert "貫錢為十功" in accumulating[0][2]

    # And no article carries a granularity key in its extras, which is where a
    # backfill would land.
    tagged = sorted(
        f"{gate}#{ordinal}:{key}"
        for gate, ordinal, _tz, _te, _text, _c, extras in GONGGUOGE_ENTRIES
        for key in extras
        if key in GRANULARITY_MISSING_INPUTS or "granularity" in key
    )
    assert tagged == [], f"granularity tags appeared on the corpus: {tagged}"


# --------------------------------------------------------------------------
# The rule, now that both inputs exist
# --------------------------------------------------------------------------


def _pool(m_lump=0.0, m_scattered=0.0, m_unknown=0.0,
          d_lump=0.0, d_scattered=0.0, d_unknown=0.0):
    """One fungibility pool with its grain buckets, as services.py builds it."""
    return {
        "SPEECH": {
            "merit": m_lump + m_scattered + m_unknown,
            "demerit": d_lump + d_scattered + d_unknown,
            "merit_by_grain": {"lump": m_lump, "scattered": m_scattered, "unknown": m_unknown},
            "demerit_by_grain": {"lump": d_lump, "scattered": d_scattered, "unknown": d_unknown},
        }
    }


def test_scattered_merit_does_not_discharge_a_lump_fault():
    """The sentence, as arithmetic. 「零積之十功不能折一次之十過也」."""
    reading = offset_within_classes(_pool(m_scattered=10, d_lump=10))

    assert reading["by_class"]["SPEECH"]["offset"] == 0, (
        "ten merits earned a fraction at a time discharged a fault worth ten at "
        "a stroke — which is the sentence this rule is."
    )
    assert reading["unoffset_demerit"] == 10
    assert reading["unusable_merit"] == 10
    assert reading["granularity_applied"] is True


def test_lump_merit_does_discharge_a_scattered_fault():
    """The symmetry the text does NOT assert, and which is therefore not applied.

    524a-style over-reading would forbid this too. 凡例 forbids one pairing —
    scattered merit against a lump fault — and refusing the reverse would deny
    an offset the source permits.
    """
    reading = offset_within_classes(_pool(m_lump=10, d_scattered=10))

    assert reading["by_class"]["SPEECH"]["offset"] == 10
    assert reading["unoffset_demerit"] == 0
    assert reading["granularity_applied"] is False


def test_scattered_merit_still_discharges_a_scattered_fault():
    reading = offset_within_classes(_pool(m_scattered=10, d_scattered=10))
    assert reading["by_class"]["SPEECH"]["offset"] == 10
    assert reading["granularity_applied"] is False


def test_a_ledger_with_no_granularity_recorded_nets_as_it_always_did():
    """The property that let this ship without a backfill.

    Every row written before souls/0028 is `unknown` on both sides, and unknown
    is not evidence in either direction — so the reading for such a database is
    bit-for-bit what it was.
    """
    reading = offset_within_classes(_pool(m_unknown=10, d_unknown=10))
    assert reading["by_class"]["SPEECH"]["offset"] == 10
    assert reading["granularity_applied"] is False


def test_the_constrained_side_is_spent_first_so_the_result_is_order_independent():
    """A pool holding both grains on both sides.

    The waste this guards against is a lump merit consuming a scattered fault,
    stranding the scattered merit in front of a lump fault it may not discharge.

    WHAT THIS TEST CAN AND CANNOT TELL YOU, stated because the first version of
    this docstring named one cause and there are two. `_offset_with_grain`
    prevents the waste twice over — scattered merit is spent first, AND
    unconstrained merit prefers lump faults — and mutation shows each alone is
    sufficient: reversing only the outer order keeps this green, and reversing
    only the inner preference keeps it green too. Both reversed together turns
    it red. So this asserts the outcome and not either mechanism, and a reader
    deleting one of them as duplication will see no failure here.
    """
    reading = offset_within_classes(_pool(m_lump=10, m_scattered=10, d_lump=10, d_scattered=10))

    assert reading["by_class"]["SPEECH"]["offset"] == 20, (
        "both faults are dischargeable — scattered merit against the scattered "
        "fault, lump merit against the lump one — and only an unstated spending "
        "order loses one of them."
    )
    assert reading["unoffset_demerit"] == 0
    assert reading["granularity_applied"] is False


def test_a_caller_that_supplies_no_buckets_gets_the_old_blind_netting():
    """Backwards compatibility, asserted rather than assumed.

    `class_totals` built before souls/0028 — or by anything that only cares
    about pools — has two sums and no grain. That path must still net, or every
    caller of this function outside the ledger summary breaks silently.
    """
    reading = offset_within_classes({"SPEECH": {"merit": 10.0, "demerit": 10.0}})
    assert reading["by_class"]["SPEECH"]["offset"] == 10
    assert reading["granularity_applied"] is False


@pytest.mark.parametrize(
    "clause,count,expected",
    [
        ("救濟門#7:賑濟窮民百錢", 1, "lump"),
        ("救濟門#7:賑濟窮民百錢", 12, "scattered"),
        ("救濟門#7:賑濟窮民百錢", None, "unknown"),
        ("", 1, "unknown"),
        ("", None, "unknown"),
    ],
)
def test_granularity_needs_both_inputs_and_says_unknown_otherwise(clause, count, expected):
    """A count with no clause is a number against no stated per-occasion value.

    That is the invented marker each of the four refused proxies would have
    been, so it reads as unknown rather than as a granularity.
    """
    record = SimpleNamespace(statute_clause=clause, occurrence_count=count)
    assert granularity_of(record) == expected
