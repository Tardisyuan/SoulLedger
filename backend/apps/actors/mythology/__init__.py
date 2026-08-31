"""The mythology reference corpora, and the contract between them.

`manage.py seed_mythology` writes what is in this package. The command is the
entry point and the write path (`seeding.py`); every row it writes is a literal
in one of the sibling modules:

    realms.py             the four cosmologies' places, and REALM_PARENTS
    actors_chinese.py     the ten kings and the officers of the courts
    actors_european.py    the Christian figures and the three Dante borrowed
    actors_greek.py       Plato's three judges, Hades, and Plato's Minos
    actors_egyptian.py    the nine principals of the Hall, and the bench of 42
    statutes_chinese.py   GONGGUOGE — provenance, gates, row builder
    gongguoge_entries.py  GONGGUOGE — the 74 transcribed segments
    statutes_european.py  DEADLY_SIN — the seven terraces
    statutes_inferno.py   INFERNO — provenance, the wall of Dis, row builder
    statutes_inferno_entries.py
                          INFERNO — the 26 transcribed places
    statutes_egyptian.py  NEGATIVE_CONFESSION — the pointer, and no text

WHY THE NOTE BELOW IS IN THE PACKAGE AND NOT IN ANY ONE MODULE. The three
statute corpora are not the same kind of object — one is transcribed, one is
derived from rows this same command writes, and a fourth corpus is empty on
purpose. That comparison is the load-bearing fact about this data, and it is a
fact *between* the corpora: filed under any one of them it would be read as
that corpus's own footnote and lost the moment somebody read only the other
two. It is repeated in machine-readable form as CORPUS_PROVENANCE below, which
`backend/tests/test_corpus_provenance.py` checks against both this docstring
and the database a real seed run produces.

READING THE POINTERS IN THE COMMENTS. Every comment in this package — the note
below and the ones on the tables in the sibling modules — is moved word for
word out of the single file that used to hold all of this, so a comment saying
"above", "below" or "this file" means the one file, not the module it now sits
in. Nothing they say about the data changed; only the addresses did. Every
table named in one of them is importable from this package (see __all__), and
the ones the note below points at resolve like this:

    "here, below, as CHINESE_STATUTES"   -> statutes_chinese.py (74 rows),
                                            gongguoge_entries.py (the text)
    "the block above CHINESE_STATUTES"   -> the module docstring and header
                                            comment of statutes_chinese.py
    "here, below, as EUROPEAN_STATUTES"  -> statutes_european.py
    "NOT here" / "not written in this
    file" (the Egyptian corpus)          -> still not written anywhere in this
                                            package; statutes_egyptian.py holds
                                            the pointer and nothing else
    "seeded above" (the assessors)       -> actors_egyptian.py
    "the note on StatuteCorpus"          -> apps/judgment/models.py, unmoved

Statutes — the articles a verdict can cite (apps.judgment.models.Statute)

SIX CORPORA ARE SEEDED, AND THE LARGEST ONE IS NOT WRITTEN IN THIS FILE.

  CHINESE   — here, below, as CHINESE_STATUTES: 《太微仙君功過格》 (1171),
              74 transcribed articles under corpus GONGGUOGE. This is the
              SECOND attempt at the Chinese side too, and it is a different
              kind of document from the one that was withdrawn — not a penal
              code but a ledger the living keep on themselves. Read the block
              above CHINESE_STATUTES before touching it; the appropriation it
              documents is the whole reason this corpus is allowed to exist
              here at all.

  EGYPTIAN  — NOT here. The 42 clauses are already in the database on the
              assessors' `powers_json["negative_confession"]`, seeded above
              with their edition recorded. `_seed_derived_statutes` builds a
              citation row that POINTS AT each assessor; the text is read
              back through `Statute.derived_text` at display time. Pasting
              the 42 clauses into this file would make it the second author
              of a text it does not own, and the two copies would disagree
              the first time one was corrected — the "two hand-maintained
              copies" failure this seeder was consolidated to end.

  EUROPEAN  — here, below, as EUROPEAN_STATUTES. Seven articles, one per
              terrace of Mount Purgatory. This is the SECOND attempt at this
              corpus; the first was withdrawn, and the difference between
              them is the whole point of the note that follows.

  EUROPEAN  — and, separately, as INFERNO_STATUTES: 26 articles for the
              nine circles of the Inferno, the three gironi of the seventh,
              the ten bolge of Malebolge and the four zones of Cocytus.
              A SECOND EUROPEAN CORPUS AND NOT MORE ARTICLES IN THE FIRST,
              because the two are different structures in different canticles
              ordered by different things: the seven capital sins order the
              terraces, Aristotle's tripartition orders the circles (Inf.
              XI.79-84), and the finding of verify-christian-structure.md is
              that joining them produces a chart existing nowhere in Dante.
              No article in either cites the other's coordinate.

  GREEK     — here, as GORGIAS_STATUTES: 12 articles from Plato's Gorgias
              523a-526d, and separately as REPUBLIC_ER_STATUTES: 11 from
              Republic X 614b-621b. WHY A SECOND GREEK CORPUS AND NOT MORE
              ARTICLES IN THE FIRST. The same reason Europe has two. Both are
              Plato and both are the judgement of the dead, and they describe
              different afterlives: Gorgias stamps a soul, sends it to
              Tartarus or the Isles, and stops — no term, no return, no
              arithmetic in it anywhere — while Republic X sentences it to a
              thousand-year circuit at tenfold the wrong and then sends it
              back to be born again. One corpus would assert a terminal
              sentence AND a return, which is neither dialogue. No article in
              either cites the other.

              THE SOURCE ITSELF ENUMERATES — that is the property the four
              older corpora share and neither Platonic myth has. 74 numbered
              articles, 42 assessors, 7 terraces, 9 circles: each inherits a
              series from its document. Plato's myths inherit none, so a Greek
              article is a RULE OF THE COURT rather than an offence — the
              reform, the bench, the venue, the rule of evidence, the purpose
              of punishment, the rate and the unit — and carries the polarity
              PROCEDURE, added with these two. 21 of the 23 do, and the
              other two are both from the Er myth — 21 + 1 + 1, not 21 + 1.

              GR-ER-04 is the OFFENCE: Republic X 615b, which names three
              wrongs after "for example" and closes with "any other evil
              behaviour". That catch-all is a refusal to enumerate, not a lost
              list, and filling it is precisely how HELL_LAW was written.

              GR-ER-05 is the MERIT, and this paragraph used to omit it while
              saying "exactly one" — 21 + 1 leaves a row unaccounted for, which
              is the same arithmetic failure the 175-vs-170 corpus count had.
              615b credits good deeds on the same tenfold scale it debits bad
              ones, so the Er myth is the one Greek text that scores in both
              directions.

              GREEK'S EMPTINESS WAS THE ONLY UNDECLARED ONE. HELL_LAW is empty
              and says so. GREEK had no corpus at all, hence no entry, and the
              guard could not notice because it walked StatuteCorpus members —
              a civilization appearing in no corpus is invisible to a check
              that iterates corpora. It walks civilizations now.

WITHDRAWN: THE CHINESE (HELL_LAW) CORPUS.
RE-ANCHORED: THE EUROPEAN (DEADLY_SIN) ONE.

Commit 6017f04 seeded thirteen Chinese rows (CN-HL-O01..O06, CN-HL-M01..M07)
and seven European ones (EU-DS-01..07) from this file. Both tables were
removed in 8308204 after independent verification of their sources. Rows that
already reached a database are soft-deleted by
apps/judgment/migrations/0012_withdraw_fabricated_statutes.py — reversibly,
and never over a row a judgment has actually cited.

THE FRAME WAS FABRICATED, NOT MERELY THE DETAIL. This is the distinction
that decides what may be done about it:

  CHINESE — there is no codified 冥律. The primary text behind docs/11,
    《玉历宝钞》, is a morality tract narrated hall by hall: it has no article
    numbers, no sentence lengths in years, and nothing with the form of a
    律. `article_number` and `min_punishment_years` were therefore a modern
    statute-book shell fitted over a text that has no statutes, and the
    citation codes CN-HL-* asserted an article numbering that no source
    contains. docs/11 §1.2 additionally cites 《太上老君律》 — no work stands
    under that exact title in the Daozang. What does stand there, one
    character away, is 《太上老君經律》 (洞神部戒律類), which is a discipline
    code for the LIVING and not an infernal one; it is the likeliest thing
    docs/11 was misremembering, and naming it is more useful to a later
    reader than the flat claim that nothing exists. The §4.1 list
    was not "十恶 with four missing" either: 饮酒 is not one of Buddhism's
    ten evils at all, so the list held five wrong absences plus one entry
    that does not belong, and §4.2's seven had no correspondence to the
    十善业道 whatsoever. See scratchpad/verify-cn-structure.md.

  EUROPEAN — the Inferno is not stratified by the seven capital sins. Dante
    layers hell on Aristotle's tripartite scheme (Inf. XI.79-84), and three
    of the seven — pride, envy, sloth — have no circle at all. The structure
    that IS ordered by the seven is the Purgatorio's seven terraces, which
    this deployment did not model. The ordering was attributed to Gregory
    the Great but does not match his: for Gregory pride is not one of the
    seven, it is the root from which they grow. And EU-DS-07's punishment
    ("被铁笼囚禁", caged in iron) appears in no part of the poem — it was
    invented outright. See docs/lore-verification/verify-christian-structure.md.

WHAT CHANGED FOR EUROPE, AND WHAT DID NOT. The seven sins themselves were
never the finding: the names and the Latin (Superbia, Invidia, Ira, Acedia,
Avaritia, Gula, Luxuria) were right the first time. What failed was the
structure they hung on. The repair is therefore NOT a corrected mapping of
sins onto circles — there is no such mapping to correct. It is a place:
EU_PURGATORY_T1..T7 above are the seven terraces of Purgatorio X-XXVII, which
is the one structure in the Commedia that the seven do order, and every
article below cites its terrace instead of a circle.

`dante_circle` IS RETIRED AND IS NOT COMING BACK. It was never a coordinate
in Dante — it is a later popular chart laying two unrelated taxonomies over
each other, and for pride, envy and sloth it named a circle the poem does not
give them. No row below carries the key, and tests/test_purgatorio_terraces.py
asserts that no seeded statute ever does. `purgatorio_terrace` replaces it and
is a different kind of value: 1-7, checkable against the poem, and against the
realm rows in this same file.

AND THE INFERNO CORPUS IS NOT `dante_circle` COMING BACK EITHER. The retired
key was a circle number hung on a CAPITAL SIN, naming a circle for pride, envy
and sloth that the poem does not give them. In INFERNO_STATUTES the circle is
not an attribute of anything — the circle IS the article, exactly as the
terrace article for wrath IS the third terrace. Nothing there carries the
retired key, and tests/test_purgatorio_terraces.py still asserts that of every
seeded statute in every corpus. What the circles corpus does NOT do is decide
anything: which circle a soul belongs in needs a kind of sin, and
`RecordCategory` is a 功過格 taxonomy with no member that could reach five of
the nine. `_route_european` is unchanged and the contradiction tests in
backend/tests/test_european_hell_basis.py are still green, which is how it
should be read — a citable article is something a judge points at by hand.

26 ARTICLES AGAINST A REPORT THAT COUNTS 24 PLACES. verify-christian-structure
.md §6 counts the Inferno's distinct places at 24: the Antinferno, circles 1-6,
the seventh circle's three gironi, the eighth's ten bolge, the ninth's four
zones. This corpus counts ARTICLES: each of the nine circles gets one, because
a citation of "the eighth circle" needs something to point at, and each of the
seventeen subdivisions gets one — 26. The Antinferno (Inf. III: the gate, the
ignavi, the Acheron, Charon) is not one of the nine circles and is NOT
transcribed; the omission is recorded on EU-INF-C1 as a `transcription_gap`
rather than made up for by re-labelling something else. Two counts of two
different things, and neither is quietly restated as the other.

THE CODES ARE NEW: EU-DS-T1..T7, not EU-DS-01..07. Reusing the old codes
would have been worse than a collision. judgment/0012 deliberately did NOT
retire any withdrawn article a judgment had cited, so a live EU-DS-07 may
exist on a deployed database carrying the iron cage — and `_upsert` matches on
`code`. Re-seeding under the same code would either be skipped as a
soft-deleted row (silently seeding six of seven) or, with --update, rewrite
the recorded grounds of a decided case into a different article. A new
citation key leaves the tombstones legible as what they are.

DO NOT "COMPLETE" THE CHINESE LIST. The obvious repair — supply the four
missing 十恶, the three missing 十善 — is the one repair that must not be
made. Nothing was missing. The list was pinned to a structure the sources do
not have, and filling the holes only produces a more convincing forgery:
correctly-numbered articles of a code that was never written. A corpus
returns here only with a primary text that actually has the shape the model
claims — which is exactly the test the European seven have now passed and
had not before.

WHERE THE CHINESE SIDE WENT. The workable anchor was not a law code but a
merit ledger: 《太微仙君功過格》 (1171, in the Daozang), which really does
enumerate items with signed point values — the shape `polarity` was built
for, and one this system can cite honestly. It has been verified
(docs/lore-verification/gongguoge.md: full text, two independent
transcriptions collated, every point value in the document) and it is seeded
below as CHINESE_STATUTES under a NEW corpus value, GONGGUOGE, not as a
refill of HELL_LAW: a 功過格 is a moral account book kept by the living, not
a penal code administered by hell, and filing one under the other would
rebuild the framing that had to be withdrawn. The citation keys are new for
the same reason as the terraces': CN-GGG-*, never CN-HL-*.

HELL_LAW STAYS EMPTY, AND THAT IS STILL THE FINDING. The Chinese side having
a real corpus does not make 冥律 a document. It is not one, and no amount of
功過格 material changes that. See the note on StatuteCorpus in
apps/judgment/models.py.

WHAT WAS NOT DONE WITH IT. 功過格 has no time decay of any kind — a monthly
balance carries forward at face value — and no periodic settlement is
implemented on top of the existing continuous decay, because that would score
the same deeds twice. The decay in apps/ledger/services.py remains labelled a
product choice, which is what its own comment already said and what the
verification independently confirmed.

EGYPTIAN IS UNAFFECTED. It was never transcribed here (see above), it is
derived from assessor rows whose provenance was checked clause by clause
against Budge's reading of the Nebseni papyrus and cross-checked 42/42
against UCL's Maiherperi papyrus, and it stays.
"""
from apps.actors.mythology.actors_chinese import CHINESE_ACTORS
from apps.actors.mythology.actors_egyptian import (
    EGYPTIAN_ACTOR_ALIASES,
    EGYPTIAN_ACTORS,
    EGYPTIAN_ASSESSORS,
)
from apps.actors.mythology.actors_european import EUROPEAN_ACTORS
from apps.actors.mythology.actors_greek import GREEK_ACTOR_ALIASES, GREEK_ACTORS
from apps.actors.mythology.realms import (
    CHINESE_REALMS,
    EGYPTIAN_REALMS,
    EUROPEAN_REALMS,
    GREEK_REALMS,
    REALM_PARENTS,
)
from apps.actors.mythology.statutes_chinese import (
    CHINESE_STATUTES,
    GONGGUOGE_SOURCE,
)
from apps.actors.mythology.statutes_european import (
    DEADLY_SIN_SOURCE,
    EUROPEAN_STATUTES,
)
from apps.actors.mythology.statutes_gorgias import (
    GORGIAS_SOURCE,
    GORGIAS_STATUTES,
)
from apps.actors.mythology.statutes_inferno import (
    DIS_WALL,
    INFERNO_SOURCE,
    INFERNO_STATUTES,
)
from apps.actors.mythology.statutes_republic import (
    REPUBLIC_ER_SOURCE,
    REPUBLIC_ER_STATUTES,
)
from apps.souls.models import Civilization

# The same comparison, in a form a test can hold to the database.
#
# The prose above is what a reader needs; this is what a check needs. Every
# corpus this system knows of has an entry, `nature` says where its text comes
# from, and tests/test_corpus_provenance.py asserts that each declaration
# matches what `seed_mythology` actually writes — a TRANSCRIBED corpus carries
# its own text and cites no actor, a DERIVED one carries no text and cites one,
# and an ABSENT one seeds nothing at all. Adding a corpus to
# `apps.judgment.models.StatuteCorpus` without declaring it here fails that
# test, which is the point: the distinction below is exactly what was lost the
# last time a corpus was added on the strength of a template.
#
# `docstring_marker` is a phrase out of the note above. It is asserted present,
# so deleting the prose and keeping the table is not a silent option either.
TRANSCRIBED = "TRANSCRIBED"   # the text is a literal in this package
DERIVED = "DERIVED"           # the text lives on another row; the statute points at it
ABSENT = "ABSENT"             # nothing is seeded, and that is a conclusion

CORPUS_PROVENANCE = {
    "GONGGUOGE": {
        "civilization": "chinese",
        "nature": TRANSCRIBED,
        "module": "apps.actors.mythology.statutes_chinese",
        "article_count": 74,
        "source": "《太微仙君功過格》 (1171), 正統道藏 洞真部戒律類雨字號",
        "known_gap": (
            "救濟門 is titled 十二條 and both independent transcriptions segment "
            "it into 11. 74 transcribed against a claimed 75, and the one "
            "remaining gap is recorded in payload.transcription_gap and "
            "deliberately NOT filled — no split point in that gate is supported "
            "by either transcription. 不軌門 WAS the second gap, on the stated "
            "ground that both transcriptions gave 5 against a titled 六條; that "
            "ground was false, ctext gives 6 and the woodblock's own column "
            "layout confirms the break. It was split in judgment/0018 and the "
            "gate is now complete, which is also what makes 過律 add up to the "
            "三十九條 its own heading claims."
        ),
        "docstring_marker": "74 transcribed articles under corpus GONGGUOGE",
    },
    "NEGATIVE_CONFESSION": {
        "civilization": "egyptian",
        "nature": DERIVED,
        "module": "apps.actors.mythology.statutes_egyptian",
        "article_count": 42,
        "source": (
            "Book of the Dead ch. 125B, via the assessor rows in "
            "actors_egyptian.py — Actor.powers_json['negative_confession']"
        ),
        "known_gap": None,
        "docstring_marker": "NOT here. The 42 clauses are already in the database",
    },
    "DEADLY_SIN": {
        "civilization": "european",
        "nature": TRANSCRIBED,
        "module": "apps.actors.mythology.statutes_european",
        "article_count": 7,
        "source": "Dante, Purgatorio X-XXVII — the seven terraces of Mount Purgatory",
        "known_gap": None,
        "docstring_marker": "here, below, as EUROPEAN_STATUTES. Seven articles, one per",
    },
    "INFERNO": {
        "civilization": "european",
        "nature": TRANSCRIBED,
        "module": "apps.actors.mythology.statutes_inferno",
        "article_count": 26,
        "source": (
            "Dante, Inferno IV-XXXIV — the nine circles, the seventh's three "
            "gironi, the eighth's ten bolge, the ninth's four zones of Cocytus"
        ),
        "known_gap": (
            "The Antinferno (Inf. III) — the gate and its inscription, the ignavi, "
            "the Acheron and Charon — is NOT transcribed: it is not one of the nine "
            "circles. verify-christian-structure.md §6 counts the poem's places at 24 "
            "by including it and by not counting a subdivided circle as a place of its "
            "own; this corpus counts 26 articles by giving every circle one and every "
            "subdivision one. The omission is recorded on EU-INF-C1 in "
            "payload.transcription_gap and is deliberately NOT closed."
        ),
        "docstring_marker": "A SECOND EUROPEAN CORPUS AND NOT MORE ARTICLES IN THE FIRST,",
    },
    "GORGIAS": {
        "civilization": "greek",
        "nature": TRANSCRIBED,
        "module": "apps.actors.mythology.statutes_gorgias",
        "article_count": 12,
        "source": (
            "Plato, Gorgias 523a-526d — the myth of the judgement, in Benjamin "
            "Jowett's translation (Project Gutenberg #1672, public domain); "
            "Stephanus sections located against the Perseus canonical Loeb "
            "text (W. R. M. Lamb, 1925)"
        ),
        "known_gap": (
            "The dialogue's closing exhortation (from ἐγὼ μὲν οὖν, ὦ "
            "Καλλίκλεις in 526d, through 527e) is NOT transcribed. Socrates' "
            "resolve to present his soul whole before the judge, and his "
            "charge to Callicles, are what the myth is told FOR; they are not "
            "rules the court is bound by, and this corpus holds rules. The "
            "boundary is deliberate and the omission is not a backlog item. "
            "This field used to read '526d-527e' and thereby declared the "
            "wrong boundary: 526c-d — Minos seated with the golden sceptre — "
            "was also untranscribed and was NOT declared, an undeclared gap "
            "inside a declared range. It is now GR-GRG-12."
        ),
        "docstring_marker": "THE SOURCE ITSELF ENUMERATES",
    },
    "REPUBLIC_ER": {
        "civilization": "greek",
        "nature": TRANSCRIBED,
        "module": "apps.actors.mythology.statutes_republic",
        "article_count": 11,
        "source": (
            "Plato, Republic X 614b-621b — the myth of Er, in Benjamin "
            "Jowett's translation (Project Gutenberg #1497, public domain); "
            "Stephanus sections located against the Perseus canonical Loeb "
            "text (Paul Shorey)"
        ),
        "known_gap": (
            "Four, and two of them are the SOURCE's. (0) 614b — Er's death on "
            "the battlefield, the twelfth-day return on the pyre, and the "
            "frame that makes him the reporter — is inside the cited range and "
            "is NOT transcribed. It is narrative apparatus and states no rule "
            "of the court, which is why it was passed over; it is declared "
            "here because the last time a section inside a declared range went "
            "unremarked, that was GR-GRG-12 (Gorgias 526c-d, Minos with the "
            "golden sceptre), and the actor file was meanwhile asserting he "
            "presided over nothing. An undeclared omission inside a declared "
            "range is the shape, regardless of how load-bearing the passage "
            "is. (1) 615b names three "
            "wrongs after 'for example' and closes with 'any other evil "
            "behaviour' — a refusal to enumerate, not a lost list, recorded on "
            "GR-ER-04. (2) 615c says impiety toward gods and parents, murder, "
            "and children dying at birth draw retributions 'other and greater "
            "far' and never states them; recorded on GR-ER-06 and left open. "
            "(3) This repo's own: the cosmological apparatus at 616c-617c (the "
            "shaft of light, the spindle of Necessity, the whorls, the sirens, "
            "the Fates) and the catalogue of individual choices running "
            "through 620d (Orpheus, Ajax, Odysseus) are not transcribed. Of "
            "618a only the clause GR-ER-09 cites is taken — 'far more "
            "numerous than the assembly', which is why that article's "
            "reference spans two sections. All are within the cited range and "
            "none states a rule."
        ),
        "docstring_marker": (
            "WHY A SECOND GREEK CORPUS AND NOT MORE ARTICLES IN THE FIRST."
        ),
    },
    "HELL_LAW": {
        "civilization": "chinese",
        "nature": ABSENT,
        "module": None,
        "article_count": 0,
        "source": None,
        "known_gap": (
            "Not a gap. There is no codified 冥律: 《玉历宝钞》 is a morality tract "
            "with no article numbers and no sentence lengths, and the corpus that "
            "was written against that shape was withdrawn in 8308204. Emptiness "
            "here is the finding, not a backlog item."
        ),
        "docstring_marker": "HELL_LAW STAYS EMPTY, AND THAT IS STILL THE FINDING.",
    },
}

# --------------------------------------------------------------------------
# Tenants — the administrative record each cosmology's rows are filed under.
# Descriptions are owned by `manage.py seed_tenants`; only the fields this
# command needs to guarantee are set here.
# --------------------------------------------------------------------------
TENANTS = {
    "CN_DIYU": "Chinese Afterlife",
    "EU_HEAVEN_HELL": "European Afterlife",
    "EG_DUAT": "Egyptian Afterlife",
    # GREEK's own tenant, and the reason it needed one: `Soul.civilization` is
    # derived from the soul's tenant code through `TENANT_CIVILIZATION`, so a
    # cosmology with no tenant can never hold a soul. See the note on that map
    # in apps/souls/models.py.
    "GR_HADES": "Greek Afterlife",
}

# CLI label -> the assessor table seeded after that civilization's actors. Kept
# out of CIVILIZATION_DATA so the Chinese and European entries keep their shape.
CIVILIZATION_ASSESSORS = {
    "egyptian": EGYPTIAN_ASSESSORS,
}

# CLI label -> {Actor.name: [other written forms of the same being]}. The rules
# for what qualifies — and what is a canon question wearing an alias's clothes —
# are in EGYPTIAN_ACTOR_ALIASES' header in actors_egyptian.py; the Greek table
# follows them. The Chinese cast has no entry: its `name` and `name_zh` are the
# same string on every row and nothing in this repository writes a second
# rendering of any of the ten kings. The European cast has no entry either — its
# one alias was Hades/Pluto, and it moved to the Greek table with the Hades row.
CIVILIZATION_ACTOR_ALIASES = {
    "greek": GREEK_ACTOR_ALIASES,
    "egyptian": EGYPTIAN_ACTOR_ALIASES,
}

# CLI label -> the corpora TRANSCRIBED into this package for that civilization,
# each as (corpus, source, rows). Egyptian is absent for the opposite reason to
# the other two — its corpus is derived rather than transcribed, see
# _seed_derived_statutes.
#
# A TUPLE OF CORPORA PER CIVILIZATION, NOT ONE. Europe has two and they are not
# alternatives: DEADLY_SIN is the seven capital sins on the terraces of
# Purgatorio, INFERNO is the circles of hell, and the finding that made the
# first corpus get rebuilt is precisely that these are separate structures.
# Collapsing them back into one entry — one corpus per civilization — would put
# the pressure back on whoever comes next to file a circle article under
# DEADLY_SIN because that is where the European statutes go.
CIVILIZATION_STATUTES = {
    "chinese": (
        ("GONGGUOGE", GONGGUOGE_SOURCE, CHINESE_STATUTES),
    ),
    "european": (
        ("DEADLY_SIN", DEADLY_SIN_SOURCE, EUROPEAN_STATUTES),
        ("INFERNO", INFERNO_SOURCE, INFERNO_STATUTES),
    ),
    "greek": (
        ("GORGIAS", GORGIAS_SOURCE, GORGIAS_STATUTES),
        ("REPUBLIC_ER", REPUBLIC_ER_SOURCE, REPUBLIC_ER_STATUTES),
    ),
}

# CLI label -> (Civilization, realms, actors). The CLI label is lowercase for
# typing convenience; the stored value is always the Civilization enum. This
# dict is also what `--civilization` accepts, so a fourth entry here is what
# makes `seed_mythology --civilization=greek` a real option rather than an
# argparse error.
#
# GREEK is fourth, not merged into "european": the two cosmologies answer
# different questions and their rows are owned by different tenants. Seeding
# order matters in one respect only — `_seed_actors` resolves realm FKs against
# `Realm.all_objects.filter(civilization=...)`, i.e. only within the civilization
# being seeded — so every actor's realm must appear in that civilization's own
# realm table. EU_PLATO_MEADOW is therefore listed under GREEK_REALMS and not
# under EUROPEAN_REALMS, even though its code still carries the EU_ prefix it
# was created with.
CIVILIZATION_DATA = {
    "chinese": (Civilization.CHINESE, CHINESE_REALMS, CHINESE_ACTORS),
    "european": (Civilization.EUROPEAN, EUROPEAN_REALMS, EUROPEAN_ACTORS),
    "egyptian": (Civilization.EGYPTIAN, EGYPTIAN_REALMS, EGYPTIAN_ACTORS),
    "greek": (Civilization.GREEK, GREEK_REALMS, GREEK_ACTORS),
}

__all__ = [
    "ABSENT",
    "CHINESE_ACTORS",
    "CHINESE_REALMS",
    "CHINESE_STATUTES",
    "CIVILIZATION_ACTOR_ALIASES",
    "CIVILIZATION_ASSESSORS",
    "CIVILIZATION_DATA",
    "CIVILIZATION_STATUTES",
    "CORPUS_PROVENANCE",
    "DEADLY_SIN_SOURCE",
    "DERIVED",
    "DIS_WALL",
    "EGYPTIAN_ACTORS",
    "EGYPTIAN_ACTOR_ALIASES",
    "EGYPTIAN_ASSESSORS",
    "EGYPTIAN_REALMS",
    "EUROPEAN_ACTORS",
    "EUROPEAN_REALMS",
    "EUROPEAN_STATUTES",
    "GONGGUOGE_SOURCE",
    "GORGIAS_SOURCE",
    "GORGIAS_STATUTES",
    "GREEK_ACTORS",
    "GREEK_ACTOR_ALIASES",
    "GREEK_REALMS",
    "INFERNO_SOURCE",
    "INFERNO_STATUTES",
    "REALM_PARENTS",
    "REPUBLIC_ER_SOURCE",
    "REPUBLIC_ER_STATUTES",
    "TENANTS",
    "TRANSCRIBED",
]
