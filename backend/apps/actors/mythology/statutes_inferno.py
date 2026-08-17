"""EUROPEAN — INFERNO. TRANSCRIBED here, from Dante's Inferno IV-XXXIV.

The SECOND European corpus, and the third transcribed one. The 26 places
themselves are in ``statutes_inferno_entries.py``; this module holds the
provenance, the notes every row carries, the wall of Dis, and the builder that
expands the entries into seed rows — the same division of labour as
``statutes_chinese.py`` / ``gongguoge_entries.py``.

WHY A SECOND EUROPEAN CORPUS AND NOT MORE ARTICLES IN THE FIRST ONE. DEADLY_SIN
is the seven capital sins on the seven terraces of Purgatorio X-XXVII. This is
the nine circles of the Inferno and their subdivisions. They are two structures
in two canticles ordered by two different things, and the whole finding of
``docs/lore-verification/verify-christian-structure.md`` is that joining them
produces a chart that exists nowhere in Dante: three of the seven sins get no
circle at all, and the four that appear to line up do so because "incontinence"
and those four are adjacent vocabularies. A corpus per structure is what keeps
that separation in the data rather than in a comment. Nothing here cites a
terrace and nothing there cites a circle, and
``tests/test_inferno_circles.py`` asserts both directions.

`dante_circle` IS NOT BACK. That key was a circle number hung on a CAPITAL SIN —
a coordinate for pride, envy and sloth that the poem does not give them. Here
the circle is not an attribute of anything: the circle IS the article. An
article for the third circle carries ``payload["circle"] == 3`` the way the
third terrace article carries ``purgatorio_terrace == 3``, and
``tests/test_purgatorio_terraces.py::test_no_seeded_article_carries_a_dante_circle``
still passes because no row here or anywhere else carries that key.

WHAT THIS DOES NOT DO. It does not route anything. Nothing in this system can
say which circle a soul belongs in — that needs a kind of sin, and the only
deed taxonomy here is `RecordCategory`, which is a 功過格 one. Baptismal state
(circle 1), doctrinal position (circle 6) and the identity of the trust
betrayed (circle 9) have no field anywhere. The contradiction tests in
``backend/tests/test_european_hell_basis.py`` assert that this is still true
after this corpus lands, and they stay green. A citable article is a thing a
judge can point at by hand; it is not an input to `_route_european`.
"""
from apps.actors.mythology.statutes_inferno_entries import INFERNO_ENTRIES

# --------------------------------------------------------------------------
# EUROPEAN — Dante, Inferno (corpus INFERNO)
#
# THE ONE FACT THIS CORPUS IS BUILT AROUND. Dante does not layer hell by how
# much wrong was done. Virgil says the basis outright at Inf. XI.79-84, citing
# the Ethics: 「Incontinence, and Malice, and insane Bestiality」 (Longfellow
# 1867, Project Gutenberg #1001 — public domain). Incontinenza is circles 2-5,
# outside the walls; malizia (violence, then fraud) and matta bestialitade are
# 6-9, inside them. `_route_european` sorts by a demerit total, which is a
# magnitude ladder and cannot express a division by kind whatever number is fed
# into it. That contradiction is pinned in tests/test_european_hell_basis.py and
# THIS CORPUS DOES NOT RESOLVE IT.
#
# 26 ARTICLES, AND WHY THAT IS NOT THE 24 THE REPORT COUNTS. The report's §6
# counts the poem's distinct places at 24: the Antinferno (1) + circles 1-6 (6)
# + the seventh circle's three gironi + the eighth's ten bolge + the ninth's
# four zones. This corpus counts articles, not places: the nine circles each get
# an article of their own — a citation of "the eighth circle" has to have
# something to point at — and the seventeen subdivisions get one each, which is
# 26. The Antinferno is NOT transcribed: it is not one of the nine circles, and
# leaving it out is recorded on EU-INF-C1 as a transcription_gap rather than
# being made up for by re-labelling something else. The two totals count
# different things and neither is quietly restated as the other.
#
# THE SEVEN CAPITAL SINS ARE NOT IN THIS FILE AND MAY NOT BE PUT IN IT.
# docs/lore-verification/README.md §1 is about exactly this material: "Do not
# complete these lists." Pride, envy and sloth have no circle; supplying one is
# the repair that is certainly wrong, and 8308204 is what happened the last time
# it was tried.
# --------------------------------------------------------------------------

INFERNO_SOURCE = (
    "Dante, Inferno IV-XXXIV — the nine circles, the three gironi of the "
    "seventh, the ten bolge of Malebolge and the four zones of Cocytus. The "
    "layering is Aristotle's tripartition as Virgil states it at Inf. "
    "XI.79-84 (incontinenza / malizia / matta bestialitade), NOT the seven "
    "capital sins, which order the terraces of Purgatorio and are corpus "
    "DEADLY_SIN. Primary text quoted from the Longfellow 1867 translation, "
    "Project Gutenberg #1001, public domain. "
    "docs/lore-verification/verify-christian-structure.md §2, §2.1, §3.1, §6."
)

#: Carried by every one of the 26. The mistake it guards against is the one
#: that produced EU-DS-01..07 and it was made for all seven at once.
NOT_A_TERRACE_NOTE = (
    "This is a circle of hell, not a terrace of Purgatory. The seven capital "
    "sins do not stratify the Inferno: pride, envy and sloth get no circle at "
    "all, and the four that seem to line up with circles 2-5 do so because "
    "'incontinence' and those four are adjacent vocabularies, not because "
    "Dante mapped them. The seven belong to corpus DEADLY_SIN, EU-DS-T1..T7, "
    "and no article in either corpus cites the other's coordinate."
)

#: Also carried by all 26: how well any of this is attested, stated once so
#: that no reader has to infer it from the confidence of the prose.
ATTESTATION_NOTE = (
    "ATTESTATION IS MIXED AND IS RECORDED PER ARTICLE IN "
    "payload['attestation']. The structure — the three headings and the "
    "division at the wall of Dis — is PRIMARY: Inf. XI.79-84 in a public-"
    "domain translation, quoted in verify-christian-structure.md §2. The "
    "detail on each place — canto range, sinners, contrapasso, guardian — is "
    "SECONDARY: Wikipedia's Inferno article cross-checked against UT Austin's "
    "Danteworlds (Guy P. Raffa), agreeing with each other and with the nine "
    "realm descriptions this deployment already had (§2.2 checks all nine and "
    "finds none of them false). The report could not reach Digital Dante "
    "(Barolini) or the Dartmouth Dante Project (§7) and therefore asserts "
    "nothing about what any commentator says; neither does any article here."
)

#: Carried by the seventeen subdivisions only. It is the reason this corpus
#: exists, so it is attached to the rows it is about.
NO_REALM_ROW_NOTE = (
    "THIS PLACE HAS NO REALM ROW. The nine circles are realms "
    "(EU_HELL_1ST..EU_HELL_9TH); the three gironi, the ten bolge and the four "
    "zones of Cocytus are not modelled anywhere in this system — "
    "verify-christian-structure.md §6.2-§6.4. This article is the only place "
    "in the database where this part of the poem exists. It is deliberately "
    "NOT a request to create seventeen realms: a realm is a destination souls "
    "are routed to, and nothing here can decide which subdivision a soul "
    "belongs in."
)

#: Carried by the four zones of Cocytus. Their order is the order of descent;
#: it is not a numbering the poem publishes.
ZONE_NUMBERING_CONJECTURE = (
    "CONJECTURE — the ordinal, not the place. Dante names all four zones "
    "(Caina, Antenora, Tolomea, Giudecca) and the travellers cross them in "
    "that order in Inf. XXXII-XXXIV, but he does not number them the way he "
    "numbers the seventh circle's three gironi (Inf. XI.28-33) or the eighth's "
    "bolge. The index 1-4 carried here is the order of descent and is this "
    "corpus's arrangement; the names and the betrayed bonds are the poem's."
)

# --------------------------------------------------------------------------
# The wall of Dis
# --------------------------------------------------------------------------
#: THE POEM'S ONLY REAL DIVIDER, and the reason this corpus is a structure
#: rather than a list of 26 rows numbered 1 to 26.
#:
#: Circles 1-5 are outside the walls; 6-9 are inside them, and the gate is
#: forced open by a messenger from heaven at Inf. VIII.67-IX.105. That line is
#: also the line between incontinenza and malizia — Virgil's own division —
#: which is why flattening the nine circles into one ascending ladder erased it
#: and made "seven sins over nine circles" look like a reasonable reading
#: (verify-christian-structure.md §6.5).
#:
#: Written once here and read by the builder rather than repeated on 26 rows:
#: 26 copies of one fact are 26 chances for one of them to disagree. The
#: second, independent copy is hand-written in tests/test_inferno_circles.py,
#: which is where a second copy belongs.
DIS_WALL = {
    "gate_cantos": "Inf. VIII.67-IX.105",
    "outside": (1, 2, 3, 4, 5),
    "inside": (6, 7, 8, 9),
    "what_it_divides": (
        "incontinenza outside; malizia and matta bestialitade inside "
        "(Inf. XI.79-84)"
    ),
}

#: region label -> the reading that goes with it. Two values, because the wall
#: has two sides; a third would be somebody inventing a middle.
_REGION = {
    False: "UPPER_HELL_OUTSIDE_DIS",
    True: "LOWER_HELL_WITHIN_DIS",
}

_ORDINAL_WORD = {
    1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth",
    6: "sixth", 7: "seventh", 8: "eighth", 9: "ninth", 10: "tenth",
}

_KIND_EN = {
    "girone": "ring (girone)",
    "bolgia": "pouch (bolgia) of Malebolge",
    "zona": "zone of Cocytus",
}


def _place_en(entry):
    """The place, in words, from the entry's own coordinates."""
    circle = _ORDINAL_WORD[entry["circle"]]
    if entry["kind"] is None:
        return f"The {circle} circle of Dante's Hell"
    index = _ORDINAL_WORD[entry["index"]]
    place = f"the {index} {_KIND_EN[entry['kind']]} of the {circle} circle"
    # Only Cocytus's four are named in the poem; the name leads when there is
    # one, so the article reads as the place rather than as a coordinate.
    if entry["name"]:
        return f"{entry['name']}, {place}"
    return place[0].upper() + place[1:]


def _place_zh(entry):
    if entry["kind"] is None:
        return f"《地狱篇》第{entry['circle']}圈"
    unit = {"girone": "环", "bolgia": "囊", "zona": "带"}[entry["kind"]]
    named = f"（{entry['name']}）" if entry["name"] else ""
    return f"《地狱篇》第{entry['circle']}圈第{entry['index']}{unit}{named}"


def _inferno_rows():
    """Expand INFERNO_ENTRIES into the row shape `_seed_statutes` consumes.

    Built rather than written out for the reason `_gongguoge_rows` is: the
    parts that repeat 26 times — the corpus-wide notes, the attestation, the
    side of the wall — are exactly the parts that must not be allowed to differ
    between rows. Every per-article part (the canto range, the sinners, the
    contrapasso, the guardian, every caveat) is a literal in
    `statutes_inferno_entries.py` and is never derived from anything.

    `text_zh` and `text_en` are ASSEMBLED from literal clauses rather than
    written a second time. That is a deliberate difference from the terrace
    corpus, where seven articles could each carry a hand-written paragraph:
    with 26 places, a prose paragraph and a structured payload saying the same
    thing in two hands is a drift waiting to happen — and drift between an
    article's text and its coordinates is precisely what put five of the seven
    capital sins on the wrong terrace.

    `ordinal` is continuous 1..26 in the poem's order of descent, NOT the
    number within the circle. `Statute.Meta.ordering` sorts on `ordinal`, so a
    per-circle numbering would interleave the first bolgia with the first
    girone and read the corpus out of the order the poem has.
    """
    rows = []
    for ordinal, entry in enumerate(INFERNO_ENTRIES, start=1):
        within_dis = entry["circle"] in DIS_WALL["inside"]
        if within_dis == (entry["circle"] in DIS_WALL["outside"]):
            # Not reachable from a well-formed DIS_WALL, and it says so out
            # loud rather than silently labelling a circle as both or neither.
            raise ValueError(
                f"{entry['suffix']}: circle {entry['circle']} is on both sides "
                f"of the wall of Dis, or on neither. DIS_WALL is malformed."
            )
        payload = {
            "circle": entry["circle"],
            "subdivision_kind": entry["kind"],
            "subdivision_index": entry["index"],
            "subdivision_name": entry["name"],
            # A subdivision says which circle's article it sits under. This is
            # what makes the corpus a structure rather than 26 flat rows, and
            # it is what a citation of "the second bolgia" has to resolve
            # through to answer "which side of the wall".
            "parent_code": (
                None if entry["kind"] is None else f"EU-INF-C{entry['circle']}"
            ),
            "within_dis": within_dis,
            "hell_region": _REGION[within_dis],
            "dis_gate_cantos": DIS_WALL["gate_cantos"],
            "aristotelian_class": entry["aristotle"],
            "cantos": entry["cantos"],
            "guardian": entry["guardian"],
            "sinners_zh": entry["sinners_zh"],
            "sinners_en": entry["sinners_en"],
            "contrapasso_zh": entry["contrapasso_zh"],
            "contrapasso_en": entry["contrapasso_en"],
            # The realm row this place already has, or None. See
            # NO_REALM_ROW_NOTE — seventeen of the twenty-six have none, and
            # that absence is the finding rather than a TODO.
            "circle_realm_code": entry["realm_code"],
            "attestation": {"structure": "PRIMARY", "detail": "SECONDARY"},
            # Queryable, so a report can ask "what in this corpus is not
            # settled" without parsing prose — the same reason GONGGUOGE
            # carries `appropriated_as_judgment_basis` as a flag.
            "names_a_capital_sin": False,
        }
        conjecture = entry.get("conjecture")
        if conjecture is None and entry["kind"] == "zona":
            conjecture = ZONE_NUMBERING_CONJECTURE
        if conjecture is not None:
            payload["conjecture"] = conjecture
        if "transcription_gap" in entry:
            payload["transcription_gap"] = entry["transcription_gap"]

        notes = [NOT_A_TERRACE_NOTE, ATTESTATION_NOTE]
        if entry["kind"] is not None:
            notes.append(NO_REALM_ROW_NOTE)
        notes.extend(entry["notes"])

        rows.append({
            "code": f"EU-INF-{entry['suffix']}",
            "ordinal": ordinal,
            # Every article is an OFFENCE except the first: Limbo charges no
            # act. There is no polarity for "no sin was committed", so the
            # article carries OFFENCE and says in its own text and notes that
            # the fault is the absence of baptism. Inventing a fourth polarity
            # for one row would state a claim about the model, not about Dante.
            "polarity": "OFFENCE",
            "title_zh": entry["title_zh"],
            "title_en": entry["title_en"],
            "text_zh": (
                f"{_place_zh(entry)}，{entry['cantos']}。"
                f"罪：{entry['sinners_zh']}。"
                f"刑（contrapasso）：{entry['contrapasso_zh']}"
                + (f"守卫：{entry['guardian']}。" if entry["guardian"] else "")
            ),
            "text_en": (
                f"{_place_en(entry)}, {entry['cantos']}. "
                f"{entry['sinners_en']} {entry['contrapasso_en']}"
                + (f" Guarded by {entry['guardian']}." if entry["guardian"] else "")
            ),
            "notes": notes,
            "payload": payload,
        })
    return rows


INFERNO_STATUTES = _inferno_rows()
