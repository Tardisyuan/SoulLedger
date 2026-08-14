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
* It does NOT touch `Soul.karmic_balance`, `merit_score`, `demerit_score`, or
  `DispositionService`. Those still net raw across every class, so the routing a
  verdict receives is unchanged by this module. That is a real remaining gap and
  is stated rather than papered over: karmic_balance is a Soul property the
  souls app owns, seven disposition call sites route on it, and querysets order
  by it. Rewriting it is a separate change with its own argument to make. What
  lands here is the *reading* — the same place apps/ledger/readings.py put its
  refusal to flatten three cosmologies into one net, one level deeper: inside
  the Chinese ledger, merit and fault are not all interchangeable either.
* It does NOT implement 零積不抵整發 (the granularity rule). Doing so needs a
  notion of whether a fault was incurred "at a stroke", which no field records —
  `is_milestone` is display-only by explicit decision (see SoulRecord). A proxy
  built out of record counts would be an invented rule wearing a citation.
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

FUNGIBILITY_RULE_ZH = (
    "功過有不可折者。如用財之百功，不可折致死人之百過。"
    "零積之十功不能折一次之十過也。"
)
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
    """
    by_class = {}
    unoffset_demerit = 0.0
    unusable_merit = 0.0

    for name in sorted(class_totals):
        totals = class_totals[name]
        merit = float(totals.get("merit", 0) or 0)
        demerit = float(totals.get("demerit", 0) or 0)
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
