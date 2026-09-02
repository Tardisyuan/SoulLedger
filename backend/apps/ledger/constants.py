"""账本的**常量** —— 衰减率、继承比例、哪些宇宙观可轮回,以及为什么。

从 `apps/ledger/services.py` 拆出(2026-09-01),与 `apps/workflow/templates.py`
同一条缝:那个文件 785 行,其中 220 行是常量和它们的论证,之后才是 `LedgerService`。

这些不是「魔法数字」—— 每一个下面都写着它取这个值的出处(功过格的抵扣规则、
但丁的 culpa、Republic X 的千年循环)。**论证比数字长得多**,而那正是它们该
单独成文的理由:改一个数要读它的出处,而读出处不该顺带滚过五百行服务逻辑。

`services.py` 重导出这里的每一个名字,既有 import 一处不用改。
"""
from apps.souls.models import Civilization

LEDGER_CACHE_TTL = 60 * 5  # 5 minutes
DECAY_RATE = 0.01  # per year — the rate for any cosmology not listed below.

# How fast a deed fades, per cosmology.
#
# Be clear about what this table is. Strictly, *no* tradition surveyed here
# attenuates a deed by elapsed time: 功過格 is cumulative and its entries do not
# expire, Buddhist kamma is the one concept in the survey that explicitly does
# not weaken with the years, Plato's is a sentence served rather than a stain
# that fades, and the Catholic practice of denominating indulgences in days was
# abolished in 1967 (Indulgentiarum Doctrina) precisely because the units misled
# people into reading remission as a quantity of time. Decay survives everywhere
# else in this table as a *product* choice — intra-life recency, anchored to the
# soul's death, so that what a person did at 65 weighs more at judgment than
# what they did at 20 (see _get_decay_anchor). That is a defensible thing for
# this system to want. It is not a thing any of these cosmologies asserts.
#
# EUROPEAN is 0.0 not because Dante is uniquely exempt on doctrine, but because
# European is the one place we published a label that denies decay outright. The
# civilization heading now reads 审判与补赎 — judgment and satisfaction, where
# reduction comes from contrition and the act performed, never from elapsed time
# — and it shipped in the same push as a global decay rate that erodes every
# deed by elapsed time and had no civilization branch at all. A label that
# contradicts the arithmetic under it is worse than either alone, and of the two
# it is the arithmetic that was never argued for.
#
# A dict rather than `if civ == EUROPEAN`, so that a cosmology wanting its own
# answer gets an entry rather than a branch.
#
# GREEK HAS NO ENTRY, AND THAT IS THE ANSWER RATHER THAN THE ABSENCE OF ONE.
# This comment used to end by predicting that Plato's thousand-year circuit
# would want a rate of its own — "a sentence with a clock, and whatever number
# that wants, it will not be this one". It wants none. A rate here scales the
# *weight* of a deed by elapsed time, and nothing on the Greek side reads a
# weight: `_greek_reading` counts wrongs (Republic X 615a-b repays tenfold per
# wrong done, and `weight` is this house's own severity scale, not Plato's),
# and `DispositionService._route_greek` reads the verdict alone, because a fork
# has two roads and no depth to grade.
#
# THAT SENTENCE OF PLATO'S IS NOW A ROW. It is corpus REPUBLIC_ER, article
# GR-ER-03, seeded with its Stephanus reference and its multiplier — and
# GR-ER-05 is the companion that refuses 功過相抵 here, requiting good-doing
# tenfold on its own road rather than as a subtraction from the term owed on
# the other. Cited so a reader of this comment can find the text it rests on.
# NEITHER IS AN INPUT: this function reads SoulRecord rows and never queries
# Statute, and tests/test_greek_corpora.py holds that boundary behaviourally
# rather than in prose, because the identical promise in statutes_inferno.py's
# docstring did not survive `_deepest_cited_circle`. An entry would be a rate governing
# nothing, and choosing 0.0 for it would additionally assert that Greek deeds
# do not fade — a doctrine nobody here has argued for, on a mechanic no Greek
# reading consults.
#
# What the missing entry actually does is leave a Greek soul on the shared
# DECAY_RATE for its displayed merit/demerit sums, via `.get(..., DECAY_RATE)`.
# That is deliberate and is the same call `_decay_rate_for` documents for an
# unmapped tenant: decay is a house rule about recency, the sums are raw
# arithmetic true of any ledger, and applying it there attributes nothing to
# Plato. tests/test_greek_sentence_basis.py pins the absence so that filling
# the dict in for symmetry has to be a decision.
CIVILIZATION_DECAY_RATE = {
    Civilization.CHINESE: DECAY_RATE,
    # EGYPTIAN gets 0.0 for the same reason EUROPEAN does, and the argument
    # was made once and not carried across.
    #
    # `MAAT_FEATHER_WEIGHT` (readings.py) is justified in prose: "1 is the
    # smallest weight a SoulRecord can carry ... a heart with any recorded
    # wrongdoing beyond a single minimal deed is heavier than the feather.
    # That is a harsh instrument, and it is meant to be." But `heart_weight` is
    # the *decayed and rounded* demerit total, and EGYPTIAN was sharing the
    # generic rate. Measured 2026-08-29: three recorded wrongs of weight 1
    # decayed to a heart_weight of 1 and passed the weighing; so did a single
    # wrong of weight 3 committed 150 years before death.
    #
    # This file already made this exact argument for EUROPEAN -- "a label that
    # contradicts the arithmetic under it is worse than either alone" -- and
    # gave it 0.0. Nobody carried it over. The Duat does not forget with time;
    # the 42 negative confessions are not a decaying score.
    Civilization.EGYPTIAN: 0.0,
    Civilization.EUROPEAN: 0.0,
}

# Fraction of a life's ledger that follows the soul through the gate.
#
# Merit thins. That number is product-invented — no tradition surveyed puts a
# coefficient on carryover — and it is kept at 0.2 because a rebirth needs to
# feel like a fresh start to be worth playing for.
INHERITANCE_MERIT = 0.2
# Demerit does not thin. Unripened karma carries at full strength: this is not
# a game-balance number, it is the one point Buddhism is unambiguous about —
# kamma that has not yet ripened does not weaken on the way through the gate,
# and *aparāpariya-vedanīya* kamma (effective in any subsequent life) is
# explicitly stated never to lapse while saṃsāra continues.
#
# The symmetric 0.2 this replaces made reincarnation an 80% amnesty on
# everything: a mass murderer's ledger was cut by four fifths by the mere fact
# of dying, and it compounded across cycles (0.2 → 0.04 → 0.008), so three
# lives erased anything at all.
INHERITANCE_DEMERIT = 1.0

# Inheritance presupposes rebirth, and two of the four cosmologies here have
# one. Egyptian judgment ends at Aaru or Ammit; European (Dante) judgment ends
# at Heaven, Hell, or Purgatory-then-Heaven, and Purgatorio empties upward,
# never back into a new life. Held as a set rather than an `if civ == CHINESE`
# so that adding a rebirth-capable civilization is one line.
#
# GREEK IS THAT ONE LINE, AND IT IS THE NORM RATHER THAN THE WHOLE STORY.
# Republic X 615a-b sentences the unjust to a thousand-year circuit and 617d-620d
# then has them choose a new life at the Spindle of Necessity, so rebirth is
# what ordinarily happens to a Greek soul and the set says so. Gorgias 525c
# states an exception in the other direction — those whose wrongs are incurable
# (ἀνίατοι) are made everlasting examples instead — and the owner's ruling is
# that both hold. The exception is not encoded anywhere, here or in
# `DispositionService._route_greek`, because Plato's criterion is curability
# and nothing in this system records anything that bears on it; see that
# method's docstring, and tests/test_greek_sentence_basis.py, which pins the
# gap as a contradiction rather than letting a threshold be invented for it.
#
# For the same reason GREEK is deliberately absent from
# TERMINAL_COSMOLOGY_REASON below: a cosmology cannot be in both, the norm is
# rebirth, and half an entry covering only the incurable would describe a
# population this system cannot pick out.
REBIRTH_CAPABLE_CIVILIZATIONS = frozenset({Civilization.CHINESE, Civilization.GREEK})

# Cosmologies whose routing is bound by 「功過有不可折者」.
#
# 功過格 is a Chinese instrument and the 凡例 limit on 功過相抵 is a limit on a
# Chinese arithmetic. The other two cosmologies here have no offsetting step for
# it to constrain: an Egyptian heart is weighed against the feather with merit
# absent from the scale entirely, and European culpa is retired by absolution
# rather than by a good deed (see apps/ledger/readings.py). A pool split has
# nothing to say about either, so neither is in this set and neither routes any
# differently than it did.
#
# A frozenset rather than `if civ == CHINESE` for the same reason
# REBIRTH_CAPABLE_CIVILIZATIONS is one: whether Plato's thousand-year circuit
# has a non-fungibility rule was a question somebody had to answer on purpose,
# in one place, rather than by discovering which branch of an if-chain it fell
# into.
#
# ANSWERED: GREEK IS NOT IN THIS SET, and for the Egyptian reason rather than
# the European one. 「不可折」 is a limit on 功過相抵, and Republic X has no
# offsetting step for it to limit — 615b requites well-doing "in the same
# measure" on its own road, tenfold like the punishment and in parallel with
# it, so a good deed never discharges any part of the term owed on the other
# road. There is nothing to partition, and `get_unoffset_demerit` accordingly
# returns None for a Greek soul, which `DispositionService._route_greek` does
# not call in the first place.
NON_FUNGIBLE_CIVILIZATIONS = frozenset({Civilization.CHINESE})

# RESOLVED(i18n): the reasons below stay here. `inheritance_note` did not.
#
# The old TODO covered both as one defect, and they are not the same kind of
# string — which is why it was right about one of them and wrong about this one.
#
# `inheritance_note` was a *sentence the soul-detail card rendered*. It is gone
# from get_reincarnation_inheritance below, which now returns the two rates as
# numbers (`inheritance_merit_rate` / `inheritance_demerit_rate`) and leaves the
# wording to packages/core/messages/{en,zh-Hans,egy}.json under
# `ledger.carry_forward_rate`. The drift the TODO named had two ends rather than
# one: the frontend was *also* hand-copying 20 and 100 into
# SoulKarmaLedgerCard.tsx as literals, so the constants below could move and
# both the backend sentence and the frontend bars would disagree with each
# other. Both ends now read the same two numbers off the wire.
#
# The reasons below are the `detail` of an HTTP 409 body, and this product's
# frontend never renders them: app/souls/[id]/page.tsx turns the 409 into `null`
# and hides the card entirely, and handleReincarnate reads `data.error`, which
# this body does not carry. What does read `detail` is everything that is not a
# browser — curl, an integration client, DRF's own renderer, and `str(exc)` in
# the logs — none of which has a message catalogue, and this service consults no
# Accept-Language. Localising it would move English prose out of here and put
# nothing readable in its place for the only readers it has. So it stays, in
# English, on purpose.
#
# The localisable half of the same question is answered by `civilization`: it is
# the machine-readable discriminator a UI keys its own copy off, which is why
# the 409 body carries it *beside* the prose instead of only the prose. A
# frontend that ever needs to say "this cosmology has no next life" in the
# reader's language keys on that field and owns the sentence; it must not parse
# `detail`.
TERMINAL_COSMOLOGY_REASON = {
    Civilization.EGYPTIAN: (
        "Egyptian judgment is terminal: the heart is weighed once and the soul "
        "either enters Aaru or is devoured by Ammit. There is no next life to "
        "inherit into."
    ),
    Civilization.EUROPEAN: (
        "European (Dante) judgment is terminal: Heaven, Hell, or Purgatory and "
        "then Heaven. There is no next life to inherit into."
    ),
}
