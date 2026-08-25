"""The two Greek corpora, and the four things about them that can rot quietly.

GREEK judged by no declared rulebook until this pair landed, and that was not a
backlog item — it was invisible. HELL_LAW is empty and SAYS SO; its emptiness is
declared ABSENT in ``CORPUS_PROVENANCE`` and held there by
tests/test_corpus_provenance.py. GREEK had no corpus at all, so it had no entry,
and the guard could not have noticed: it iterated ``StatuteCorpus`` members, and
a civilization appearing in no corpus is invisible to a check that walks
corpora. That guard walks civilizations now, and this file holds what the two
new corpora actually claim.

WHAT IS ACTUALLY FRAGILE HERE, in the order the repository has learned to
distrust:

  1. THE SEPARATION. Two corpora exist because Gorgias and Republic X are two
     eschatologies — one stamps a soul and stops, the other sentences it to a
     thousand-year circuit and sends it back to be born. That distinction lives
     in prose and in the shape of two lists, and prose does not fail. A later
     tidy-up that moved the tenfold arithmetic onto a Gorgias row, or merged
     the two under one enum value, would look like housekeeping and would
     assert a terminal sentence AND a return.

  2. THE POLARITY DISTRIBUTION. Twenty of twenty-two articles are PROCEDURE
     because neither myth contains a code of offences. Re-filing procedural
     rules as OFFENCE is the single most likely "improvement" here — it makes
     the corpus look like the other four — and it is exactly the HELL_LAW
     mistake, which was a plausible table of sins with no document behind it.

  3. THE GAPS. Two of them are the SOURCE's: 615b names three wrongs and closes
     with "any other evil behaviour", and 615c says impiety and murder draw
     retributions "other and greater far" and never states them. Filling either
     is how HELL_LAW was written. They are asserted present AND unfilled,
     because an assertion that a gap is merely *recorded* stays green while
     someone quietly supplies the missing terms beside it.

  4. THE ROUTING BOUNDARY. ``statutes_inferno.py`` declared "it does not route
     anything" in its docstring and then `_deepest_cited_circle` made
     ``payload["circle"]`` live. A docstring did not stop it and will not stop
     this. So the boundary is asserted BEHAVIOURALLY below: route a Greek soul
     with the statute table empty and with it fully seeded, and require the
     same answer.
"""
import io

import pytest
from django.core.management import call_command

from apps.disposition.services import DispositionService
from apps.judgment.models import Statute, StatuteCorpus, StatutePolarity
from apps.souls.models import Civilization

GORGIAS_RANGE = (523, 526)
REPUBLIC_RANGE = (614, 621)


@pytest.fixture
def seeded(db):
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out)
    return out.getvalue()


def _greek(corpus):
    return Statute.all_objects.filter(corpus=corpus).order_by("ordinal")


# --------------------------------------------------------------------------
# 0. The fixture is looking at something
# --------------------------------------------------------------------------
@pytest.mark.django_db
def test_both_corpora_actually_seeded(seeded):
    """Without this every assertion below passes over an empty queryset.

    `assert not <empty>` is the shape this repository keeps finding: it is
    cleanest exactly when nothing was examined. A corpus renamed, a
    civilization key mistyped in CIVILIZATION_STATUTES, a seeder that silently
    skipped GREEK — each leaves the rest of this file green.
    """
    assert _greek(StatuteCorpus.GORGIAS).count() == 11
    assert _greek(StatuteCorpus.REPUBLIC_ER).count() == 11


@pytest.mark.django_db
def test_greek_is_the_only_civilization_on_either_corpus(seeded):
    for corpus in (StatuteCorpus.GORGIAS, StatuteCorpus.REPUBLIC_ER):
        civilizations = set(_greek(corpus).values_list("civilization", flat=True))
        assert civilizations == {Civilization.GREEK}, (corpus, civilizations)


@pytest.mark.django_db
def test_the_codes_are_stable_and_mnemonic(seeded):
    """`_upsert` matches on `code`, so a renumbering repoints every judgment
    that cited an article — silently, because the prose would still read
    correctly. Written out rather than generated for that reason."""
    assert list(_greek(StatuteCorpus.GORGIAS).values_list("code", flat=True)) == [
        f"GR-GRG-{index:02d}" for index in range(1, 12)
    ]
    assert list(_greek(StatuteCorpus.REPUBLIC_ER).values_list("code", flat=True)) == [
        f"GR-ER-{index:02d}" for index in range(1, 12)
    ]


# --------------------------------------------------------------------------
# 1. The separation
# --------------------------------------------------------------------------
@pytest.mark.django_db
def test_no_gorgias_article_carries_the_circuit_or_its_arithmetic(seeded):
    """The load-bearing one. Gorgias has NO NUMBERS.

    Not a stylistic claim: the dialogue states a destination and stops. There
    is no term, no rate, no unit and no return anywhere in 523a-526d. Every one
    of those belongs to Republic X, and a Gorgias row that acquired one would
    be asserting a circuit the dialogue does not have — the exact merge these
    two corpora exist to prevent, and it would read as a helpful completion.
    """
    forbidden = {
        "multiplier",
        "period_years",
        "circuit_years",
        "days_in_the_meadow",
        "departure_day",
    }
    offenders = {
        row.code: sorted(forbidden & set(row.payload_json))
        for row in _greek(StatuteCorpus.GORGIAS)
        if forbidden & set(row.payload_json)
    }
    assert not offenders, (
        f"Gorgias articles now carry Republic X's arithmetic: {offenders}. "
        f"Gorgias 523a-526d contains no term, rate, unit or return. If a "
        f"circuit is wanted, cite GR-ER-03; do not grow one here."
    )


@pytest.mark.django_db
def test_the_transcribed_text_never_reaches_into_the_other_dialogue(seeded):
    """`text_zh`/`text_en` are the dialogue's own words and nothing else.

    The European rule is "no article here cites a terrace and no terrace
    article cites a circle" — a ban on importing the other structure's
    COORDINATE, because a soul placed by a coordinate its poem does not have is
    placed nowhere. The same ban applies to the transcribed text absolutely: a
    Gorgias article that quoted Republic X would be presenting one dialogue's
    sentence as the other's.
    """
    codes = {
        StatuteCorpus.GORGIAS: set(
            _greek(StatuteCorpus.REPUBLIC_ER).values_list("code", flat=True)
        ),
        StatuteCorpus.REPUBLIC_ER: set(
            _greek(StatuteCorpus.GORGIAS).values_list("code", flat=True)
        ),
    }
    for corpus, foreign in codes.items():
        assert foreign, corpus  # the loop below is not comparing against nothing
        for row in _greek(corpus):
            body = f"{row.text_zh}\n{row.text_en}"
            cited = {code for code in foreign if code in body}
            assert not cited, (
                f"{row.code}'s transcribed text cites {sorted(cited)} from the "
                f"other Greek corpus. The text is the dialogue's own words."
            )


@pytest.mark.django_db
def test_a_cross_reference_may_only_be_a_recorded_contradiction(seeded):
    """The one permitted exception, pinned as an exception.

    A blanket ban here would forbid something this repository actively wants.
    Republic X 615d-e puts private individuals among the incurable and Gorgias
    526a says no private person was ever called incurable — a real
    disagreement between two dialogues by one author, and the repo's standing
    practice is to SURFACE a contradiction rather than smooth it. GR-ER-07
    records it, and deleting that note to satisfy a tidier rule would hide the
    conflict rather than resolve it.

    So cross-references are legal in exactly one place — ``payload
    ["contradicts"]`` — and nowhere else in the payload. That keeps the escape
    hatch enumerable: a merge arriving disguised as "just a note" has to arrive
    under a key whose name says it is a disagreement, and the article it names
    has to exist.
    """
    permitted = "contradicts"
    codes = {
        StatuteCorpus.GORGIAS: set(
            _greek(StatuteCorpus.REPUBLIC_ER).values_list("code", flat=True)
        ),
        StatuteCorpus.REPUBLIC_ER: set(
            _greek(StatuteCorpus.GORGIAS).values_list("code", flat=True)
        ),
    }
    all_codes = codes[StatuteCorpus.GORGIAS] | codes[StatuteCorpus.REPUBLIC_ER]
    assert all_codes, "no Greek articles to cross-reference"

    found = 0
    for corpus, foreign in codes.items():
        for row in _greek(corpus):
            for key, value in row.payload_json.items():
                cited = {code for code in foreign if code in str(value)}
                if not cited:
                    continue
                assert key == permitted, (
                    f"{row.code}.payload[{key!r}] references {sorted(cited)} "
                    f"from the other Greek corpus. Only "
                    f"payload['{permitted}'] may, and only to record that the "
                    f"two dialogues disagree."
                )
                for code in cited:
                    assert Statute.all_objects.filter(code=code).exists(), (
                        f"{row.code} contradicts {code}, which does not exist."
                    )
                found += 1

    assert found == 1, (
        f"Expected exactly one recorded contradiction between the two Greek "
        f"corpora (GR-ER-07 against GR-GRG-10); found {found}. A new one is "
        f"not necessarily wrong, but it is a claim about two dialogues and "
        f"belongs in this docstring before it belongs in a payload."
    )


@pytest.mark.django_db
def test_the_two_corpora_do_not_share_a_stephanus_range(seeded):
    """Each article sits inside its own dialogue, and the parser says so.

    Raises rather than skipping when a `stephanus` key is missing: an article
    whose citation cannot be read is the failure this checks for, and quietly
    passing over it is how a corpus loses its provenance one row at a time.
    """
    for corpus, (low, high) in (
        (StatuteCorpus.GORGIAS, GORGIAS_RANGE),
        (StatuteCorpus.REPUBLIC_ER, REPUBLIC_RANGE),
    ):
        rows = list(_greek(corpus))
        assert rows, corpus
        for row in rows:
            raw = row.payload_json.get("stephanus")
            assert raw, f"{row.code} carries no stephanus reference"
            page = int(str(raw)[:3])
            assert low <= page <= high, (
                f"{row.code} cites {raw}, outside {corpus}'s declared range "
                f"{low}-{high}. Either the article belongs to the other corpus "
                f"or CORPUS_PROVENANCE's source line is now wrong."
            )


# --------------------------------------------------------------------------
# 2. The polarity distribution
# --------------------------------------------------------------------------
@pytest.mark.django_db
def test_exactly_one_greek_article_is_an_offence_and_exactly_one_a_merit(seeded):
    """Pinned as an exact census, not as "mostly procedural".

    Neither Platonic myth contains a code of offences, and the temptation is to
    make this corpus resemble the other four by re-filing its rules as sins.
    Republic X 615b is the ONLY passage in either dialogue that names wrongs,
    and it names three after "for example" before closing with "any other evil
    behaviour"; 615b-c is the only one that credits anything. A second OFFENCE
    row appearing means someone has begun expanding a catch-all, which is
    precisely how the withdrawn HELL_LAW corpus was written.
    """
    census = {}
    for row in Statute.all_objects.filter(
        corpus__in=[StatuteCorpus.GORGIAS, StatuteCorpus.REPUBLIC_ER]
    ):
        census[row.polarity] = census.get(row.polarity, 0) + 1

    assert census == {
        StatutePolarity.PROCEDURE: 20,
        StatutePolarity.OFFENCE: 1,
        StatutePolarity.MERIT: 1,
    }, census

    offence = Statute.all_objects.get(
        corpus__in=[StatuteCorpus.GORGIAS, StatuteCorpus.REPUBLIC_ER],
        polarity=StatutePolarity.OFFENCE,
    )
    assert offence.code == "GR-ER-04"
    merit = Statute.all_objects.get(
        corpus__in=[StatuteCorpus.GORGIAS, StatuteCorpus.REPUBLIC_ER],
        polarity=StatutePolarity.MERIT,
    )
    assert merit.code == "GR-ER-05"


@pytest.mark.django_db
def test_every_gorgias_article_is_procedural(seeded):
    """Gorgias names no wrong at all — not one, in the whole myth. It describes
    a court: a reform, a bench, a venue, a rule of evidence, a purpose of
    punishment and a two-way sentence."""
    wrong = {
        row.code: row.polarity
        for row in _greek(StatuteCorpus.GORGIAS)
        if row.polarity != StatutePolarity.PROCEDURE
    }
    assert not wrong, wrong


# --------------------------------------------------------------------------
# 3. The gaps
# --------------------------------------------------------------------------
@pytest.mark.django_db
def test_the_catch_all_at_615b_is_recorded_and_still_empty(seeded):
    """Recorded AND unfilled, asserted separately.

    A test that only checked the gap was *documented* would stay green while
    someone supplied the missing offences in a sibling row and left the note in
    place — which is the shape of every defect this repository keeps finding.
    So the note must exist, and the named list must still be exactly three.
    """
    row = Statute.all_objects.get(code="GR-ER-04")
    assert row.payload_json.get("transcription_gap"), (
        "GR-ER-04 no longer records that 615b refuses to enumerate."
    )
    assert row.payload_json.get("catch_all"), "the catch-all clause is gone"
    assert len(row.payload_json.get("named", [])) == 3, (
        f"615b names three wrongs after 'for example'. GR-ER-04 now lists "
        f"{row.payload_json.get('named')}. Plato declined to continue; "
        f"continuing for him is how HELL_LAW was written."
    )


@pytest.mark.django_db
def test_the_withheld_retributions_at_615c_stay_withheld(seeded):
    """Er described them; Plato reports that he described them and stops.

    So the rule exists, its subjects are named, and its TERMS are
    unrecoverable. A `sentence_years`, a multiplier, or any figure appearing on
    this row would be an invention with a citation attached — the most
    convincing possible form of the HELL_LAW error.
    """
    row = Statute.all_objects.get(code="GR-ER-06")
    payload = row.payload_json
    assert payload.get("transcription_gap"), "the withholding is no longer recorded"
    assert len(payload.get("subjects", [])) == 4

    invented = {
        key: value
        for key, value in payload.items()
        if key not in {"stephanus", "subjects", "transcription_gap"}
    }
    assert not invented, (
        f"GR-ER-06 has acquired {sorted(invented)}. Republic X 615c says these "
        f"retributions are 'other and greater far' than the tenfold rule and "
        f"never states them. Nothing may be inferred here."
    )


# --------------------------------------------------------------------------
# 4. The routing boundary — asserted behaviourally
# --------------------------------------------------------------------------
@pytest.mark.django_db
def test_the_greek_router_gives_the_same_answer_with_no_statutes_at_all(seeded):
    """The INFERNO warning, made into something that can fail.

    ``statutes_inferno.py`` says in its docstring that it routes nothing, and
    then `_deepest_cited_circle` made ``payload["circle"]`` a routing input.
    The docstring did not notice. This does: every verdict is routed twice,
    once with all 22 Greek articles present and once with the statute table
    emptied, and the two must agree.

    If a future change makes a Greek article route something, this fails and
    the repair is a DECISION — Plato's fork has no severity dimension to read
    (Gorg. 524a says which way each soul is sent, never how far along), so an
    article that starts steering it is asserting a depth the source lacks.
    """
    verdicts = ["PASSED", "FAILED", "PENDING", "PURGATORY", "RETRY"]

    def route_all():
        return {
            verdict: DispositionService._route_greek(None, verdict)
            for verdict in verdicts
        }

    assert Statute.all_objects.filter(
        corpus__in=[StatuteCorpus.GORGIAS, StatuteCorpus.REPUBLIC_ER]
    ).count() == 22
    with_statutes = route_all()

    Statute.all_objects.all().delete()
    assert Statute.all_objects.count() == 0
    without_statutes = route_all()

    assert with_statutes == without_statutes, (
        f"Routing changed when the statute table was emptied: "
        f"{with_statutes} vs {without_statutes}. A Greek article has become a "
        f"routing input."
    )
    # and the routing is not uniformly empty, which would make the above
    # agree for the wrong reason
    assert len(set(with_statutes.values())) > 1, with_statutes
