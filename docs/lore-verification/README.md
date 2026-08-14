# Source verification of the seeded mythology

Eight reports, produced 2026-08-14/15 by independent agents that each read the
seeded data, then went to primary sources. Every claim in them carries a URL and
a note on what kind of source it is — first-hand transcription, scholarship,
museum record, encyclopedia, or self-published — because the failures found here
all trace back to that distinction being lost.

They are kept whole rather than summarised. Re-deriving any of them means
repeating the searches, and the summaries below drop most of the citations.

## Why this exists

`docs/` was written without references. Statutes were then seeded straight out of
it, and the framework turned out not to exist. Before that, the "42 assessors of
Ma'at" in the repo were 35 names that were not assessors. Neither was caught by
review, by tests, or by the audits written specifically to check this data.

## What was found

**No second forged name list.** The Chinese ten kings, the Greek cast, the
Egyptian gods and Dante's nine circles are real and mostly correctly named. The
nine circles' English descriptions are accurate down to "ten concentric fosses of
Malebolge" — whoever wrote that knew the text.

Three things went wrong instead.

### 1. Two whole frameworks were invented

There is no codified underworld law. The 玉历宝钞 is a morality book narrated
court by court: no article numbers, no sentence lengths, no legal form. The
《太上老君律》 that `docs/11` cites does not exist in the Daoist Canon. The lists
were not short — §4.1's six entries include 饮酒, which is not one of the Buddhist
ten evils, and none of §4.2's seven match the 十善业道.

Dante divides Hell by Aristotle's tripartition, said outright by Virgil in
Inferno XI. Pride, envy and sloth have no circle at all. The seven sins belong to
Purgatorio's seven terraces, which this project does not model. The ordering was
credited to Gregory the Great, for whom pride is not one of the seven but the
root of all of them.

Both corpora were withdrawn in `8308204`. The Egyptian 42 stayed: they derive
from actor rows checked against Budge's reading of the Papyrus of Nebseni and
cross-validated 42-for-42 against UCL's Maiherperi transcription.

> **Do not complete these lists.** Filling in the "missing" four evils, three
> virtues, or three sins is the one repair that is certainly wrong. Nothing is
> missing. The lists were attached to the wrong structure, and completing them
> only yields a more convincing forgery.

### 2. Position errors are the dominant class, and the audits cannot see them

`consolidate_eu_pantheon.GRECO_ROMAN_EXPECTED` and `test_seed_mythology.py` lock
**role but not realm**. Every error below passes and reports OK:

| Who | Seeded at | Should be |
|---|---|---|
| Minos | 9th circle | 2nd circle entrance (Inf. V.4-15) |
| Aeacus, Rhadamanthus | 9th circle | not in the *Commedia* at all; Plato's judgment is a fork in a meadow, before punishment (Gorgias 524a) |
| Charon | Purgatory | Hell's gate, ferrying Acheron — Dante's purgatorial boatman is an angel |
| Cerberus | 1st circle | 3rd, the gluttons (Inf. VI) |
| Hades | Limbo | no "Hades' level" exists in Dante |
| Horus | guardian at the Duat entrance | Hall of Two Truths, conduit — he leads the dead to Osiris after the weighing |
| Anubis | judge | operates the scales |
| Thoth | judge | scribe; records and reads the verdict |
| Ma'at | judge | the standard itself — her feather goes in the pan |
| 孟婆 | 待审所 | 第十殿, six bridges (the repo's own tenth-court realm says so) |

`EG_AM_TYAT` ("Path of Amtyat") could not be found in Budge, UCL, museum records
or general search — most likely Am-Tuat (a book title) or Amentet turned into a
place. `EG_DEVOURER` models annihilation as somewhere to go; being eaten by Ammit
is the second death, ceasing to exist, and Ammit stands by the scales.

Four king descriptions contradict their own realms — 卞城王 is described as
handling reincarnation scheduling, which is the tenth king's job. The realm side
is right in each case; the actors were never updated.

### 3. The template has a shape Europe cannot fill

Christianity has no named bench. One judge, no jury, no division of labour.
That is not a gap in the research — the theology does not use this structure.

And the judge is missing: `grep -i 'christ\|jesus\|基督\|耶稣'` returns nothing
across the repo, while John 5:22 and the Nicene Creed name Christ explicitly. The
project made God an overseer and gave JUDGE to Michael — but Michael weighing
souls is a medieval iconographic motif borrowed from Egyptian *psychostasia*;
his liturgical role is to lead (*signifer sanctus Michael repraesentet eas in
lucem sanctam*), which is CONDUIT.

Seven of the eleven European actors are Greek, three of them judges. **Europe's
bench is filled entirely by Greeks.** The Egyptian forgery was what "fill the
template" pressure produced there; Europe was under the same pressure and
answered it by counting Greeks as European.

The Egyptian report also found where the 35 fake names came from: the twelve
seated gods above the scene in the Papyrus of Ani are the actual tribunal, and an
encyclopedia's prose line about "nine great judges" is a garbling of that row.

## Two sound anchors found along the way

**功过格** — `gongguoge.md` has the complete 《太微仙君功過格》 (1171, Daoist
Canon): 36 merit + 39 demerit entries, full text and values, two independent
transcriptions collated. It is what the `+100/+50` scoring always was. Its
preface supplies the hook this project could not otherwise justify: the numbers
you keep yourself 「與上天真司考校之數，昭然相契，悉無異焉」 — your own ledger *is*
heaven's. Note it is a ledger the living keep on themselves, not a penal code, so
using it here is a deliberate appropriation and should say so.

Two things it adds that the model cannot currently hold: half-points, and
**non-fungibility** — 《文昌帝君功過格》's 凡例 states that a hundred merits of
almsgiving cannot offset a hundred demerits of causing a death. The ledger
currently lets exactly that happen.

**BD 144/147 and 145/146** — seven and twenty-one gates, same scripture and same
edition as the 42 assessors, and about the dead person's journey. Preferable to
the twelve gates: the Book of Gates and the Amduat are two different books about
Ra's night voyage, and their names must not be interleaved.

## Outstanding

Nothing below is done. Each has its evidence in these reports already.

1. **Make the audits lock realm.** Fix the data first, then lock — locking first
   cements the errors. Without this the rest drifts back silently.
2. Positions above; add Christ, move Michael to CONDUIT, and mark the empty bench
   as a finding rather than filling it.
3. `frontend/src/config/workflow-templates.ts`: all five Egyptian templates put
   Osiris' judgment in the Field of Reeds (that is where the acquitted go
   afterwards), place Ammit before the verdict rather than on the failure branch,
   and invent a "Horus · first hearing". The Greek template inverts Plato — Minos
   is the final arbiter, not the first.
4. `docs/` corrections. Both `docs/02` and `docs/03` cite a "Wisconsin papyrus"
   that does not exist. The Egyptian documents also exist as byte-identical
   copies under `埃及冥界/`; de-duplicate before editing or the first fix forks.
5. Re-anchor the Chinese side to the 功过格, with a new corpus value —
   `HELL_LAW` is the wrong name for a self-kept ledger.

## A note on trust

`docs/` is currently **less reliable than the seed data**. The seeder has 望乡台
at the fifth court and 孟婆 at the tenth; `docs/09` reverses them. `docs/03` §5
describes Ammit correctly while the database does not. Anything reading these
documents as authoritative — as the statute seeding did — should stop.
