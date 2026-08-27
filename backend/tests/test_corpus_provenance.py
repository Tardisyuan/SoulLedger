"""
Which corpus is transcribed, which is a pointer, and which is empty on purpose.

Why this file exists
--------------------
``seed_mythology.py`` was one 2758-line module, and the argument against
splitting it was this: the comparison between the three statute corpora —
GONGGUOGE transcribed from 《太微仙君功過格》 with two transcription gaps left
open, NEGATIVE_CONFESSION *derived* from assessor rows and never copied,
DEADLY_SIN transcribed from Dante, HELL_LAW empty as a finding — was written as
one paragraph above all three tables, and splitting the tables apart would tear
it up. The comparison is real: it is the difference between an article whose
text this repo owns and one whose text it must never own, and it is the thing
whose loss produced the fabricated HELL_LAW corpus in the first place.

The paragraph was moved whole into ``apps/actors/mythology/__init__.py`` rather
than filed under any one corpus. This file is the other half of that answer:
the comparison is now held by a check instead of by whoever remembers it.

What is asserted, and why in this order
---------------------------------------
1. Every corpus the *enum* knows about has a provenance declaration. Adding
   ``StatuteCorpus.SOMETHING`` without saying where its text comes from fails
   here, which is the exact omission that let a corpus be invented from a
   template.
2. The declarations still say what they said: 3 transcribed, 1 derived, 1
   absent, with the counts and the deliberate gap named — 功過格's 74
   against a claimed 75, and INFERNO's 26 articles against the 24 places the
   report counts.
3. The prose is still in the package docstring. A table nobody reads is not the
   comparison; the paragraph is, and deleting it while keeping the table is not
   a silent option.
4. **The database agrees.** Points 1-3 only check the file against itself. A
   real ``seed_mythology`` run is inspected and each declared nature is held to
   what actually landed: a TRANSCRIBED corpus carries its own text and cites no
   actor, a DERIVED one carries no text at all and cites an actor plus the
   ``powers_json`` key its clause lives under, and an ABSENT one has no rows.

Rule 1 of ``tests/test_seed_mythology.py`` (do not import the seed tables, or
every assertion becomes a tautology) is honoured where it applies: the counts,
natures and markers below are written out by hand and compared against
``CORPUS_PROVENANCE``, never read from it.
"""
import io
import re

import pytest
from django.core.management import call_command

from apps.actors import mythology
from apps.judgment.models import Statute, StatuteCorpus
from apps.souls.models import Civilization

# --------------------------------------------------------------------------
# The comparison, written out a second time by hand. If this disagrees with
# CORPUS_PROVENANCE, one of the two moved and the other did not.
#
# `nature`  TRANSCRIBED — the article's text is a literal in this repo
#           DERIVED     — the text lives on another row; the article points at it
#           ABSENT      — nothing is seeded, and that is a conclusion
# `marker`  a phrase that must still be somewhere in the package docstring.
# --------------------------------------------------------------------------
EXPECTED = {
    "GONGGUOGE": {
        "nature": "TRANSCRIBED",
        "civilization": "chinese",
        "count": 74,
        "marker": "74 transcribed articles under corpus GONGGUOGE",
    },
    "NEGATIVE_CONFESSION": {
        "nature": "DERIVED",
        "civilization": "egyptian",
        "count": 42,
        "marker": "NOT here. The 42 clauses are already in the database",
    },
    "DEADLY_SIN": {
        "nature": "TRANSCRIBED",
        "civilization": "european",
        "count": 7,
        "marker": "here, below, as EUROPEAN_STATUTES. Seven articles, one per",
    },
    # Europe has TWO corpora and they are not alternatives: the seven capital
    # sins order the terraces of Purgatorio, Aristotle's tripartition orders
    # the circles of the Inferno (Inf. XI.79-84), and joining the two produces
    # the chart 8308204 was withdrawn for. 26 articles: nine circles, three
    # gironi, ten bolge, four zones of Cocytus.
    "INFERNO": {
        "nature": "TRANSCRIBED",
        "civilization": "european",
        "count": 26,
        "marker": "A SECOND EUROPEAN CORPUS AND NOT MORE ARTICLES IN THE FIRST,",
    },
    "GORGIAS": {
        "nature": "TRANSCRIBED",
        "civilization": "greek",
        "count": 12,
        "marker": "THE SOURCE ITSELF ENUMERATES",
    },
    "REPUBLIC_ER": {
        "nature": "TRANSCRIBED",
        "civilization": "greek",
        "count": 11,
        "marker": "WHY A SECOND GREEK CORPUS AND NOT MORE ARTICLES IN THE FIRST.",
    },
    "HELL_LAW": {
        "nature": "ABSENT",
        "civilization": "chinese",
        "count": 0,
        "marker": "HELL_LAW STAYS EMPTY, AND THAT IS STILL THE FINDING.",
    },
}

# The one corpus that is short of its own document's stated count. 救濟門 is
# titled 十二條 and both independent transcriptions segment it into 11; 不軌門 is
# titled 六條 and both give 5. The gaps are recorded on the rows and NOT filled,
# because filling them is how the withdrawn corpus was built.
GONGGUOGE_GAP_GATES = ("救濟門", "不軌門")


@pytest.fixture
def seeded(db):
    """A database with seed_mythology applied once."""
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out)
    return out.getvalue()


def _squash(text):
    """Collapse whitespace so re-wrapping the prose does not fail a marker."""
    return re.sub(r"\s+", " ", text)


# --------------------------------------------------------------------------
# 1. Every corpus declares where its text comes from
# --------------------------------------------------------------------------
def test_every_corpus_in_the_enum_declares_its_provenance():
    declared = set(mythology.CORPUS_PROVENANCE)
    known = {member.value for member in StatuteCorpus}

    assert declared == known, (
        f"CORPUS_PROVENANCE and StatuteCorpus disagree. Undeclared corpora: "
        f"{sorted(known - declared)}; declared but not a corpus: "
        f"{sorted(declared - known)}. Every corpus has to say whether its text "
        f"is transcribed into this repo, derived from a row this repo seeds, or "
        f"absent on purpose — the fabricated HELL_LAW articles were written "
        f"because that question was never asked of a new corpus."
    )


def test_every_civilization_is_accounted_for_by_some_corpus():
    """The other direction, and the one that was missing.

    The test above walks ``StatuteCorpus`` and asks each member to declare
    itself. That question cannot be asked of a civilization that appears in no
    corpus at all — there is no member to iterate — so GREEK sat with zero
    statutes and no entry anywhere while the suite stayed green. It was the
    only undeclared emptiness in the system: HELL_LAW is empty too, but it is
    empty and SAYS SO, and the finding is held in place three lines down.

    An enumeration is only as good as its subject list, and this file had the
    wrong one. Walking civilizations is what makes "which rulebook does this
    cosmology judge by" a question the suite asks of all four rather than of
    however many corpora happen to exist.

    NOT SATISFIED BY A ROW COUNT. A corpus may legitimately have no articles —
    that is exactly what ABSENT means. What a civilization may not have is no
    ENTRY: no statement, anywhere, of whether its rulebook was transcribed,
    derived from other rows, or investigated and found not to exist.
    """
    declared = {
        entry["civilization"] for entry in mythology.CORPUS_PROVENANCE.values()
    }
    missing = {
        member.value for member in Civilization
        if member.value.lower() not in declared
    }

    assert not missing, (
        f"These civilizations judge by no declared rulebook: {sorted(missing)}. "
        f"Every cosmology needs an entry in CORPUS_PROVENANCE even when it has "
        f"no articles — HELL_LAW has none and declares ABSENT, and that "
        f"declaration is the difference between a finding and an oversight. "
        f"Add a corpus for it, or add an ABSENT entry saying what was looked "
        f"for and not found."
    )


def test_the_declared_natures_are_the_ones_that_were_verified():
    wrong = {
        corpus: (mythology.CORPUS_PROVENANCE[corpus]["nature"], expected["nature"])
        for corpus, expected in EXPECTED.items()
        if mythology.CORPUS_PROVENANCE[corpus]["nature"] != expected["nature"]
    }

    assert not wrong, (
        f"A corpus changed provenance nature (declared, expected): {wrong}. "
        f"TRANSCRIBED means this repo is the author of the stored text and owes "
        f"it a primary source; DERIVED means the text belongs to another row and "
        f"must never be copied here; ABSENT means the corpus was investigated "
        f"and found not to exist. These are not interchangeable labels."
    )


def test_the_declared_civilizations_and_counts_still_hold():
    mismatches = {}
    for corpus, expected in EXPECTED.items():
        entry = mythology.CORPUS_PROVENANCE[corpus]
        if entry["civilization"] != expected["civilization"]:
            mismatches[f"{corpus}.civilization"] = (
                entry["civilization"], expected["civilization"]
            )
        if entry["article_count"] != expected["count"]:
            mismatches[f"{corpus}.article_count"] = (
                entry["article_count"], expected["count"]
            )

    assert not mismatches, (
        f"CORPUS_PROVENANCE no longer matches the hand-written copy in this "
        f"file (declared, expected): {mismatches}."
    )


def test_the_gongguoge_gap_is_declared_rather_than_closed():
    """74 against a claimed 75, and the shortfall is named, not filled."""
    gap = mythology.CORPUS_PROVENANCE["GONGGUOGE"]["known_gap"]

    assert gap, (
        "GONGGUOGE's `known_gap` was emptied. The corpus transcribes 74 articles "
        "against a document that titles its gates at 75; a declaration that says "
        "nothing about the shortfall reads as a complete transcription."
    )
    missing = [gate for gate in GONGGUOGE_GAP_GATES if gate not in gap]
    assert not missing, (
        f"GONGGUOGE's `known_gap` no longer names {missing}. Those are the two "
        f"gates whose titled count and transcribed count disagree, and naming "
        f"them is what stops the next reader from 'completing' the corpus."
    )


def test_the_inferno_gap_is_declared_rather_than_closed():
    """26 articles against a report that counts 24 places, and the difference
    is named.

    The Antinferno (Inf. III) is a real place in the poem and is not one of the
    nine circles, so it is not transcribed. A declaration that said nothing
    about it would present the corpus as covering the whole of hell, and the
    next reader would either write the missing article or quietly restate one
    count as the other.
    """
    gap = mythology.CORPUS_PROVENANCE["INFERNO"]["known_gap"]

    assert gap, (
        "INFERNO's `known_gap` was emptied. The corpus transcribes the nine "
        "circles and their subdivisions and leaves out the Antinferno; a "
        "declaration with no shortfall in it reads as the whole Inferno."
    )
    missing = [
        phrase for phrase in ("Antinferno", "Inf. III", "24", "26")
        if phrase not in gap
    ]
    assert not missing, (
        f"INFERNO's `known_gap` no longer names {missing}. Naming the omitted "
        f"place and both counts is what stops the next reader from 'completing' "
        f"the corpus."
    )


def test_hell_law_is_declared_absent_rather_than_unfinished():
    entry = mythology.CORPUS_PROVENANCE["HELL_LAW"]

    assert entry["module"] is None and entry["source"] is None, (
        f"HELL_LAW acquired a module ({entry['module']!r}) or a source "
        f"({entry['source']!r}). There is no codified 冥律 to transcribe; a "
        f"source appearing here means one was constructed."
    )
    assert entry["known_gap"] and "Not a gap" in entry["known_gap"], (
        "HELL_LAW's emptiness stopped saying it is a finding. An empty corpus "
        "that does not say why it is empty is indistinguishable from a backlog "
        "item, and the last reader who took it for one wrote CN-HL-O01..M07."
    )


# --------------------------------------------------------------------------
# 2. The prose the table summarises is still there
# --------------------------------------------------------------------------
def test_the_comparison_is_still_written_out_in_the_package_docstring():
    """The table is the checkable form; the paragraph is the readable one.

    Both are required. A reader who opens the package to find out whether the
    Egyptian clauses may be edited in place needs the sentence that says why
    they may not, not a dict entry reading ``"nature": "DERIVED"``.
    """
    doc = _squash(mythology.__doc__ or "")

    missing = {
        corpus: expected["marker"]
        for corpus, expected in EXPECTED.items()
        if _squash(expected["marker"]) not in doc
    }

    assert not missing, (
        f"apps/actors/mythology/__init__.py's docstring no longer states the "
        f"provenance of: {sorted(missing)}. Missing phrases: {missing}. This is "
        f"the note that used to sit above all three statute tables in "
        f"seed_mythology.py and was the reason given for not splitting that "
        f"file. It moved to the package; it may not evaporate there."
    )


def test_each_corpus_declaration_carries_its_docstring_marker():
    """The table's own pointer into the prose, so the two cannot drift apart."""
    broken = {
        corpus: entry.get("docstring_marker")
        for corpus, entry in mythology.CORPUS_PROVENANCE.items()
        if not entry.get("docstring_marker")
        or _squash(entry["docstring_marker"]) not in _squash(mythology.__doc__ or "")
    }

    assert not broken, (
        f"These corpus declarations point at prose that is no longer in the "
        f"package docstring: {broken}. Either the paragraph was rewritten "
        f"without updating the marker, or the marker was blanked."
    )


# --------------------------------------------------------------------------
# 3. And the database does what the declarations say
# --------------------------------------------------------------------------
@pytest.mark.usefixtures("seeded")
def test_seeded_article_counts_match_the_declarations():
    actual = {
        corpus: Statute.all_objects.filter(corpus=corpus, is_deleted=False).count()
        for corpus in EXPECTED
    }
    wrong = {
        corpus: (actual[corpus], expected["count"])
        for corpus, expected in EXPECTED.items()
        if actual[corpus] != expected["count"]
    }

    assert not wrong, (
        f"seed_mythology wrote a different number of articles than the "
        f"provenance table declares (seeded, declared): {wrong}. Full count: "
        f"{actual}."
    )


@pytest.mark.usefixtures("seeded")
def test_transcribed_corpora_carry_their_own_text_and_cite_no_actor():
    """TRANSCRIBED means this repo is the author of the stored text."""
    offenders = {}
    for corpus, expected in EXPECTED.items():
        if expected["nature"] != "TRANSCRIBED":
            continue
        for statute in Statute.all_objects.filter(corpus=corpus, is_deleted=False):
            problems = []
            if not statute.text_zh.strip():
                problems.append("no text_zh — a transcribed article with no text")
            if statute.source_actor_id is not None:
                problems.append("source_actor is set — that is a DERIVED row")
            if statute.source_actor_field:
                problems.append(
                    f"source_actor_field={statute.source_actor_field!r} — that is "
                    f"a DERIVED row"
                )
            if not statute.source.strip():
                problems.append("no `source` — transcription with no provenance")
            if problems:
                offenders[statute.code] = problems

    assert not offenders, (
        f"Articles in a TRANSCRIBED corpus do not look transcribed: {offenders}. "
        f"A transcribed article stores the text and names the document it came "
        f"from; if it points at an actor instead, its corpus is mis-declared."
    )


@pytest.mark.usefixtures("seeded")
def test_the_derived_corpus_stores_no_text_and_points_at_the_row_that_does():
    """DERIVED means the text belongs to another row and is never copied here.

    This is the assertion the Egyptian side exists to make. Pasting the 42
    clauses into a statute would make this repo the second author of a text it
    does not own, and the two copies would disagree the first time one was
    corrected.
    """
    offenders = {}
    rows = Statute.all_objects.filter(
        corpus=StatuteCorpus.NEGATIVE_CONFESSION, is_deleted=False
    ).select_related("source_actor")

    for statute in rows:
        problems = []
        for field in ("text_zh", "text_en", "text_egy"):
            if getattr(statute, field).strip():
                problems.append(
                    f"{field} is populated — the clause was copied instead of "
                    f"referenced"
                )
        if statute.source_actor_id is None:
            problems.append("no source_actor — nothing to derive the clause from")
        if statute.source_actor_field != "negative_confession":
            problems.append(
                f"source_actor_field={statute.source_actor_field!r}, expected "
                f"'negative_confession'"
            )
        else:
            clause = (statute.source_actor.powers_json or {}).get(
                "negative_confession", ""
            )
            if not clause:
                problems.append(
                    f"{statute.source_actor.name} carries no negative_confession — "
                    f"the article derives to nothing"
                )
        if problems:
            offenders[statute.code] = problems

    assert not offenders, (
        f"The derived Egyptian corpus stopped being derived: {offenders}."
    )


@pytest.mark.usefixtures("seeded")
def test_the_absent_corpus_seeds_nothing_at_all():
    """Including tombstones: 0012's withdrawn rows must not come back alive."""
    live = sorted(
        Statute.all_objects.filter(
            corpus=StatuteCorpus.HELL_LAW, is_deleted=False
        ).values_list("code", flat=True)
    )

    assert not live, (
        f"HELL_LAW has live articles again: {live}. There is no codified 冥律 — "
        f"《玉历宝钞》 is a hall-by-hall morality tract with no article numbers "
        f"and no sentence lengths — and CN-HL-O01..M07 were withdrawn in 8308204 "
        f"for exactly that reason. A corpus returns only with a primary text "
        f"that has the shape the model claims."
    )


@pytest.mark.usefixtures("seeded")
def test_the_transcription_gap_survived_into_the_database():
    """The two 功過格 gaps are carried on the rows, not smoothed away.

    Declaring the gap in CORPUS_PROVENANCE and then seeding 74 tidy articles
    that say nothing about it would put the caveat somewhere no query reaches.
    """
    flagged = {
        statute.code: statute.payload_json.get("transcription_gap")
        for statute in Statute.all_objects.filter(
            corpus=StatuteCorpus.GONGGUOGE, is_deleted=False
        )
        if isinstance(statute.payload_json, dict)
        and statute.payload_json.get("transcription_gap")
    }

    assert flagged, (
        "No seeded 功過格 article carries payload.transcription_gap. The corpus "
        "transcribes 74 articles from a document whose gate titles total 75; the "
        "shortfall is recorded on the rows it falls in, and a database with no "
        "trace of it presents an incomplete transcription as a complete one."
    )
    unmarked = [
        code for code, gap in flagged.items()
        if not isinstance(gap, dict) or not gap.get("conjecture")
    ]
    assert not unmarked, (
        f"These transcription_gap payloads no longer record the conjecture that "
        f"goes with them: {unmarked}. The verification report marks the likeliest "
        f"split points AS CONJECTURE; a gap recorded without that reads as a "
        f"known missing article and invites somebody to write it."
    )
