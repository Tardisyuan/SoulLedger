"""The nine circles of Dante's Hell, and the wall that divides them.

Why this file exists
--------------------
The Inferno was in this database as nine realm rows with one English sentence
each and nothing citable at all. Everything below the ninth circle's name — the
seventh circle's three gironi, the ten bolge that are thirteen of the poem's
thirty-four cantos, the four zones of Cocytus — existed nowhere, and the one
structural fact Dante states outright existed nowhere either: circles 1-5 are
outside the walls of Dis and 6-9 are inside them, and that wall is the line
between incontinenza and malizia (Inf. XI.79-84). Flattening the nine into an
ascending ladder erased it, and an erased wall is exactly what made "seven
capital sins over nine circles" look like a reading somebody could have.
docs/lore-verification/verify-christian-structure.md §2.1, §6.5.

These tests are the comparison, written to the rules
``tests/test_seed_mythology.py`` and ``tests/test_purgatorio_terraces.py``
state:

1. **The expectations are a second, hand-written copy.** Nothing here imports
   the seed tables. Importing them would make every assertion a tautology that
   stays green after somebody moves Malebolge outside the wall.
2. **Failures name the row.**
3. **Absence is asserted too.** Every article is checked for the twenty-five
   contrapassi it must NOT describe, because a bolgia that carries its
   neighbour's punishment satisfies a presence check and is wrong — which is
   how the withdrawn EU-DS-07 came to carry two other pouches' inhabitants plus
   a punishment that is in no pouch at all.
4. **The two European corpora do not touch.** No circle article names a
   terrace, no terrace article names a circle, and no capital sin appears here.

WHAT THIS CORPUS DOES NOT DO, ASSERTED ELSEWHERE. It supplies no sin
classification and routes nothing;
``tests/test_european_hell_basis.py``'s contradiction tests still pass and are
not weakened by anything here. The one assertion in that file this corpus does
change — that Europe had exactly one corpus — is relaxed there, in place, with
the reason written next to it.
"""
import io
import re

import pytest
from django.core.management import call_command

from apps.judgment.models import Statute, StatuteCorpus

# --------------------------------------------------------------------------
# The wall of Dis. THE SECOND, HAND-WRITTEN COPY of
# apps/actors/mythology/statutes_inferno.py::DIS_WALL, and the third is in
# apps/judgment/migrations/0015_inferno_corpus.py::WITHIN_DIS. Three copies on
# purpose: this is the poem's only real divider, and the failure mode for a
# fact that lives in one place is that it moves and nothing notices.
# --------------------------------------------------------------------------
OUTSIDE_DIS = (1, 2, 3, 4, 5)
INSIDE_DIS = (6, 7, 8, 9)

#: circle -> everything about it that a reader could check against the poem.
#: `mark` is a distinctive phrase that must appear in this article's `text_en`
#: and in nobody else's. It is short on purpose: the wording of the prose is
#: free to improve, the fact that the gluttons lie under black snow is not.
CIRCLES = {
    1: {
        "code": "EU-INF-C1", "ordinal": 1, "title_en": "Limbo",
        "title_zh": "第一圈·幽冥边境", "cantos": "Inf. IV",
        "aristotle": None, "guardian": None, "realm": "EU_HELL_1ST",
        "mark": "longing without hope",
    },
    2: {
        "code": "EU-INF-C2", "ordinal": 2, "title_en": "Lust",
        "title_zh": "第二圈·淫欲", "cantos": "Inf. V",
        "aristotle": "incontinenza", "guardian": "Minos", "realm": "EU_HELL_2ND",
        "mark": "wind that never rests",
    },
    3: {
        "code": "EU-INF-C3", "ordinal": 3, "title_en": "Gluttony",
        "title_zh": "第三圈·暴食", "cantos": "Inf. VI",
        "aristotle": "incontinenza", "guardian": "Cerberus", "realm": "EU_HELL_3RD",
        "mark": "black snow",
    },
    4: {
        "code": "EU-INF-C4", "ordinal": 4, "title_en": "Avarice and Prodigality",
        "title_zh": "第四圈·贪婪与挥霍", "cantos": "Inf. VII",
        "aristotle": "incontinenza", "guardian": "Plutus", "realm": "EU_HELL_4TH",
        "mark": "rolling great weights",
    },
    5: {
        "code": "EU-INF-C5", "ordinal": 5, "title_en": "Wrath and the Sullen",
        "title_zh": "第五圈·愤怒（与忧郁沉抑者）", "cantos": "Inf. VII-VIII",
        "aristotle": "incontinenza", "guardian": "Phlegyas", "realm": "EU_HELL_5TH",
        "mark": "gurgling a hymn",
    },
    6: {
        "code": "EU-INF-C6", "ordinal": 6, "title_en": "Heresy",
        "title_zh": "第六圈·异端", "cantos": "Inf. IX-XI",
        "aristotle": None, "guardian": "Furies", "realm": "EU_HELL_6TH",
        "mark": "open tombs",
    },
    7: {
        "code": "EU-INF-C7", "ordinal": 7, "title_en": "Violence",
        "title_zh": "第七圈·暴力（三环）", "cantos": "Inf. XII-XVII",
        "aristotle": "malizia — violenza", "guardian": "Minotaur",
        "realm": "EU_HELL_7TH", "mark": "three rings (gironi)",
    },
    8: {
        "code": "EU-INF-C8", "ordinal": 11, "title_en": "Fraud (Malebolge)",
        "title_zh": "第八圈·欺诈（恶囊 Malebolge，十囊）", "cantos": "Inf. XVIII-XXX",
        "aristotle": "malizia — frode", "guardian": "Geryon",
        "realm": "EU_HELL_8TH", "mark": "concentric stone pouches",
    },
    9: {
        "code": "EU-INF-C9", "ordinal": 22, "title_en": "Treachery (Cocytus)",
        "title_zh": "第九圈·背叛（科奇土斯冰湖 Cocytus，四带）", "cantos": "Inf. XXXI-XXXIV",
        "aristotle": "matta bestialitade", "guardian": "Giants",
        "realm": "EU_HELL_9TH", "mark": "lake of Cocytus",
    },
}

#: (code, ordinal, circle, kind, index, name, cantos, title_en, mark)
#: The seventeen places this deployment had nowhere at all. In the poem's order
#: of descent, which is what `ordinal` is.
SUBDIVISIONS = [
    ("EU-INF-C7-R1", 8, 7, "girone", 1, None, "Inf. XII",
     "Violence against Neighbour", "boiling blood"),
    ("EU-INF-C7-R2", 9, 7, "girone", 2, None, "Inf. XIII",
     "Violence against Self", "thorn trees"),
    ("EU-INF-C7-R3", 10, 7, "girone", 3, None, "Inf. XIV-XVII",
     "Violence against God, Nature and Art", "rain of fire"),
    ("EU-INF-C8-B01", 12, 8, "bolgia", 1, None, "Inf. XVIII",
     "Panders and Seducers", "whipped from behind"),
    ("EU-INF-C8-B02", 13, 8, "bolgia", 2, None, "Inf. XVIII",
     "Flatterers", "excrement"),
    ("EU-INF-C8-B03", 14, 8, "bolgia", 3, None, "Inf. XIX",
     "Simoniacs", "head-down in stone holes"),
    ("EU-INF-C8-B04", 15, 8, "bolgia", 4, None, "Inf. XX",
     "Diviners, Sorcerers and Astrologers", "twisted round backwards"),
    ("EU-INF-C8-B05", 16, 8, "bolgia", 5, None, "Inf. XXI-XXII",
     "Barrators", "boiling pitch"),
    ("EU-INF-C8-B06", 17, 8, "bolgia", 6, None, "Inf. XXIII",
     "Hypocrites", "gilded on the outside"),
    ("EU-INF-C8-B07", 18, 8, "bolgia", 7, None, "Inf. XXIV-XXV",
     "Thieves", "exchanging shape"),
    ("EU-INF-C8-B08", 19, 8, "bolgia", 8, None, "Inf. XXVI-XXVII",
     "Counsellors of Fraud", "wrapped in a single flame"),
    ("EU-INF-C8-B09", 20, 8, "bolgia", 9, None, "Inf. XXVIII-XXIX",
     "Sowers of Discord", "demon's sword"),
    ("EU-INF-C8-B10", 21, 8, "bolgia", 10, None, "Inf. XXIX-XXX",
     "Falsifiers", "dropsy"),
    ("EU-INF-C9-Z1", 23, 9, "zona", 1, "Caina", "Inf. XXXII",
     "Caina — Treachery to Kin", "faces turned down"),
    ("EU-INF-C9-Z2", 24, 9, "zona", 2, "Antenora", "Inf. XXXII-XXXIII",
     "Antenora — Treachery to Country", "Ugolino"),
    ("EU-INF-C9-Z3", 25, 9, "zona", 3, "Tolomea", "Inf. XXXIII",
     "Tolomea — Treachery to Guests", "sealing the eyes"),
    ("EU-INF-C9-Z4", 26, 9, "zona", 4, "Giudecca", "Inf. XXXIV",
     "Giudecca — Treachery to Benefactors", "three mouths"),
]

ARTICLE_COUNT = 26

#: The seven capital sins, in Latin. NONE of them may appear in this corpus.
#: Three have no circle at all and the four that seem to line up with circles
#: 2-5 do so because "incontinence" and those four are adjacent vocabularies.
#: Naming one here would rebuild the chart 8308204 withdrew.
CAPITAL_SINS_LATIN = (
    "Superbia", "Invidia", "Ira", "Acedia", "Avaritia", "Gula", "Luxuria",
)

#: The articles that must record something as unsettled, and what about.
#: Written out by hand: a `conjecture` key silently disappearing is the failure
#: this exists to catch, and an extra one appearing is somebody hedging a fact.
EXPECTED_CONJECTURES = {
    "EU-INF-C5": "accidiosi",       # is the fifth circle's sullenness acedia?
    "EU-INF-C6": "aristotle",       # heresy gets no heading at Inf. XI
    "EU-INF-C7-R1": "Alessandro",   # Alexander the Great, or of Pherae?
    "EU-INF-C9": "bestialitade",    # is treachery what Inf. XI's third heading names?
    "EU-INF-C9-Z1": "CONJECTURE",   # the four zones are named, not numbered
    "EU-INF-C9-Z2": "CONJECTURE",
    "EU-INF-C9-Z3": "CONJECTURE",
    "EU-INF-C9-Z4": "CONJECTURE",
}

#: The one declared omission, and the article it is recorded on.
GAP_CODE = "EU-INF-C1"


@pytest.fixture
def seeded(db):
    """A database with seed_mythology applied once."""
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out)
    return out.getvalue()


def _articles():
    return {
        statute.code: statute
        for statute in Statute.objects.filter(corpus=StatuteCorpus.INFERNO)
    }


def _all_codes():
    """All 26 codes in the poem's order of descent, i.e. by `ordinal`.

    Sorted rather than concatenated: the order is the thing being asserted in
    several places below, and "all nine circles, then all seventeen
    subdivisions" is not an order the poem has.
    """
    pairs = [(c["ordinal"], c["code"]) for c in CIRCLES.values()] + [
        (row[1], row[0]) for row in SUBDIVISIONS
    ]
    return [code for _ordinal, code in sorted(pairs)]


def _all_marks():
    return {terrace["code"]: terrace["mark"] for terrace in CIRCLES.values()} | {
        row[0]: row[8] for row in SUBDIVISIONS
    }


# --------------------------------------------------------------------------
# The twenty-six articles exist and are the twenty-six this file knows about
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_all_twenty_six_places_are_seeded(seeded):
    expected = set(_all_codes())
    found = set(_articles())

    assert len(expected) == ARTICLE_COUNT, "this file's own table is not 26 long"
    missing = sorted(expected - found)
    assert not missing, (
        f"seed_mythology left {len(missing)} of {ARTICLE_COUNT} Inferno articles "
        f"out of the database: {missing}. Seventeen of these places exist "
        f"nowhere else in this system — there is no realm row for a bolgia — so "
        f"an absent article is the place disappearing."
    )
    extra = sorted(found - expected)
    assert not extra, (
        f"The INFERNO corpus holds articles this file does not know about: "
        f"{extra}. Nine circles, three gironi, ten bolge, four zones. A "
        f"twenty-seventh is either a duplicate or a new claim about the poem."
    )


@pytest.mark.django_db
def test_the_ordinals_run_1_to_26_in_the_order_of_descent(seeded):
    """`Statute.Meta.ordering` sorts on `ordinal`, so this is the reading order.

    A per-circle numbering would interleave the first bolgia with the first
    girone and read the corpus out of the order the poem has.
    """
    articles = _articles()
    wrong = {
        code: (articles[code].ordinal, ordinal)
        for code, ordinal in (
            [(c["code"], c["ordinal"]) for c in CIRCLES.values()]
            + [(row[0], row[1]) for row in SUBDIVISIONS]
        )
        if code in articles and articles[code].ordinal != ordinal
    }
    assert not wrong, (
        f"Articles at the wrong ordinal (code -> (found, expected)): {wrong}"
    )

    ordinals = sorted(statute.ordinal for statute in articles.values())
    assert ordinals == list(range(1, ARTICLE_COUNT + 1)), (
        f"The ordinals are not a continuous 1..{ARTICLE_COUNT}: {ordinals}"
    )


# --------------------------------------------------------------------------
# The wall of Dis — the whole reason this is a structure and not a list
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_the_wall_of_dis_divides_the_corpus(seeded):
    """Circles 1-5 outside, 6-9 inside, and every subdivision on its circle's side.

    This is the poem's only real divider and the line between incontinenza and
    malizia (Inf. XI.79-84). A corpus that got it wrong would still look like a
    complete transcription — which is exactly what nine flat realm rows were.
    """
    articles = _articles()
    expected_side = {circle: False for circle in OUTSIDE_DIS} | {
        circle: True for circle in INSIDE_DIS
    }
    assert set(expected_side) == set(range(1, 10)), (
        "this file's own copy of the wall does not cover all nine circles"
    )

    faults = []
    for code, statute in sorted(articles.items()):
        payload = statute.payload_json or {}
        circle = payload.get("circle")
        if circle not in expected_side:
            faults.append(f"{code}: payload circle={circle!r}, not one of 1-9")
            continue
        if payload.get("within_dis") is not expected_side[circle]:
            faults.append(
                f"{code}: circle {circle} says within_dis="
                f"{payload.get('within_dis')!r}, expected {expected_side[circle]}"
            )
        region = payload.get("hell_region")
        wanted = (
            "LOWER_HELL_WITHIN_DIS" if expected_side[circle]
            else "UPPER_HELL_OUTSIDE_DIS"
        )
        if region != wanted:
            faults.append(f"{code}: hell_region={region!r}, expected {wanted!r}")
    assert not faults, (
        "The wall of Dis is in the wrong place:\n  " + "\n  ".join(faults)
    )


@pytest.mark.django_db
def test_the_corpus_is_a_structure_and_not_a_flat_list(seeded):
    """Every subdivision resolves to the circle article it is part of.

    Twenty-six rows numbered 1..26 with nothing joining them would say that a
    bolgia and a circle are the same kind of thing. `parent_code` is what makes
    a citation of "the second bolgia" answerable for which side of the wall it
    is on, and the nine circles carry None because nothing contains them.
    """
    articles = _articles()
    faults = []

    for terrace in CIRCLES.values():
        statute = articles.get(terrace["code"])
        if statute is None:
            continue
        payload = statute.payload_json or {}
        if payload.get("parent_code") is not None:
            faults.append(
                f"{terrace['code']}: a circle was given parent_code="
                f"{payload['parent_code']!r} — nothing contains a circle"
            )
        for key in ("subdivision_kind", "subdivision_index", "subdivision_name"):
            if payload.get(key) is not None:
                faults.append(f"{terrace['code']}: {key}={payload[key]!r} on a circle")

    for code, _ordinal, circle, kind, index, name, *_rest in SUBDIVISIONS:
        statute = articles.get(code)
        if statute is None:
            continue
        payload = statute.payload_json or {}
        parent = payload.get("parent_code")
        expected_parent = CIRCLES[circle]["code"]
        if parent != expected_parent:
            faults.append(
                f"{code}: parent_code={parent!r}, expected {expected_parent!r}"
            )
        elif parent not in articles:
            faults.append(f"{code}: parent {parent} is not a seeded article")
        elif (articles[parent].payload_json or {}).get("within_dis") != payload.get(
            "within_dis"
        ):
            faults.append(
                f"{code} and its circle {parent} disagree about the wall of Dis"
            )
        for key, want in (
            ("subdivision_kind", kind),
            ("subdivision_index", index),
            ("subdivision_name", name),
            ("circle", circle),
        ):
            if payload.get(key) != want:
                faults.append(f"{code}: {key}={payload.get(key)!r}, expected {want!r}")

    assert not faults, "The structure is broken:\n  " + "\n  ".join(faults)


@pytest.mark.django_db
def test_only_cocytus_zones_are_named_places(seeded):
    """Dante names Caina, Antenora, Tolomea, Giudecca. He names no bolgia.

    A name on a pouch would be an invention, and inventing a name for a place
    the poem leaves unnamed is the same move as inventing the iron cage.
    """
    articles = _articles()
    named = {
        code: (statute.payload_json or {}).get("subdivision_name")
        for code, statute in articles.items()
        if (statute.payload_json or {}).get("subdivision_name")
    }
    assert named == {
        "EU-INF-C9-Z1": "Caina",
        "EU-INF-C9-Z2": "Antenora",
        "EU-INF-C9-Z3": "Tolomea",
        "EU-INF-C9-Z4": "Giudecca",
    }, f"Named places in this corpus: {named}"


# --------------------------------------------------------------------------
# What each place actually is
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_each_article_carries_its_own_canto_range(seeded):
    """The citation, present and correct, on all 26.

    An article with no canto range is a claim about the poem that nobody can
    check, which is the state the nine realm rows were in.
    """
    articles = _articles()
    expected = {c["code"]: c["cantos"] for c in CIRCLES.values()} | {
        row[0]: row[6] for row in SUBDIVISIONS
    }
    faults = []
    for code, statute in sorted(articles.items()):
        cantos = (statute.payload_json or {}).get("cantos")
        if not cantos:
            faults.append(f"{code}: no canto range at all")
        elif cantos != expected.get(code):
            faults.append(f"{code}: cantos={cantos!r}, expected {expected.get(code)!r}")
        elif not re.fullmatch(r"Inf\. [IVXL]+(-[IVXL]+)?", cantos):
            faults.append(f"{code}: cantos={cantos!r} is not an Inferno citation")
    assert not faults, "Canto ranges:\n  " + "\n  ".join(faults)


@pytest.mark.django_db
def test_each_article_describes_its_own_contrapasso_and_nobody_else_s(seeded):
    """Presence AND absence, per tests/test_purgatorio_terraces.py's rule.

    Presence alone is satisfied by an article that lists every punishment in
    hell, and by a sixth bolgia that describes the fifth's. The withdrawn
    EU-DS-07 failed exactly this way: it put the second bolgia's inhabitants
    and the fourth's into one sentence and then gave them a punishment from
    neither.
    """
    articles = _articles()
    marks = _all_marks()
    faults = []
    for code, mark in sorted(marks.items()):
        statute = articles.get(code)
        if statute is None:
            continue
        text = statute.text_en or ""
        if mark not in text:
            faults.append(f"{code} does not describe its own {mark!r}: {text!r}")
        intruders = sorted(
            f"{other}'s {alien!r}"
            for other, alien in marks.items()
            if other != code and alien in text
        )
        if intruders:
            faults.append(f"{code} describes {', '.join(intruders)}")
    assert not faults, "Contrapassi on the wrong places:\n  " + "\n  ".join(faults)


@pytest.mark.django_db
def test_the_guardians_are_where_the_poem_posts_them(seeded):
    """Presence and absence: Limbo has no guardian and must say so with None.

    Minos in particular. He judges at the SECOND circle's entrance and assigns
    every soul its circle by coiling his tail (Inf. V.4-12); this deployment
    had him attached to the ninth realm. verify-christian-structure.md §6.6.
    """
    articles = _articles()
    faults = []
    for circle, expected in CIRCLES.items():
        statute = articles.get(expected["code"])
        if statute is None:
            continue
        guardian = (statute.payload_json or {}).get("guardian")
        if expected["guardian"] is None:
            if guardian is not None:
                faults.append(
                    f"circle {circle} was given a guardian ({guardian!r}); Limbo "
                    f"has none in the poem and the blank is the finding"
                )
        elif not guardian or expected["guardian"] not in guardian:
            faults.append(
                f"circle {circle}: guardian={guardian!r}, expected to name "
                f"{expected['guardian']!r}"
            )
    # The three subdivisions the poem posts a guardian on, and no others.
    posted = {
        code: (articles[code].payload_json or {}).get("guardian")
        for code, *_ in SUBDIVISIONS
        if code in articles and (articles[code].payload_json or {}).get("guardian")
    }
    expected_posted = {"EU-INF-C7-R1": "Centaurs", "EU-INF-C7-R2": "Harpies",
                       "EU-INF-C8-B05": "Malebranche", "EU-INF-C9-Z4": "Lucifer"}
    for code, who in expected_posted.items():
        if code not in posted or who not in posted[code]:
            faults.append(f"{code}: guardian={posted.get(code)!r}, expected {who!r}")
    for code in sorted(set(posted) - set(expected_posted)):
        faults.append(f"{code} was given a guardian the report does not post there")
    assert not faults, "Guardians:\n  " + "\n  ".join(faults)


@pytest.mark.django_db
def test_the_aristotelian_headings_are_virgils_and_two_are_blank(seeded):
    """Inf. XI.79-84, and the two places the speech does not reach.

    Circle 1 charges no act — the fault is the absence of baptism — and circle
    6 is inside the wall without a heading in Virgil's discourse. Both carry
    None, and a value appearing on either is somebody's reading being written
    down as the poem's. That is the exact move `dante_circle` was.
    """
    articles = _articles()
    expected = {c["code"]: c["aristotle"] for c in CIRCLES.values()}
    for code, _o, circle, *_rest in SUBDIVISIONS:
        expected[code] = CIRCLES[circle]["aristotle"]

    wrong = {
        code: ((articles[code].payload_json or {}).get("aristotelian_class"), want)
        for code, want in expected.items()
        if code in articles
        and (articles[code].payload_json or {}).get("aristotelian_class") != want
    }
    assert not wrong, (
        f"Aristotelian headings (code -> (found, expected)): {wrong}. Virgil's "
        f"three are incontinenza / malizia / matta bestialitade, malizia "
        f"dividing into violence and fraud; None means the speech gives this "
        f"place no heading and is a finding, not a blank to fill."
    )


# --------------------------------------------------------------------------
# The two European corpora do not touch
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_no_inferno_article_names_a_capital_sin_or_a_terrace(seeded):
    """The seven belong to the mountain, and this corpus may not borrow them.

    Three of them (pride, envy, sloth) have no circle at all; the four that
    seem to line up with circles 2-5 do so because "incontinence" and those
    four are adjacent vocabularies. `8308204` is what fitting them together
    produced.
    """
    faults = []
    for code, statute in sorted(_articles().items()):
        payload = statute.payload_json or {}
        for key in sorted(payload):
            if "terrace" in key or "purgatorio" in key or "dante" in key:
                faults.append(f"{code}: payload carries {key!r}")
        haystack = " ".join(
            [statute.title_en, statute.title_zh, statute.text_en, statute.text_zh]
        )
        for latin in CAPITAL_SINS_LATIN:
            if latin in haystack:
                faults.append(f"{code}: names the capital sin {latin!r}")
        if payload.get("names_a_capital_sin") is not False:
            faults.append(f"{code}: names_a_capital_sin is not False")
    assert not faults, (
        "The circles corpus reached for the terraces' vocabulary:\n  "
        + "\n  ".join(faults)
    )


@pytest.mark.django_db
def test_no_terrace_article_acquired_a_circle(seeded):
    """The other direction, asserted separately.

    tests/test_purgatorio_terraces.py forbids `dante_circle` on every seeded
    statute. This forbids ANY circle coordinate on the seven, because the
    obvious way to undo the 8308204 repair now that circles exist as rows is to
    "link" a terrace to one.
    """
    offenders = {}
    for statute in Statute.objects.filter(corpus=StatuteCorpus.DEADLY_SIN):
        payload = statute.payload_json or {}
        # Exact fragments, not substrings that happen to be inside a word: the
        # terraces legitimately carry `love_disorder` (Purg. XVII), and a
        # careless "dis" would flag it.
        keys = sorted(
            key for key in payload
            if any(
                fragment in key
                for fragment in ("circle", "bolgia", "girone", "within_dis", "cocytus")
            )
        )
        if keys:
            offenders[statute.code] = keys
    assert not offenders, (
        f"Terrace articles carrying a circle coordinate: {offenders}. Pride, "
        f"envy and sloth have no circle; a link from a terrace to one is "
        f"`dante_circle` under another name."
    )


@pytest.mark.django_db
def test_no_seeded_statute_anywhere_carries_dante_circle(seeded):
    """The retired key, re-asserted from this side.

    tests/test_purgatorio_terraces.py already asserts this. It is repeated here
    because that file is about the mountain, and the reader most likely to
    reintroduce the key is the one adding a circle article.
    """
    offenders = sorted(
        code
        for code, payload in Statute.all_objects.values_list("code", "payload_json")
        if isinstance(payload, dict) and "dante_circle" in payload
    )
    assert offenders == [], f"Statutes carrying a `dante_circle`: {offenders}"


# --------------------------------------------------------------------------
# Provenance, and what is deliberately not settled
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_every_article_carries_its_provenance_and_its_caveats(seeded):
    """Source never blank, attestation stated, notes attached.

    The wording of a note is deliberately not asserted — improving it is free,
    deleting it is not — but the attestation split is, because the report's own
    §7 says the detail rests on secondary sources and an article that presented
    it as primary would be overstating what was checked.
    """
    faults = []
    for code, statute in sorted(_articles().items()):
        if not statute.source:
            faults.append(f"{code}: no source")
        elif "Inf. XI.79-84" not in statute.source:
            faults.append(f"{code}: source does not cite the basis at Inf. XI.79-84")
        if not statute.source_notes:
            faults.append(f"{code}: no source_notes")
        attestation = (statute.payload_json or {}).get("attestation")
        if attestation != {"structure": "PRIMARY", "detail": "SECONDARY"}:
            faults.append(f"{code}: attestation={attestation!r}")
        if not statute.text_zh.strip() or not statute.text_en.strip():
            faults.append(f"{code}: an article with no text in one of the two languages")
    assert not faults, "Provenance is missing:\n  " + "\n  ".join(faults)


@pytest.mark.django_db
def test_the_seventeen_subdivisions_record_that_they_have_no_realm(seeded):
    """§6.2-§6.4, carried on the rows rather than only in a report.

    The nine circles are realms; the gironi, bolge and zones are not modelled
    anywhere. A corpus that quietly named a realm for a bolgia would be
    inventing one, and one that said nothing would present seventeen articles
    as if they had somewhere to point.
    """
    articles = _articles()
    faults = []
    for circle, expected in CIRCLES.items():
        statute = articles.get(expected["code"])
        if statute is None:
            continue
        named = (statute.payload_json or {}).get("circle_realm_code")
        if named != expected["realm"]:
            faults.append(
                f"circle {circle}: circle_realm_code={named!r}, expected "
                f"{expected['realm']!r}"
            )
    for code, *_rest in SUBDIVISIONS:
        statute = articles.get(code)
        if statute is None:
            continue
        named = (statute.payload_json or {}).get("circle_realm_code")
        if named is not None:
            faults.append(
                f"{code}: circle_realm_code={named!r} — no realm row exists for a "
                f"girone, a bolgia or a zone of Cocytus, so this names one that "
                f"was invented or borrows the circle's"
            )
    assert not faults, "Realm anchors:\n  " + "\n  ".join(faults)


@pytest.mark.django_db
def test_the_circle_anchors_agree_with_the_router_s_own_table(seeded):
    """The nine codes this corpus names are the nine the router already uses.

    Not a claim that the corpus routes anything — it does not, and
    tests/test_european_hell_basis.py asserts that. It is a claim that the two
    hand-written lists of nine realm codes in this repository are the same nine.
    """
    from apps.disposition.services import DispositionService

    articles = _articles()
    named = {
        circle: (articles[expected["code"]].payload_json or {}).get("circle_realm_code")
        for circle, expected in CIRCLES.items()
        if expected["code"] in articles
    }
    assert named == DispositionService.EU_HELL_CIRCLES, (
        f"The corpus and DispositionService.EU_HELL_CIRCLES name different "
        f"realms for the nine circles: {named} vs "
        f"{DispositionService.EU_HELL_CIRCLES}"
    )


@pytest.mark.django_db
def test_exactly_the_unsettled_things_are_marked_unsettled(seeded):
    """A conjecture that quietly becomes a fact is the failure mode here.

    Both directions. A missing `conjecture` presents a reading as the poem's;
    an extra one hedges something the poem does state, which makes the marked
    ones cheaper to ignore.
    """
    articles = _articles()
    found = {
        code: (statute.payload_json or {}).get("conjecture")
        for code, statute in articles.items()
        if (statute.payload_json or {}).get("conjecture")
    }
    assert set(found) == set(EXPECTED_CONJECTURES), (
        f"Articles marked as conjecture: {sorted(found)}, expected "
        f"{sorted(EXPECTED_CONJECTURES)}. Unmarked: "
        f"{sorted(set(EXPECTED_CONJECTURES) - set(found))}; newly marked: "
        f"{sorted(set(found) - set(EXPECTED_CONJECTURES))}."
    )
    wrong = {
        code: found[code]
        for code, about in EXPECTED_CONJECTURES.items()
        if about not in found[code]
    }
    assert not wrong, (
        f"These conjectures no longer record what they were about: "
        f"{sorted(wrong)}. Expected each to mention "
        f"{ {c: EXPECTED_CONJECTURES[c] for c in wrong} }."
    )


@pytest.mark.django_db
def test_the_antinferno_is_declared_missing_rather_than_papered_over(seeded):
    """26 articles against a report that counts 24 places, and the difference
    is stated on a row.

    The Antinferno (Inf. III: the gate, the ignavi, the Acheron, Charon) is not
    one of the nine circles and is not transcribed. Recording it as a gap is
    what stops the next reader from either "completing" the corpus with an
    invented article or quietly restating one count as the other.
    """
    statute = Statute.objects.get(code=GAP_CODE)
    gap = (statute.payload_json or {}).get("transcription_gap")

    assert isinstance(gap, dict), (
        f"{GAP_CODE} carries no transcription_gap. Limbo is the first circle "
        f"and the Antinferno is below it and outside this corpus; without the "
        f"note, 26 articles read as a complete transcription of the poem."
    )
    text = " ".join(str(value) for value in gap.values())
    for phrase in ("Antinferno", "Inf. III", "24", "26"):
        assert phrase in text, (
            f"{GAP_CODE}'s transcription_gap no longer mentions {phrase!r}: {gap!r}"
        )

    others = sorted(
        code
        for code, statute in _articles().items()
        if code != GAP_CODE and (statute.payload_json or {}).get("transcription_gap")
    )
    assert others == [], (
        f"Other articles acquired a transcription_gap: {others}. This corpus has "
        f"one declared omission; a second means something else was left out."
    )


@pytest.mark.django_db
def test_reseeding_changes_nothing(seeded):
    before = list(
        Statute.objects.filter(corpus=StatuteCorpus.INFERNO)
        .order_by("code")
        .values_list("code", "update_time")
    )
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out)
    after = list(
        Statute.objects.filter(corpus=StatuteCorpus.INFERNO)
        .order_by("code")
        .values_list("code", "update_time")
    )
    assert after == before, "Second run rewrote the Inferno corpus"
    assert "created=0" in out.getvalue(), f"Second run created rows:\n{out.getvalue()}"


# --------------------------------------------------------------------------
# The migration
# --------------------------------------------------------------------------


@pytest.mark.django_db
class TestInfernoMigration:
    """judgment/0015 puts the 26 citation keys on databases that already have
    a cosmology.

    A fresh database never runs its body — the guard sees an empty statute
    table and returns, and `seed_mythology` writes everything including the
    text. An existing one gets the identifying columns and the coordinates
    here, and the prose from the next `seed_mythology --update`. Same division
    as realms/0013, 0014, 0016 and judgment/0013.
    """

    @pytest.fixture
    def migration(self):
        from importlib import import_module

        return import_module("apps.judgment.migrations.0015_inferno_corpus")

    @pytest.fixture
    def registry(self):
        from django.apps import apps as django_apps

        return django_apps

    def test_the_skeleton_is_the_twenty_six_this_file_expects(self, migration):
        """The migration's own hand-written table, held to this file's.

        It restates the wall of Dis and the subdivision counts on purpose (see
        its docstring), which is only worth anything if the restatement is
        checked against something.
        """
        rows = migration._skeleton()
        assert [code for code, _o, _p in rows] == _all_codes(), (
            "the migration builds a different set of codes than seed_mythology"
        )
        assert [ordinal for _c, ordinal, _p in rows] == list(
            range(1, ARTICLE_COUNT + 1)
        )
        for code, _ordinal, payload in rows:
            circle = payload["circle"]
            assert payload["within_dis"] is (circle in INSIDE_DIS), (
                f"{code}: the migration puts circle {circle} on the wrong side "
                f"of the wall of Dis"
            )

    def test_it_creates_the_twenty_six_on_a_database_that_has_statutes(
        self, migration, registry, seeded
    ):
        codes = _all_codes()
        Statute.all_objects.filter(code__in=codes).delete()
        assert not Statute.all_objects.filter(code__in=codes).exists()

        migration.forwards(registry, None)

        rebuilt = dict(
            Statute.all_objects.filter(code__in=codes).values_list("code", "ordinal")
        )
        assert set(rebuilt) == set(codes), (
            f"Migration created {sorted(rebuilt)}, expected {sorted(codes)}"
        )
        # It inherits a European tenant rather than guessing a tenant code.
        tenants = set(
            Statute.all_objects.filter(code__in=codes).values_list(
                "tenant__code", flat=True
            )
        )
        assert tenants == {"EU_HEAVEN_HELL"}, f"Tenants assigned: {tenants}"

    def test_it_reverses(self, migration, registry, seeded):
        codes = _all_codes()
        migration.backwards(registry, None)
        left = sorted(
            Statute.all_objects.filter(code__in=codes).values_list("code", flat=True)
        )
        assert left == [], f"backwards left Inferno articles behind: {left}"
        # The terrace corpus is untouched: the reverse removes what 0015 added.
        assert Statute.all_objects.filter(code="EU-DS-T1").exists()

    def test_it_round_trips(self, migration, registry, seeded):
        migration.backwards(registry, None)
        migration.forwards(registry, None)
        assert Statute.all_objects.filter(code__in=_all_codes()).count() == (
            ARTICLE_COUNT
        )

    def test_running_it_twice_creates_nothing(self, migration, registry, seeded):
        before = Statute.all_objects.count()
        migration.forwards(registry, None)
        assert Statute.all_objects.count() == before

    def test_it_writes_nothing_to_an_empty_database(self, migration, registry, db):
        """The guard. A migration that half-seeds ahead of `seed_mythology`
        hands it untenanted rows it did not create, and makes `--dry-run`
        against a fresh database report a plan that is not the one a real run
        would take. realms/0012 learned this the hard way."""
        assert Statute.all_objects.count() == 0
        migration.forwards(registry, None)
        assert Statute.all_objects.count() == 0

    def test_the_reverse_keeps_an_article_a_judgment_cited(
        self, migration, registry, seeded
    ):
        """A citation is the recorded basis of a decided case.

        `JudgmentCitation.statute` is PROTECT, so a hard delete would either be
        refused by the database or turn a recorded basis into a dangling id.
        The reverse skips those rows and says which.
        """
        from apps.judgment.models import Judgment, JudgmentCitation
        from apps.souls.models import Soul
        from apps.tenants.models import Tenant

        tenant = Tenant.objects.get(code="EU_HEAVEN_HELL")
        cited = Statute.all_objects.get(code="EU-INF-C8-B02")
        soul = Soul.objects.create(name="cited by Malebolge", tenant=tenant)
        case = Judgment.objects.create(
            soul=soul, civilization="EUROPEAN", tenant=tenant
        )
        JudgmentCitation.objects.create(judgment=case, statute=cited, tenant=tenant)

        migration.backwards(registry, None)

        left = sorted(
            Statute.all_objects.filter(code__in=_all_codes()).values_list(
                "code", flat=True
            )
        )
        assert left == ["EU-INF-C8-B02"], (
            f"the reverse should have kept exactly the cited article; kept: {left}"
        )


def test_judgment_0015_round_trip(migration_round_trip):
    """forward -> reverse -> forward, compared as rows, through real `migrate`.

    The class above calls the migration's functions against the current
    registry, which is fast and says nothing about whether `manage.py migrate
    judgment 0014` actually works. This runs the graph. See
    tests/migration_roundtrip.py for why "the reverse ran" is not the assertion
    that matters.
    """
    from tests.migration_roundtrip import snapshot_rows

    def seed(state):
        tenant = state.get_model("tenants", "Tenant")
        statute = state.get_model("judgment", "Statute")
        owner = tenant._base_manager.create(
            code="EU_HEAVEN_HELL", display_name="European Afterlife"
        )
        other = tenant._base_manager.create(code="CN_DIYU", display_name="Chinese")
        # One European article, so the migration has a sibling to take a tenant
        # from, and one Chinese one, so a migration reading the wrong
        # civilization would file 26 European rows under CN_DIYU.
        statute._base_manager.create(
            code="EU-DS-T1", corpus="DEADLY_SIN", civilization="EUROPEAN",
            ordinal=1, polarity="OFFENCE", title_en="Pride", tenant=owner,
        )
        statute._base_manager.create(
            code="CN-GGG-F-JJ-01", corpus="GONGGUOGE", civilization="CHINESE",
            ordinal=1, polarity="MERIT", title_zh="救濟門·一", tenant=other,
        )

    def snapshot(state):
        statute = state.get_model("judgment", "Statute")
        return snapshot_rows(
            statute._base_manager.select_related("tenant"),
            key="code",
            fields={
                "corpus": "corpus",
                "civilization": "civilization",
                "ordinal": "ordinal",
                "payload": "payload_json",
                "tenant": lambda s: s.tenant.code if s.tenant_id else None,
            },
            prefix="statute:",
        )

    def check_forward(state):
        rows = snapshot(state)
        for code in _all_codes():
            row = rows.get(f"statute:{code}")
            assert row is not None, f"{code} was not created"
            assert row["corpus"] == "INFERNO", row
            assert row["tenant"] == "EU_HEAVEN_HELL", (
                f"{code} did not inherit a European tenant: {row}"
            )
        # The wall, pinned by hand on both sides of it: a table written
        # backwards would reverse just as wrongly and survive the round trip.
        assert rows["statute:EU-INF-C5"]["payload"]["within_dis"] is False
        assert rows["statute:EU-INF-C6"]["payload"]["within_dis"] is True
        assert rows["statute:EU-INF-C8-B02"]["payload"]["parent_code"] == "EU-INF-C8"
        # Neither pre-existing article is touched.
        assert rows["statute:EU-DS-T1"]["corpus"] == "DEADLY_SIN"
        assert rows["statute:CN-GGG-F-JJ-01"]["tenant"] == "CN_DIYU"

    def check_reverse(state):
        rows = snapshot(state)
        left = sorted(code for code in _all_codes() if f"statute:{code}" in rows)
        assert left == [], f"the reverse left Inferno articles behind: {left}"
        assert "statute:EU-DS-T1" in rows, (
            "the reverse deleted a terrace article — it removes what 0015 added"
        )

    migration_round_trip(
        before=("judgment", "0014_alter_judgment_civilization_and_more"),
        after=("judgment", "0015_inferno_corpus"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )
