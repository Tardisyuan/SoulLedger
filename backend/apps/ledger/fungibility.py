"""Which merits may pay off which faults — 「功過有不可折者」.

The rule
--------
《文昌帝君功過格·凡例》 (雍正二年, 1724) states two limits on 功過相抵 in one
sentence, and they are the only quantitative limits any surveyed 功過格 states:

    功過有不可折者。如用財之百功，不可折致死人之百過。
    零積之十功不能折一次之十過也。

The first is a class rule: a hundred merits accumulated by SPENDING MONEY do
not discharge the hundred faults of killing a man. The second is a granularity
rule: ten merits earned a fraction at a time do not discharge one fault worth
ten at a stroke.

This module implements the first. The second is NOT implemented and is not
approximated — see "What this does not do" below.

Why it is here and not in the statutes
--------------------------------------
`payload_json["fungibility_class"]` on a GONGGUOGE article says which pool that
ARTICLE belongs to. But a soul's ledger is made of `SoulRecord` rows, and a
record is not required to cite an article — most of the seeded souls' deeds do
not. So the pool a *record* falls in is derived from the one classification it
always has, `RecordCategory`, by the table below. The two vocabularies meet at
the class name, and `tests/test_ledger_fungibility.py` asserts that every
category and every seeded article names a class this module knows.

Derived rather than stored, deliberately. A stored column would need a backfill
for every existing record and would then be free to disagree with the category
printed next to it; there is no case yet where an operator needs to override the
mapping, and inventing a column against that future is how a second, quietly
divergent classification gets built.

Honesty about the taxonomy
--------------------------
ONE distinction is attested: 財 against 性命. MONEY and LIFE are the two classes
凡例 actually names. Everything below that line — RITUAL, SPEECH, CONDUCT — is
this system's own partition, made so that the residue is not one undifferentiated
bucket in which the rule silently stops applying. They are labelled as such on
every article that carries them, and widening or merging them is a product
decision, not a textual correction.

What this does not do
---------------------
* It does NOT re-score anything. `merit_score` and `demerit_score` still mean
  exactly what they meant — the decayed sums of a soul's MERIT and DEMERIT
  records — and no stored number changes because this module exists. It
  partitions numbers it is handed; it does not restate them.

  This module's first version also left the routing layer alone, so a verdict
  was still handed down on a single netted balance and buying off a killing
  still worked where it cost a soul something. That half has since landed:
  `LedgerService.get_unoffset_demerit` exposes the figure below and
  `DispositionService._route_chinese` sentences on it. Which of the disposition
  call sites take it and which deliberately do not is argued there, per site —
  the short version is that only the Chinese one does, because 「不可折」 is a
  limit on 功過相抵 and neither of the other two cosmologies has that step.

* It does NOT redefine `Soul.karmic_balance`, and that is a decision rather than
  an omission. It is a column expression before it is a property: querysets
  annotate `merit_score - demerit_score` to sort and range-filter souls in SQL
  (apps/souls/querysets.py, apps/souls/filters.py, apps/ledger/views.py). A pool
  is derived in Python from a record's category and is deliberately not a stored
  column (see above), so there is no SQL for a pool-aware balance — a redefined
  property would disagree with every queryset computing the same name in the
  database. The raw net stays the raw net, and what changed is which number
  routing reads.
* It does NOT implement 零積不抵整發, the second half of the same 凡例 sentence:
  「零積之十功不能折一次之十過也。」 Ten merits earned a fraction at a time do not
  discharge one fault worth ten at a stroke. The two rules are cumulative rather
  than alternatives — a discharge must clear both — so applying this one would
  only ever narrow what `offset_within_classes` permits, never widen it. The
  investigation behind the decision not to apply it, and its evidence:

  THE TEXT DOES GIVE A CRITERION, AND IT IS PER-CLAUSE. 一次 means "on one
  occasion", and every scoring clause in 太微 states its own per-occasion value —
  that is what the `clauses` list on each seeded article is. 救濟門#7 carries
  both readings of one act in a single sentence: 「賑濟鰥寡孤獨窮民百錢為一功，
  貫錢為十功，如一錢散施，積至百錢為一功」. A string of cash handed over at once
  is 一次之十功; the same ten merits reached a coin at a time are 零積. Same
  article, same MONEY pool, opposite granularity. So granularity is a property of
  (clause, number of occasions) and not of an article, and no tag attached to an
  article could carry it.

  WHAT IS MISSING IS ON THIS SIDE OF THE JOIN. A `SoulRecord` cites no clause and
  counts no occasions. `weight` is an operator-supplied integer whose own help
  text calls it a "significance weight (1-100)"; nothing binds it to a clause's
  value and nothing says one row is one occasion. Those two absent inputs are
  named in GRANULARITY_MISSING_INPUTS so that the next attempt adds data rather
  than inventing a marker.

  WHY NOT THE PROXIES THAT SUGGEST THEMSELVES:

  - Record counts. "One row is one occasion, so a hundred rows of weight 1 is
    零積" reads convincingly against a test fixture and fails against data:
    nothing stops a clerk entering a year of alms as one row, or documenting one
    killing across three, and a bulk import obeys no such convention at all. It
    would make which of the ten courts a soul is sent to a function of how many
    rows somebody typed. The first version of this note called that an invented
    rule wearing a citation; that judgement stands, and this is the evidence for
    it.
  - `is_milestone`. Display-only by explicit decision, and SoulRecord states the
    reason in as many words — ticking a display checkbox is a surprising way to
    move an audited balance.
  - A granularity tag backfilled onto the 73 transcribed segments. 「一次」 does
    not occur anywhere in the corpus, and the one place 太微 discusses
    accumulation at all is 救濟門#7 above, where it grants the accumulated merit
    its full value rather than marking it down. Completing that corpus against a
    distinction it does not draw is the repair docs/lore-verification/README.md
    §1 forbids by name, and `8308204` is what it looks like when it is tried.

  So the reading states the rule and states that it is not applied, the way
  `_european_reading` reports `poena: None` with a reason instead of a proxy.
  `tests/test_ledger_granularity.py` pins the gap open: it builds the soul the
  rule is about and asserts this system still treats 零積 and 一次 alike, so
  closing the gap has to be done deliberately.
* It does NOT decay, cap, or otherwise re-score anything. Decay is applied
  upstream by LedgerService and 功過格 has none of it (see the note on
  CIVILIZATION_DECAY_RATE in services.py); this module partitions numbers it is
  handed.
"""

# --------------------------------------------------------------------------
# The pools
# --------------------------------------------------------------------------

#: 性命 — a life, human or animal: taken, saved, spared, tended. The half of
#: the attested pair that money may not buy into.
LIFE = "LIFE"
#: 財 — merit and fault denominated in cash or goods. 太微's rate is
#: 百錢為一功 (救濟門#7); 《十戒功過格》 uses 三十文為一功, which is why the rate
#: is carried per-article rather than as a constant here.
MONEY = "MONEY"
#: 教典/焚修/齋戒 — the Daoist observances that make up half of 太微. NOT
#: attested as a separate pool; see the module docstring.
RITUAL = "RITUAL"
#: Speech and its consequences — 惡語, 揚人惡事, 教唆鬪訟, 勸諫. NOT attested.
SPEECH = "SPEECH"
#: Everything the four above do not name. NOT attested.
CONDUCT = "CONDUCT"

FUNGIBILITY_CLASSES = (LIFE, MONEY, RITUAL, SPEECH, CONDUCT)

#: The two classes 凡例 names outright. Kept separately from the tuple above so
#: that a test — and a reader — can tell the sourced part from the invented one.
ATTESTED_CLASSES = (MONEY, LIFE)

#: The first 凡例 rule — the class limit, which this module applies.
CLASS_RULE_ZH = "功過有不可折者。如用財之百功，不可折致死人之百過。"

#: The second — the granularity limit, quoted on its own because it is the one
#: this module does NOT apply. See "What this does not do" in the docstring.
GRANULARITY_RULE_ZH = "零積之十功不能折一次之十過也。"

#: What a `SoulRecord` would have to carry before 零積不抵整發 could be applied
#: to it. Named as data rather than described as prose so that the next attempt
#: adds the join the corpus already has one side of, instead of inventing a
#: granularity marker on the deed. See the module docstring.
GRANULARITY_MISSING_INPUTS = (
    # Which scoring clause the deed was scored under. Every clause states its
    # own per-occasion value; that value is what 一次 means.
    "statute_clause",
    # How many separate occasions this one row's weight covers. One row is not
    # one occasion and nothing in this system says it is.
    "occurrence_count",
)

#: Why every offset below is granularity-blind: report the absence with its
#: reason rather than substitute a number for it.
#:
#: This is prose and stays prose, unlike the two English sentences that came
#: out of readings.py. The difference is who reads it. Those two were fields
#: of a 200 body that SoulReadingPanel.tsx renders, and the panel already had
#: its own catalogue copy for the same content. This one has no reader at all
#: on the frontend — `non_fungible` is not surfaced by any component, no
#: bundle carries a granularity string, and the only thing that reads it is
#: tests/test_ledger_granularity.py. Moving it to a catalogue would delete an
#: explanation and put nothing in its place, which is the reason
#: TERMINAL_COSMOLOGY_REASON stayed too. The machine-readable half of the
#: same question is already answered beside it, by `granularity_applied` and
#: GRANULARITY_MISSING_INPUTS.
GRANULARITY_UNAVAILABLE = (
    "零積不抵整發 is not applied. Telling a total reached at one stroke from one "
    "reached a fraction at a time needs the clause a deed was scored under and "
    "the number of occasions its weight covers; a SoulRecord carries neither, "
    "and `weight` is an operator-supplied significance figure that may bundle "
    "any number of occasions of any clause. Every offset reported here is "
    "therefore granularity-blind and may discharge a lump fault with scattered "
    "merit."
)

#: Both halves, composed rather than retyped so the pair cannot drift apart.
FUNGIBILITY_RULE_ZH = CLASS_RULE_ZH + GRANULARITY_RULE_ZH
FUNGIBILITY_RULE_SOURCE = (
    "《文昌帝君功過格·凡例》，雍正二年（1724）。維基文庫轉錄。"
    "docs/lore-verification/gongguoge.md §7.3。"
    "太微本身不載此條——它是後世功過格對「功過相抵」加的限制，"
    "本系統採之，因為 1171 年的太微沒有給出任何抵扣上限。"
)

# --------------------------------------------------------------------------
# RecordCategory -> pool
# --------------------------------------------------------------------------
#
# Keyed on the string value rather than on the enum member so this module does
# not import souls at import time. `test_ledger_fungibility.py` asserts the two
# stay in step, which is the check that matters — a category added without an
# entry here would otherwise fall to CONDUCT and be silently offsettable against
# every other unclassified thing.
CATEGORY_FUNGIBILITY = {
    # Merit categories
    "CHARITY": MONEY,      # 賑濟窮民百錢為一功 — the article 凡例 names by name
    "COMPASSION": LIFE,    # 救人/救畜; 見殺不救 is its mirror in 不仁門
    "HONESTY": SPEECH,
    "COURAGE": CONDUCT,
    "WISDOM": CONDUCT,
    "PIETY": RITUAL,       # 焚修門/教典門
    # Demerit categories
    "CRUELTY": LIFE,       # 不仁門: 役使人畜至於疲乏, 鞭笞
    "DECEPTION": SPEECH,   # 言約失信, 隱真出偽
    "COWARDICE": CONDUCT,
    "GREED": MONEY,        # 不義門: 偷盜人財物, 不義而取人財物
    "BLASPHEMY": RITUAL,   # 不善門: 以言指斥毀天尊聖像
    "MURDER": LIFE,        # 故傷殺人性命為百過 — the other half of the pair
    "OTHER": CONDUCT,
}

#: What an unmapped category falls to. CONDUCT and not MONEY or LIFE: an
#: unclassified deed must never land in one of the two pools the rule is
#: actually about, because that is the one placement that could either forgive a
#: killing or wrongly refuse a real offset.
DEFAULT_CLASS = CONDUCT


def class_for_category(category: str) -> str:
    """The pool a ledger record falls in, from its `RecordCategory`."""
    return CATEGORY_FUNGIBILITY.get(category, DEFAULT_CLASS)


def granularity_of(record) -> str:
    """Which of `lump` / `scattered` / `unknown` a SoulRecord is.

    一次 is "on one occasion", so `occurrence_count == 1` is lump and anything
    greater is scattered. Both inputs are required for either answer, and the
    reason is the one this module spent its investigation on: `occurrence_count`
    alone is a number somebody typed, and `statute_clause` is what says the
    number is a count of the *clause's* occasions rather than of anything else.
    A row with a count and no clause is asserting a granularity against no
    stated per-occasion value, which is the invented marker the four refused
    proxies would each have been.

    UNKNOWN IS A THIRD ANSWER AND NOT A DEFAULT. Every row written before
    souls/0028 has neither field, and treating those as lump would apply the
    rule to a whole database on no evidence, while treating them as scattered
    would refuse offsets nobody has grounds to refuse. They are reported as
    unknown and net exactly as they did before, which the reading states.
    """
    clause = (getattr(record, "statute_clause", "") or "").strip()
    count = getattr(record, "occurrence_count", None)
    if not clause or count is None:
        return "unknown"
    return "lump" if count <= 1 else "scattered"


def _offset_with_grain(merit_by_grain: dict, demerit_by_grain: dict) -> tuple:
    """Net merit against fault inside one pool, applying 零積不抵整發.

    Returns ``(offset, merit_left, demerit_left, applied)`` where `applied` says
    whether the rule actually constrained anything — a pool with nothing on
    both sides to constrain reports False, so "the rule ran" and "the rule bit"
    are different statements in the reading.

    THE RULE, AND ONLY THE RULE. 「零積之十功不能折一次之十過也」 forbids one
    pairing: scattered merit against a lump fault. It says nothing about lump
    merit against a scattered fault, and inventing that symmetry would refuse
    offsets the text permits. So of the four merit×fault pairings, three are
    allowed and one is not.

    ORDER MATTERS, AND TWO SEPARATE THINGS PROTECT IT. The waste to avoid is a
    lump merit consuming a scattered fault, leaving the scattered merit facing a
    lump fault it may not discharge — a soul worse off for the order of a loop
    rather than for anything it did. Two mechanisms each prevent it, and either
    alone is sufficient:

      1. Scattered merit is spent first, so the scattered faults it is allowed
         to meet are gone before an unconstrained merit reaches them.
      2. Lump and unknown merit try `lump` faults before `scattered` ones — they
         prefer the target the constrained merit cannot serve.

    Both are here deliberately and neither is redundant belt-and-braces: this
    was verified by mutation, and removing *either* one alone leaves the result
    unchanged. Only removing both loses an offset. That is worth stating,
    because a reader who deletes one as duplication will find every test still
    green and will have left the other carrying a property alone.

    UNKNOWN NETS BOTH WAYS, WHICH IS THE LEAK AND IT IS DELIBERATE. A record
    missing either input is not evidence of anything, so it is not used as
    evidence — against it the rule does not apply, in either direction. That
    means a database with no granularity recorded behaves exactly as it did
    before souls/0028, which is the property that let this ship without a
    backfill nobody could justify.
    """
    m = dict(merit_by_grain)
    d = dict(demerit_by_grain)
    offset = 0.0
    applied = False

    def spend(mk: str, dk: str) -> None:
        nonlocal offset
        take = min(m[mk], d[dk])
        if take > 0:
            m[mk] -= take
            d[dk] -= take
            offset += take

    # Scattered merit first, and only against what it may meet.
    for dk in ("scattered", "unknown"):
        spend("scattered", dk)
    # Then the two kinds that may meet anything.
    for mk in ("lump", "unknown"):
        for dk in ("lump", "scattered", "unknown"):
            spend(mk, dk)

    # The rule bit if scattered merit is left over while a lump fault still
    # stands — that pair, and only that pair, is what it forbids.
    if m["scattered"] > 0 and d["lump"] > 0:
        applied = True

    return offset, sum(m.values()), sum(d.values()), applied


def offset_within_classes(class_totals: dict) -> dict:
    """Net merit against fault WITHIN each pool, never across.

    `class_totals` is ``{class_name: {"merit": float, "demerit": float}}``.

    Returns the per-class breakdown plus the two totals the rule exists to
    produce:

      * ``unoffset_demerit`` — fault that no merit of its own kind could
        discharge. This is the number the defect hid: with one scalar pool it is
        always ``max(0, demerit - merit)`` and a hundred coins make it zero.
      * ``unusable_merit`` — merit with no fault of its own kind left to
        discharge. It is NOT a credit against anything else, and it is reported
        separately rather than added back into a balance for exactly that
        reason.

    The two are deliberately not subtracted from one another. A soul with 100
    unusable alms and 100 unoffset killings is not at zero; it is a soul that
    gave generously and killed somebody, and one number cannot say that.

    WITHIN a class the netting is still granularity-blind: `min(merit, demerit)`
    cannot tell ten merits scraped together from one worth ten, so scattered
    merit discharges a lump fault of its own kind in full. That is the half of
    the 凡例 sentence this module does not apply, and the returned reading says
    so — `granularity_applied` is False and `granularity_unavailable` gives the
    reason. See the module docstring for why the available proxies were refused.
    """
    by_class = {}
    unoffset_demerit = 0.0
    unusable_merit = 0.0

    granularity_applied = False

    for name in sorted(class_totals):
        totals = class_totals[name]
        merit = float(totals.get("merit", 0) or 0)
        demerit = float(totals.get("demerit", 0) or 0)

        # The buckets are optional on the way in, and that is what keeps every
        # existing caller working: a `class_totals` built before souls/0028 —
        # or by a test that only cares about pools — has two sums and no
        # grain, and falls through to the granularity-blind `min`. A caller
        # that supplies buckets gets the rule. Neither path guesses.
        mg = totals.get("merit_by_grain")
        dg = totals.get("demerit_by_grain")
        if mg is not None and dg is not None:
            offset, _m_left, _d_left, applied = _offset_with_grain(mg, dg)
            granularity_applied = granularity_applied or applied
        else:
            offset = min(merit, demerit)

        by_class[name] = {
            "merit": _tidy(merit),
            "demerit": _tidy(demerit),
            "offset": _tidy(offset),
            "unoffset_demerit": _tidy(demerit - offset),
            "unusable_merit": _tidy(merit - offset),
        }
        unoffset_demerit += demerit - offset
        unusable_merit += merit - offset

    return {
        "by_class": by_class,
        "unoffset_demerit": _tidy(unoffset_demerit),
        "unusable_merit": _tidy(unusable_merit),
        "rule_zh": FUNGIBILITY_RULE_ZH,
        "rule_source": FUNGIBILITY_RULE_SOURCE,
        "attested_classes": list(ATTESTED_CLASSES),
        # The second half of `rule_zh`. It used to be reported as permanently
        # unapplied, because it was — the inputs did not exist. souls/0028 added
        # them, so `granularity_applied` is now an answer about THIS ledger
        # rather than about the system: True when scattered merit was actually
        # left facing a lump fault in some pool, and False when it was not,
        # which for a ledger with no granularity recorded is every time.
        #
        # `granularity_unavailable` stays and still says why a False can mean
        # "not recorded" rather than "recorded and did not bite". Deleting it on
        # the day the columns landed would have made those two indistinguishable
        # in exactly the databases where the distinction matters most — the ones
        # that have not started filling the columns in.
        "granularity_rule_zh": GRANULARITY_RULE_ZH,
        "granularity_applied": granularity_applied,
        "granularity_unavailable": GRANULARITY_UNAVAILABLE,
        "granularity_missing_inputs": list(GRANULARITY_MISSING_INPUTS),
    }


def _tidy(value: float):
    """Ints stay ints; 半功 stays 0.5.

    Weights are integers today (SoulRecord.weight is an IntegerField, which is
    why 半功 cannot yet be *recorded* — see the note in seed_mythology on
    焚修門#1), but decay produces floats and the arithmetic here must not
    pretend otherwise. Rounded to two places for the same reason
    get_ledger_summary rounds a displayed weight: this is a figure to read, and
    the totals it comes from were accumulated unrounded.
    """
    rounded = round(float(value), 2)
    return int(rounded) if rounded == int(rounded) else rounded
