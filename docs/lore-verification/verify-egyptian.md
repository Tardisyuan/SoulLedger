# Egyptian underworld data (everything except the 42 assessors) — source verification

**Research round only. No repo files were modified.**
Compiled 2026-08-14. Methodology inherited from `scratchpad/42-assessors.md`:
name the edition, prefer public-domain primary transcriptions, treat
encyclopedias as suspects, and declare gaps rather than fill them.

---

## 0. Bottom line

- **The nine principal Egyptian actors are all real deities, correctly spelled,
  and none is fabricated.** This is *not* a repeat of the 35 fake assessors.
- **But six of the nine are placed in the wrong realm, and four carry a role
  that the sources do not support.** The single worst is `Horus` — the two
  seeders disagree with each other, and *both* are wrong.
- **`EG_AM_TYAT` / "Path of Amtyat" is unattested.** I could not find "Amtyat"
  in any edition, museum record, or lexicon. This is the one genuinely
  fabricated-looking row in the Egyptian realm table (§3.4).
- **`EG_DEVOURER` as a realm is a modelling error, not a translation error.**
  Ammit has no realm; annihilation is the *absence* of a destination (§3.3).
- **The twelve gates are real, ancient, and from a book this project is not
  otherwise using.** They are the **Book of Gates** (門之書), not the Book of
  the Dead. `docs/03` currently denies they are ancient — that denial is itself
  wrong (§4). Twelve gates and twelve hours are **not** the same thing, but
  they are also not unrelated: see §4.2 for the precise relationship.
- **`Set` should not be seeded as a `JUDGE` of the dead** (§5).
- **13 distinct errors found**, listed in §7.

---

## 1. What is currently in the database

### 1.1 Realms — `seed_mythology.py:174-185` (`EGYPTIAN_REALMS`)

| code | name_zh | name_en | RealmType | order |
|---|---|---|---|---|
| `EG_DUAT_ENTRY` | 杜阿特入口 / 杜阿特之门 | Gate of Duat | PURGATORY | 1 |
| `EG_HALL_TWO_TRUTHS` | 真理殿堂 / 两真之殿 | Hall of Two Truths | PURGATORY | 2 |
| `EG_AARU` | 阿鲁之地 / 芦苇之地 | Field of Reeds (Aaru) | BLISS | 1 |
| `EG_AM_TYAT` | 阿姆·特亚特 / 芦苇之地边境 | Path of Amtyat | NEUTRAL | 3 |
| `EG_DEVOURER` | 吞噬者 / 阿米特之地 | Devourer's Realm | HELL | 10 |

### 1.2 Principal actors — `seed_mythology.py:352-380` (`EGYPTIAN_ACTORS`)

| name | name_egy | role | realm |
|---|---|---|---|
| Osiris | Wsir | JUDGE | `EG_HALL_TWO_TRUTHS` |
| Anubis | Inpw | JUDGE | `EG_HALL_TWO_TRUTHS` |
| Thoth | Djehuty | JUDGE | `EG_HALL_TWO_TRUTHS` |
| Ma'at | Maat | JUDGE | `EG_HALL_TWO_TRUTHS` |
| Ammit | Ammut | EXECUTOR | `EG_DEVOURER` |
| Horus | Hor | **GUARDIAN** | **`EG_DUAT_ENTRY`** |
| Isis | Aset | CONDUIT | **`EG_AARU`** |
| Nephthys | NebetHet | CONDUIT | **`EG_AARU`** |
| Ra | Re | OVERSEER | **`EG_AARU`** |

Plus the 42 assessors (`EGYPTIAN_ASSESSORS`, JUDGE, `EG_HALL_TWO_TRUTHS`) —
verified in the previous round, not re-examined here.

### 1.3 The second, conflicting seeder — `backend/scripts/populate_egyptian_actors.py:54-95`

| name | role | realm | conflicts with `seed_mythology`? |
|---|---|---|---|
| Horus | **JUDGE** | **`EG_HALL_TWO_TRUTHS`** | **yes — role *and* realm** |
| Ammit | EXECUTOR | `EG_DEVOURER` | no |
| Isis | CONDUIT | **`EG_HALL_TWO_TRUTHS`** | **yes — realm** |
| Nephthys | CONDUIT | **`EG_HALL_TWO_TRUTHS`** | **yes — realm** |
| Set | **JUDGE** | `EG_HALL_TWO_TRUTHS` | only place `Set` exists |

The file's own docstring already admits the Horus/Isis/Nephthys disagreement.
**Resolution (§2.6, §2.7): on realm, `populate_egyptian_actors.py` is the one
that is right and `seed_mythology.py` is wrong.** All three belong in the Hall.

### 1.4 Organization nodes — `backend/apps/org/management/commands/init_organizations.py:84-88`

`DUAT` (埃及冥界) → `DUAT_HALL` (真理大厅), `DUAT_GATES` (十二门),
`DUAT_APEP` (阿佩普领域). `DUAT_GATES` has **zero** child entities.

### 1.5 Downstream consumers

- `backend/apps/disposition/services.py:71-73, 230-236` — routes `PASSED`→
  `EG_AARU`, `FAILED`→`EG_DEVOURER`, else `EG_DUAT_ENTRY`.
- `frontend/src/config/workflow-templates.ts:170-232` — five Egyptian workflow
  templates. Contains its own errors (§7, items 11–13).
- Docs: `docs/01_埃及冥界整体架构.md`, `docs/02_奥西里斯审判详解.md`,
  `docs/03_杜阿特十二门详解.md`. **Byte-identical duplicates exist at
  `埃及冥界/01…`, `02…`, `03…`** (verified with `diff -q`) — any correction has
  to be applied twice or the duplicates removed.

---

## 2. The Weighing of the Heart — who actually does what

### 2.1 The scene, from a primary edition

Budge's description of **Papyrus of Ani, Plate III** (*The Book of the Dead:
The Papyrus of Ani*, 1895, pp. 255–258 — public domain):

> "Vignette: Scene of the weighing of the Heart of the Dead. Ani and his wife
> enter the Hall of Double Law or Truth… Above, twelve gods, each holding a
> sceptre, are seated upon thrones… Upon the beam of the scales sits the
> dog-headed ape which was associated with Thoth, the scribe of the gods. **The
> god Anubis, jackal-headed, tests the tongue of the balance**… On the right of
> the balance, **behind Anubis, stands Thoth, the scribe of the gods, with his
> reed-pen and palette… with which to record the result of the trial**. Behind
> Thoth stands the female monster Amam, the 'Devourer', or Am-mit."

The inscription over Anubis's head, in Budge's translation:

> "He who is in the tomb saith, 'I pray thee, **O weigher of righteousness**, to
> guide (?) the balance that it may be stablished.'"

And BD Chapter 30B, spoken by the deceased in the same plate, names Anubis by
function: *"may there be no parting of thee from me in the presence of **him who
keepeth the scales**."*

**Plate IV**, immediately after, is the outcome:

> "Ani, found just, **is led into the presence of Osiris**. On the left the
> hawk-headed god **Horus, the son of Isis**… **takes Ani by the hand and leads
> him forward towards 'Osiris, the lord of eternity'**, who is enthroned on the
> right within a shrine… **Behind him stand Nephthys on his right hand and Isis
> on his left.**"

The British Museum's own description of the **Papyrus of Hunefer** (BM EA
9901/3, 19th Dyn.) is the same scene independently: Anubis leads the deceased to
the balance *and* kneels to adjust the plumb-weight; Thoth holds pen and palette
to record the outcome; Ammit crouches below the balance; **Horus then conducts
Hunefer to the shrine where Osiris sits enthroned with Isis and Nephthys**.
(BM's page returns HTTP 403 to automated fetch; this wording was recovered
through the search index and independently corroborated by the Wikimedia
Commons record for the same plate — §8.)

Two different papyri, two different centuries, two different institutions,
**same division of labour**.

### 2.2 Anubis vs Thoth — the answer

| | Anubis (Inpw) | Thoth (Ḏḥwty) |
|---|---|---|
| Physical act | **Operates the balance.** Adjusts the plumb-bob, tests the tongue/pointer. | **Records.** Reed-pen and palette, black and red ink. |
| Epithet in the scene | "weigher of righteousness"; "him who keepeth the scales" | "the scribe of the gods"; BM 9900 (Nebseni) labels the ape on the beam "**Thoth, lord of the scales**" |
| Also | Leads the deceased *into* the hall (Hunefer) | **Announces the verdict to the tribunal** — see below |
| Verdict authority | none | reports; does not decide |

**They are not interchangeable, and the repo does not currently distinguish
them at all** — both are `JUDGE`.

Thoth's second function is the one people miss. Budge/Ani p. 258:

> "**Thoth, the righteous judge of the great company of the gods** who are in
> the presence of the god Osiris, saith: 'Hear ye this judgment. The heart of
> Osiris hath in very truth been weighed… There hath not been found any
> wickedness in him…'"
>
> "The great company of the gods reply to Thoth… 'That which cometh forth from
> thy mouth hath been ordained… **Let it not be given to the devourer Amemet to
> prevail over him.** Meat-offerings and entrance into the presence of the god
> Osiris shall be granted unto him, together with a homestead for ever in
> Sekhet-hetepu.'"

So the procedure is: **Anubis weighs → Thoth records and reports → the Ennead
ratifies → Horus escorts the vindicated to Osiris → Osiris receives.** Ammit
acts only on failure.

Budge's own footnote on Thoth (p. 256 n. 3) is worth keeping because it is
where the JUDGE label half-comes-from: *"As 'lord of Law' he presides over the
trial of the heart of the dead, and… he is represented in funereal scenes as
the justifier also of the dead before Osiris."* Thoth is a *judge* in the sense
of assessor/registrar, not in the sense of the one who pronounces sentence.

**Verdict on the repo's labels:**

| Actor | Repo role | Correct? | Best available role in `ActorRole` |
|---|---|---|---|
| Osiris | JUDGE | ✅ **correct** — he is the presiding god of the tribunal | JUDGE (keep) |
| Anubis | JUDGE | ❌ **wrong in kind** — he is the balance operator, not a judge | no clean fit; `EXECUTOR` is wrong (that's Ammit), `CONDUIT` fits his escort role but loses the weighing. **See recommendation §9.2** |
| Thoth | JUDGE | ⚠️ **defensible but imprecise** — recorder/registrar, and the one who reports the verdict | JUDGE acceptable if the description carries the scribal function; the current description *already says* "records the verdict, advises Osiris" and is the most accurate string in the file |
| Ma'at | JUDGE | ❌ **wrong** — she is the *standard*, not a juror. Her feather goes *in the pan*; in BM 9901 she sits on the beam | not a judge; see §9.2 |
| Ammit | EXECUTOR | ✅ **correct** — Budge calls her exactly this in effect; she executes the sentence | EXECUTOR (keep) |

Note on Ma'at: BD 125's own title, in UCL/Quirke's rendering from the Papyrus
of Nu (BM EA 10477), is *"The book of entering the broad hall of the **Two
Goddesses Right**"* (`wsxt nt mAaty` — a **dual**). The hall is named for *two*
Maat goddesses. Budge renders the same as "Hall of Double Law or Truth". The
repo's "Hall of Two Truths / 两真之殿 / 真理殿堂" is a sound conventional
rendering of this and needs no change.

### 2.3 Horus — the item the brief flagged, and both seeders are wrong

**What Horus does:** he takes the *already-vindicated* deceased by the hand and
leads him into Osiris's shrine. Attested in Ani (Budge Pl. IV, quoted above),
in Hunefer (BM), and it is specifically **Horus son of Isis** (Ḥr-sꜣ-Ꜣst),
wearing the double crown.

**What the repo says:**

- `seed_mythology.py`: `GUARDIAN` @ `EG_DUAT_ENTRY`, "protects the living and
  **guides souls through the Duat**." — ❌ Wrong realm, wrong role. Horus is not
  a gatekeeper of the Duat entrance, and he does not conduct the soul *through*
  the Duat (that is Anubis's and the sun-barque's business). He appears in the
  Hall, *after* the weighing.
- `populate_egyptian_actors.py`: `JUDGE` @ `EG_HALL_TWO_TRUTHS`, "**Horus acts
  as prosecutor in trials against Set**." — ❌ Right realm, wrong reason. This
  sentence conflates **two entirely different tribunals**:
  - the **judgment of the dead** (BD 125, Hall of the Two Maats, one dead human
    on trial), and
  - **The Contendings of Horus and Seth** (Papyrus Chester Beatty I, 20th Dyn.,
    ~1147 BCE), a *succession lawsuit* between two gods before the Ennead
    presided over by Re-Horakhty, in which Osiris is a **correspondent who
    replies by letter from the underworld**, not the judge, and no human is
    judged at all.

  Set is the defendant in the second and absent from the first. Horus is a
  litigant in the second and an usher in the first. Merging them produces the
  "Horus is a prosecutor in the Hall of Two Truths" claim, which no source
  supports.

**Correct:** `EG_HALL_TWO_TRUTHS`, and the role is escort/introducer —
`CONDUIT` is the closest of the existing roles. `GUARDIAN` and `JUDGE` are both
wrong.

### 2.4 Osiris

Correct as seeded. Confirmations: BD 125A addresses him as "great god, lord of
the place of the Two Goddesses of What is Right" and names him **Wennefer**
(`wnn-nfr`) — "on that day of calculating characters in the presence of
Wennefer" (UCL/Quirke, Papyrus of Nu). His judicial epithet is **Khentyamentiu**
("Foremost of the Westerners"), an title he *took over from Anubis* during the
late Old Kingdom.

The repo's title string `Osiris - Lord of the Duat` is fine, though
`Khentyamentiu / Foremost of the Westerners` would be the attested judicial
title if precision is wanted.

`docs/01` §1.2's parenthetical "阿努比斯（最初审判者，后由奥西里斯接替）" is
**substantially correct** and one of the better lines in the docs — Anubis held
the Khenty-Amentiu title and the offering formula before Osiris absorbed both.

### 2.5 Ammit

Correct as an actor. Her physical description in the repo ("part lion, part
hippopotamus, part crocodile") matches the inscription beside her in **BM 9901**
verbatim, which Budge transcribes and translates: *"the fore-part of a
crocodile; her hind quarters [are those] of a hippopotamus; her middle part [is
that] of a lion."* `docs/01` §1.2's correction to 混合怪物 is right.

Her **position** is the problem, not her identity — see §3.3.

### 2.6 Isis and Nephthys — wrong realm

They stand **behind Osiris's throne in the Hall** (Budge/Ani Pl. IV: "Behind him
stand Nephthys on his right hand and Isis on his left"; BM's Hunefer text says
the same). They are not residents of Aaru.

`populate_egyptian_actors.py` places them in the Hall and is **correct**;
`seed_mythology.py` places them in `EG_AARU` and is **wrong**. The docstring of
the former assumes it is the one that is out of step — it isn't, on this point.

`CONDUIT` is a reasonable role for both (protective/mourning attendants).

### 2.7 Ra — wrong realm, and the role deserves a second look

Ra is `OVERSEER` @ `EG_AARU`. **Aaru is not Ra's domain.** Ra's netherworld
role is the nightly transit of the Duat in the solar barque (Amduat, Book of
Gates) and, in the judgment vignette, presiding at the head of the divine
tribunal.

The Ani vignette's **upper register of twelve enthroned gods** is that tribunal,
and Budge names them (Pl. III, p. 255): **Harmachis** (Ra-Horakhty) "the great
god within his boat", **Tmu** (Atum), **Shu**, **Tefnut**, **Seb** (Geb),
**Nut**, **Isis**, **Nephthys**, **Horus** "the great god", **Hathor** "lady of
Amenta", **Hu**, **Sa**.

Two consequences worth recording:

1. **`Ra`, `Isis`, `Nephthys` and `Horus` all genuinely belong in
   `EG_HALL_TWO_TRUTHS`** — they sit in this register. The repo has the right
   four gods filed in the wrong two places.
2. **This is where the deleted 35-name fake list came from.** The previous round
   traced the padding to World History Encyclopedia's sentence about "nine great
   judges: Ra, Shu, Tefnut, Geb, Nut, Isis, Nephthys, Horus, Hathor". That
   sentence is a garbled description of *this register* — nine of WHE's names
   are in Budge's twelve, in order. So the fake list was not invented from
   nothing; it was **the Ani tribunal register mistaken for the bench of 42**.
   Worth putting in the comment beside the collision guard, because the same
   confusion will recur.

`OVERSEER` for Ra is defensible on the tribunal reading. The realm is not.

---

## 3. Realm structure

### 3.1 `EG_HALL_TWO_TRUTHS` — correct

Attested, correctly named, correctly typed. See §2.2 note on the dual.

### 3.2 `EG_AARU` — correct name, but the docs' claim about its location is unsupported

**Aaru is real and correctly named.** Egyptian `sḫt-iꜣrw`, "Field of Reeds".

Budge (Ani, 1895, p. cxlviii and the glossary, p. 8242 of the OCR):

> "Sekhet-Aanru, the 'Field of the Aanru plants'… **According to the vignette of
> the CXth Chapter of the Book of the Dead, the Sekhet-Aanru is the third
> division of the Sekhet-hetepu**, or 'Fields of Peace'."

So the strict relationship is **Aaru ⊂ Sekhet-hetep (Field of Offerings)**, and
BD 110 is the chapter for both. The Ani verdict grants "a homestead for ever in
**Sekhet-hetepu**", not Aaru by name.

**Where the docs are wrong:** `docs/01` §2.1 note asserts *"芦苇原（Aaru）位于杜
阿特**之外**的天界/极乐之地，并非杜阿特的一部分"* and repeats it in the
comparison table (`最终归宿：芦苇原（杜阿特之外的天界）`). **I could not find
support for this as a flat statement, and there is direct counter-evidence:**

- UCL's own chapter list gives **BD 145** as *"Start of the gateways of **the
  Field of Reeds of the domain of Osiris**"* and **BD 146** as *"Start of the
  gateways of the domain of Osiris **in the Field of Reeds**"*. The Field of
  Reeds is inside Osiris's domain, reached through its portals — i.e. inside
  the netherworld, not outside it.
- **BD 144/147** likewise name the seven approaches to "the house of Osiris **in
  the field of reeds**".

The honest position is that **Egyptian afterlife geography is not consistent
across the corpus** — Aaru is variously placed in the eastern sky, in the Delta
(Budge's own note: "a name originally given to the islands in the Delta"), and
as a division of the netherworld's Field of Offerings. **Asserting one of these
as *the* truth, and doing so in bold, is the error.** The doc should either
state the variation or say nothing.

The database row itself (`BLISS`, reached after judgment) is fine and is not
affected by this.

### 3.3 `EG_DEVOURER` — the modelling is wrong

**The fact:** what happens after Ammit eats the heart is **the "second death"
(non-existence)**. There is no place the damned go. That is the entire
theological point, and it is what distinguishes the Egyptian system from the
Christian and Chinese systems already in this repo — the failed soul does not
suffer, does not wander, does not get punished. It **stops**.

**The evidence that Ammit has no realm:** she is consistently drawn *at the
balance*, in the Hall. Budge (Ani p. 258 n.): *"The Devourer usually stands near
the balance instead of behind Thoth; but there is one papyrus… in which she is
shown **crouching beside the lake of fire** in the infernal regions."* That one
variant is the closest thing to a location she has, and it is a **Lake of Fire**
(attested independently — BD 17's vignette is "a lake of fire, at each corner of
which sits an ape"), **not** a realm called "Devourer's Realm".

**So `EG_DEVOURER` (吞噬者 / 阿米特之地 / "Devourer's Realm", `RealmType.HELL`,
order 10) asserts three things that are not in the sources:**

1. that there is a place;
2. that Ammit lives in it (she stands in the Hall);
3. that it is a **hell** — a destination where a soul is, rather than the
   termination of the soul.

Notably, **`docs/03` §5 already says this correctly**: *"阿米特不在杜阿特的任何
一门或区域之中… 正确位置：阿米特在真理大厅的审判现场等待… 阿米特是审判的结果执行
者，不是冥界旅程的关卡守卫。"* The document is right and the database
contradicts it.

**Is the modelling defensible anyway?** Partly. `disposition/services.py` needs
*some* terminal value for `FAILED`, and a schema built around "every soul ends
in a realm" has no vocabulary for "ceases to exist". The pragmatic options, in
descending order of fidelity:

- **(a)** Keep a row but re-describe it as the **outcome** rather than a place:
  code `EG_ANNIHILATION` / 湮灭 / "Second Death (annihilation by Ammit)". Move
  Ammit's residence to `EG_HALL_TWO_TRUTHS`, where she is drawn. This keeps
  `disposition` working with a one-line change and stops the database asserting
  a hell that Egypt did not have.
- **(b)** If a *place* is genuinely wanted, the only attested one is the **Lake
  of Fire** (`EG_LAKE_OF_FIRE`), which at least has a vignette behind it — but
  it is a feature of the netherworld landscape, not a destination for the
  damned, so this is weaker than (a).
- **(c)** Leave as-is and document the compromise. Acceptable only if the
  description string stops calling it Ammit's home.

**Whatever is chosen, `Ammit`'s `realm` should move to the Hall.** That change
is unambiguous and independent of the realm question.

### 3.4 `EG_AM_TYAT` — unattested, and the likeliest of all these rows to be invented

`("EG_AM_TYAT", "阿姆·特亚特", "芦苇之地边境", "Path of Amtyat", "Amtyat",
RealmType.NEUTRAL, 3, "Border realm before the final judgment", …)`

**I searched for "Amtyat" as an Egyptian place, realm, or deity and found
nothing** — not in Budge's *Book of the Dead* glossary (which I have as full
text and grepped), not in Budge's *Egyptian Heaven and Hell* vol. II (likewise),
not in UCL Digital Egypt, not in any museum record, not in web search. There is
no "Path of Amtyat" and no "border realm before the final judgment" in the
Egyptian afterlife corpus.

**Three plausible sources of the string, none of which rescues it:**

| Candidate | What it actually is | Verdict |
|---|---|---|
| **Am-Tuat** (`Imy-Dwꜣt`) | The *title of a book* — "That which is in the Duat", i.e. the **Amduat**. Budge's *Egyptian Heaven and Hell* vol. I is "The Book Am-Tuat". | A book, not a place. If this is the origin, the row is a book title mistaken for a realm. |
| **Amentet / Amenti** (`Imntt`) | "The West" — a standard name for the necropolis/underworld. Budge glosses **Set-Amentet** as "the mountain of the underworld… the cemetery… on the western bank of the Nile". | Real, but it means the whole West, not a border strip before judgment. |
| **Am-mit** | Ammit herself. | Already has a row. |

**Recommendation: delete the row, or replace it with something attested.** If a
"between the gate and the hall" waypoint is structurally needed by the
`disposition` state machine, the corpus-correct filler is **the seven ꜥrrwt-gates
of BD 144/147** (§4.4), which are literally the approaches to the house of
Osiris. Inventing a Latin-looking name for a transit realm is exactly the
failure mode the 42-assessor round was correcting.

### 3.5 `EG_DUAT_ENTRY` — acceptable, with one caveat

"Gate of Duat / 杜阿特入口" is a reasonable modelling handle. The Duat is
entered in the west at sunset; Budge's Book of Gates opens with the boat sailing
between the two halves of the western mountain into the ante-chamber called
**Set-Amentet**. So there is a real entrance and a real name for it.

Caveat: **Horus should not be its guardian** (§2.3). If a guardian is wanted,
the attested figures at that threshold are the two kneeling gods **Tat and Set**
(see §5 — the second is *not* Seth), or **Aker/Akeru**, the double-lion earth god
of the western/eastern horizons that `docs/03` §3.1 already mentions as "Akeret
（双狮门）". Aker is genuine; "Akeret" is a misspelling of **Aker**.

### 3.6 The `docs/01` §2.2 "十二门" table is fabricated

蛇焰区 / 火湖区 / 尘土区 / 黑暗区 / 战斗区 / 焚尸区 / 沸水区 / 腐尸区 / 巨蛇区 /
烈焰区 / 真理之地 — **eleven rows presented as twelve**, with guard names like
"无名鬼", "食心魔", "腐尸怪". None of these corresponds to anything in the
Amduat, the Book of Gates, or the Book of the Dead. The names read like a
generic hell-tier list.

To the doc's credit it labels the table 现代重构 and says the guards are 推测.
But labelling invented data as a "modern reconstruction" does not make it
sourced — nobody reconstructed this. **It should be deleted, not annotated.**

---

## 4. The Twelve Gates — which book, and are they the same as the twelve hours?

### 4.1 Which book: the **Book of Gates**, and it is genuinely ancient

**`docs/03`'s central claim is wrong.** It states:

> 「十二门」结构是**现代学者根据各章节描述重构**的，并非古典文献的统一记载。

That is not true. There is an ancient Egyptian composition **whose organising
principle is twelve gates**, it is called the **Book of Gates**
(German *Das Buch von den Pforten*, 門之書), it is a New Kingdom royal
netherworld book, and it names every gate and every gate-guardian. The **first
complete version is inscribed on the alabaster sarcophagus of Seti I** (19th
Dyn.), which is also Budge's principal witness.

What *is* a modern invention is the specific list in `docs/01` §2.2 (§3.6). The
doc correctly smelled that its own table was fake and then wrongly generalised
that to the whole tradition. **Both halves need fixing: the table is worse than
the doc says, and the tradition is better attested than the doc says.**

### 4.2 Book of Gates vs Amduat vs "twelve hours" — the precise relationship

This is the confusion the brief asked about, and the answer is not a simple
"they're different".

| | **Amduat** (阿姆杜阿特 / 冥界之书) | **Book of Gates** (门之书) |
|---|---|---|
| Egyptian title | `Imy-Dwꜣt`, "That which is in the Duat" | (no single ancient title) |
| Structure | **12 hours** of the night, each a "City"/Circle | **12 divisions**, each corresponding to an hour of the night |
| Organising device | the **hour** and its region | the **gate** between regions |
| Each unit has | a City name, an Hour name, **and a gate/door name** | a gate with a **named guardian serpent**, plus nine mummiform gods and fire-spitting uraei |
| Solar barque crew | large | **only Heka and Sia** with Ra |
| Distinctive content | — | contains **its own Judgment Hall of Osiris scene** (Budge ch. VII), separate from BD 125 |
| Earliest | Thutmoside royal tombs | Horemheb onward; Seti I sarcophagus |

**So:**

- **Twelve gates ≠ twelve hours** — they are the structuring devices of **two
  different compositions**, and the two books have different content, different
  crews, different guardians.
- **But both are twelve-fold, and both map onto the twelve hours of the night.**
  The Book of Gates' divisions *are* the night hours; its innovation is putting
  an elaborate named gate at each boundary. The Amduat's hours *also* each have
  a named gate. So "the twelve gates" and "the twelve hours" describe the same
  underlying twelve-part night from two different angles — but the **names do
  not transfer between the two books.** Seeding Book-of-Gates guardian names
  under Amduat hour labels (or vice versa) would be a silent splice of exactly
  the kind that corrupted the Wikipedia assessors table.
- **Neither book is the Book of the Dead**, which is where the rest of this
  project's Egyptian data comes from. The Book of Gates and Amduat are **royal
  tomb texts about Ra's nightly journey**, not guides for a private individual's
  judgment. The deceased is not the protagonist; the sun god is.

**One unresolved point, stated rather than smoothed:** the gate *count* depends
on the counting convention.

- **Budge (1905)** numbers **eleven gates** between twelve divisions, with
  Division 1 = the **Western Vestibule** (`Set-Amentet`, entered through the
  cleft of the western mountain, no serpent gate) and Division 12 = the
  **Eastern Vestibule**.
- **Modern summaries** (and Wikipedia) say "twelve gates", counting a gate at
  the end of each of the twelve hours.

They are describing the same monument. I have **not** resolved which convention
Hornung's critical edition uses (*Das Buch von den Pforten des Jenseits*, 1979;
English *The Egyptian Book of Gates*, Hornung & Abt) — both are in copyright and
I did not reach the text. **If the twelve gates are ever seeded, this must be
resolved against Hornung first, because it determines whether there are 11 or 12
rows.**

### 4.3 The correct data, if the Book of Gates is what gets landed

Read off **Budge, *The Egyptian Heaven and Hell*, vol. II: The Short Form of the
Book Am-Tuat and The Book of Gates** (1905) — public domain, full text obtained
from the Internet Archive and read directly (§8). Table of contents pp. vii–viii,
cross-checked against the chapter headings and body text.

| # | Gate proper name (Budge) | Guardian serpent (Budge) | Admits to | Body-text confirmation |
|---|---|---|---|---|
| — | **Set-Amentet** — Western Vestibule / Ante-chamber | Tat and Set (see §5) | Division 1 | ch. II |
| 1 | *(none given in TOC)* | **Saa-Set** | Division 2 | ch. III, l. 3061 |
| 2 | **Septet-uauau** | **Aqebi** | Division 3 | l. 3762, l. 3769 |
| 3 | **Nebt-tchefau** *(TOC OCR "Nevt-s-Tchefau"; Budge's own errata, p. 331, corrects p. 119 to read "Nebt-tchefau")* | **Tchetbi** | Division 4 | l. 4700 |
| 4 | **Arit** | **Teka-hra** | Division 5 | l. 5615, l. 5645 |
| — | **The Judgment Hall of Osiris** (Budge ch. VII, p. 158) | — | between Div. 5 and Div. 6 | — |
| 5 | ⚠ **unreadable in this scan** — printed variously as "Nesr-ini" (TOC) and "Nenr-ani" (l. 6327) | **Set-em-maat-f** | Division 6 | ch. VIII, l. 6783 |
| 6 | **Pestit** | **Akha-en-maat** | Division 7 | ch. IX, l. 7799, l. 7828 |
| 7 | **Bekhkhi** | **Set-hra** | Division 8 | l. 8820 |
| 8 | **Aat-shefshefit** | **Ab-ta** | Division 9 | l. 9690 |
| 9 | **Tcheserit** | **Sethu** | Division 10 | l. 10551, l. 10613 |
| 10 | **Shetat-besu** | **Am-netu-f** | Division 11 | l. 11476 |
| 11 | **Tesert-baiu** — *"or the Eastern Vestibule of the Tuat"* | **Sebi and Reri** (two serpents, one per door) | Division 12 | l. 12305, l. 12415, l. 12432 |

**Confidence:** guardian names — high, all eleven confirmed in the body text as
well as the TOC. Gate proper names — high for #2, #4, #6, #9, #11 (confirmed in
body); TOC-only for #3, #7, #8, #10; **#5 is not recoverable from this scan**
and #1 has no proper name in Budge's TOC. **Do not guess #5.** A second scan of
the same 1905 edition would probably close it, exactly as scan B closed
assessor #16 last round.

**Cross-check against a second (weak) witness:** Wikipedia's *Book of Gates*
gives English renderings — "Watcher of the Desert" for the gate whose serpent is
*Saa-Set*, "Piercing of Embers" for the next, "Closed of Eye" and "Flaming of
Face" for later serpents. These align with Budge modulo the ±1 counting offset
(§4.2), which is a mild independent confirmation of the *sequence* but **not a
source I would seed from** — it is the same publication whose assessors table
was found corrupt last round.

### 4.4 The alternative that actually fits this project

**If what is wanted is "the gates a dead person passes on the way to Osiris",
the Book of Gates is the wrong text** — it is about Ra, not about the deceased.
The Book of the Dead has its own gate corpus, and it is the corpus the 42
assessors already come from:

| Spell | Content (UCL/Quirke's chapter list) | Count | Guardians |
|---|---|---|---|
| **BD 144** and **BD 147** (variants of one text) | "Knowing the names of the keepers of the **seven approaches**" (`ꜥrrwt`-gates of the house of Osiris in the west) | **7** | **three per gate**: `iry-ꜥꜣ` doorkeeper, `sꜣw` watcher, `smi` herald = **21 named beings** |
| **BD 145** and **BD 146** (variants of one text) | "Start of the gateways of the Field of Reeds of the domain of Osiris" (`sbḫt`-portals) | **21** | **one demon per portal** |

This is what `docs/03` §1 is half-remembering when it says *"有的说7个门廊"* —
that line is **correct** and points at BD 144/147.

**Recommendation (§9.3): seed BD 144/147's seven ꜥrrwt with their 21 guardians,
not the Book of Gates' twelve.** Reasons: (i) same corpus, same papyri, same
edition family as the 42 assessors already in the database — one citation
policy covers everything; (ii) it is about the deceased's journey, which is what
the application models; (iii) it gives `EG_AM_TYAT`'s slot something real to be
(§3.4); (iv) Budge's *Book of the Dead* vol. II, already the source for the
assessors' towns and confessions, contains chapters 144–147 in the same public
domain volume, so no new sourcing problem.

**If the twelve gates are wanted anyway**, use §4.3, record `Budge 1905, The
Egyptian Heaven and Hell II` and `sarcophagus of Seti I` in `powers_json`
exactly as the assessors do, resolve the 11-vs-12 question first, and **rename
the org node** `DUAT_GATES` from 十二门 to something that says which book it is.

### 4.5 Amduat data, for completeness

Budge's *short form* of the Am-Tuat (same volume, pp. 1–39) gives each hour a
**City name**, a **gate/door name**, and an **Hour name**. Legible in this scan:

| Hour | Gate/door of the City | City | Hour of the night |
|---|---|---|---|
| 1 | — | — | Ushemet-hatu-khefti-Ra |
| 2 | — | — | Shesat-maket-neb-s |
| 3 | — | Baiu-shetatu ("Hidden Souls") | Thentent-baiu *(Budge's errata p. 331: read "Tent-baiu")* |
| 4 | **Ankh-kheperu** | — | Urt-em-sekhemu-set |
| 5 | **Aat-neteru** | Ament | Sem-her-ab-uaa-s |
| 6 | **Sept-metu** | — | Mesperit-ar-Maat |
| 7 | **Ruti-Asar** | Tephet-sheta | Khefsef-hai-heseq-neha-hra |
| 8 | **Auk-an-urt-f** | Tebat-neteru-set | Neb-usha |
| 9 | **Saa-keb** | Bes-aru | Mek-neb-s |
| 10 | **Aa-kheperu-mes-aru** | Metch-qa-utebu | Thentenit-heseq-khakabu |
| 11 | **Sekhen-Tuatiu** | Re-en-qerert-apt-khat | *(not legible)* |
| 12 | **Thenen-neteru** | Kheper-kekui-kha-mesti | *(not legible)* |

⚠ **The hour↔row alignment above is my reading of a rough OCR and is not
verified slot-by-slot against a second witness.** Several names are Budge's own
uncertain readings and the errata page corrects at least two. **This table is
adequate to demonstrate that the Amduat's twelve hours are a distinct named
series from the Book of Gates' gates — it is *not* seedable data as it
stands.** If the Amduat is ever wanted, use Budge vol. I (the long form) or
Hornung's *The Egyptian Amduat*, and cross-check.

---

## 5. Set (赛特)

**Does Set have a role in the judgment of the dead? No.**

- He does not appear in the BD 125 weighing vignette in Ani, Hunefer, or
  Nebseni.
- He is not among the 42 assessors (verified last round).
- He is not in the Ani tribunal register of twelve (§2.7).
- The only tribunal he appears before is **The Contendings of Horus and Seth**
  (P. Chester Beatty I), where he is the **defendant in a succession lawsuit
  between gods**, judged by the Ennead under Re-Horakhty. No human soul is
  judged in that text, and Osiris participates by letter, not from a throne.

**Where Set *does* belong in the netherworld:** at the **prow of the solar
barque**, where he spears **Apep/Apophis** during Ra's nightly transit. That is
a genuine, well-attested netherworld function — and it is the one the repo's own
org tree gestures at with `DUAT_APEP` (阿佩普领域), which currently has no
entities either.

⚠ **A trap in Budge to avoid.** Budge's TOC calls the Western Vestibule
*"guarded by Set and Tar"*, which looks like the chaos god standing at the Duat
entrance. **It is not.** Budge's own body text (ch. II) says of the two kneeling
bearded gods: *"one god is called Tat… and is a personification of the region
which is beyond the day, and the other **Set**… and **represents the funeral
mountain**."* This `st` is "place / seat", the same element as in
**Set-Amentet** = "the mountain/place of the West". **Do not seed Seth as a
guardian of the Duat entrance on the strength of that TOC line.**

**Recommendation:** either

- **(a) drop Set** from the seed entirely — he has no role in the judicial
  process this application models; or
- **(b) seed him as `GUARDIAN` of the solar barque / `DUAT_APEP`**, with the
  description corrected to the Apep-slaying function and the current
  "prosecutor in trials against Set" sentence deleted as a category error.

**Do not** seed him as `JUDGE` @ `EG_HALL_TWO_TRUTHS`, which is what
`populate_egyptian_actors.py` currently does. Given that script is documented as
superseded and unreachable from `manage.py`, the practical effect today is that
`Set` is **not in the database at all** — which is the safer of the two states.
The open item in the docstring is correctly flagged; **the answer to it is (a)
or (b), not "run the script".**

---

## 6. Name transliteration — consistency check

**No god appears under two spellings, and there are no collisions with the 42
assessors.** (Re-verified: Budge's 42 vs `EGYPTIAN_ACTORS` — closest calls
remain `Nefer-Tem` (#34) and `Basti` (#26), neither of which is seeded as a
principal deity.)

**On style consistency with the assessors:** the principal deities use
**conventional Latinised/Greek-derived forms** (`Osiris`, `Anubis`, `Thoth`,
`Horus`, `Isis`, `Nephthys`) with **modern Egyptological transliterations** in
`name_egy` (`Wsir`, `Inpw`, `Djehuty`, `Aset`, `NebetHet`). The assessors use
**Budge's 1904 transliteration** as the display name.

This is a **mixed but non-conflicting** scheme, and it is the right call — it is
the same convention every museum uses (nobody labels a case "Wsir"). The two
systems live in different fields for the principals and in the same field for
the assessors only because the assessors have no conventional English names.
The 42-assessor report reached the same conclusion from the other direction
(§9.3 of that document, "House style — matches exactly").

**Three small defects, all in `populate_egyptian_actors.py`:**

| Field | Current | Problem |
|---|---|---|
| Horus `name_egy` | `Heru` | `seed_mythology` uses `Hor` for the same god. **Two spellings of one deity's Egyptian name across two files** — the exact class of drift `fix_actor_civilization.SPELLING_MERGES` exists to clean up. |
| Set `name_egy` | `Seth` | `Seth` is the **Greek** form. The Egyptian is `Swtḫ` / `Stẖ` (Sutekh). Putting a Greek form in `name_egy` is a field-misuse. |
| Set `title_egy` | `Seth` | same. |

Since these rows never reach the database today, this is latent rather than
live — but it is a reason not to run that script as-is.

**One observation on the assessors' field usage** (not an error): the assessors
put Budge's gloss in `name_egy` (e.g. `wsx nmt`), while the principals put a
transliterated *name* there (`Wsir`). Slightly different semantics for one
field. Harmless, but worth a comment if anyone ever builds a UI that renders
`name_egy` uniformly.

---

## 7. Errors found — consolidated

**Data (database-affecting):**

| # | Where | Error | Severity |
|---|---|---|---|
| 1 | `seed_mythology.py:368` | `Horus` → `GUARDIAN` @ `EG_DUAT_ENTRY`. He is an escort in the Hall, post-judgment. Description ("guides souls through the Duat") also unsupported. | **high** |
| 2 | `populate_egyptian_actors.py:56-62` | `Horus` → `JUDGE`, described as "prosecutor in trials against Set" — conflates BD 125 with the Contendings of Horus and Seth. | **high** |
| 3 | `seed_mythology.py:371,374` | `Isis`, `Nephthys` @ `EG_AARU`. They stand behind Osiris's throne **in the Hall**. | medium |
| 4 | `seed_mythology.py:377` | `Ra` @ `EG_AARU`. Aaru is not his domain; his tribunal seat is in the Hall (as Harmachis/Ra-Horakhty). | medium |
| 5 | `seed_mythology.py:365` | `Ammit` @ `EG_DEVOURER`. She is drawn **at the balance, in the Hall**, in every standard vignette. | medium |
| 6 | `seed_mythology.py:183` | `EG_DEVOURER` ("Devourer's Realm", `HELL`) reifies annihilation as a place and assigns it to Ammit as a residence. Contradicts `docs/03` §5, which is correct. | medium (design) |
| 7 | `seed_mythology.py:181` | **`EG_AM_TYAT` / "Path of Amtyat" — unattested.** No such place; likely a garbling of *Am-Tuat* (a book title) or *Amentet*. | **high** |
| 8 | `seed_mythology.py:356,362` | `Anubis` and `Ma'at` both `JUDGE`. Anubis operates the balance; Ma'at is the standard being weighed against. Neither judges. | low–medium |
| 9 | `populate_egyptian_actors.py:89-94` | `Set` → `JUDGE` @ Hall. No role in the judgment of the dead. | medium (latent) |
| 10 | `populate_egyptian_actors.py:57,89-90` | `name_egy`: `Heru` vs `seed_mythology`'s `Hor`; `Seth` (Greek) in an Egyptian-name field. | low (latent) |

**Frontend (`frontend/src/config/workflow-templates.ts`):**

| # | Line | Error |
|---|---|---|
| 11 | 188, 199, 209, 220, 230 | `Osiris · 终审` is placed in court **芦苇原** (Field of Reeds) in **all five** templates. Osiris presides in the **Hall of Two Truths**; Aaru is where the vindicated *go afterwards*. |
| 12 | 186–188 | Node order `42审判者 → Ammit 吞噬宣判 → Osiris 终审`. Ammit acts **after** the verdict and **only on failure**; she is not a step before the final judgment. |
| 13 | 219 | `Horus · 初审` — Horus conducts no first-instance hearing. |

**Docs (`docs/01`, `docs/02`, `docs/03`, plus byte-identical copies in `埃及冥界/`):**

| # | Where | Error |
|---|---|---|
| 14 | `docs/03` §1, `docs/01` §2.1 | "十二门是现代重构，并非古典文献" — **false**. The Book of Gates is an ancient composition organised on exactly twelve gates. |
| 15 | `docs/01` §2.2 | The 十二门 table (蛇焰区/火湖区/…) is **fabricated**, and lists **11 rows** while claiming twelve. Labelling it 现代重构 does not source it. |
| 16 | `docs/02` §2.1 | The judgment-hall diagram includes **「复仇女神（准备惩罚）」** — there is no goddess of vengeance in the Hall of Two Truths. This looks like the Greek Erinyes leaking across civilizations. |
| 17 | `docs/02` §2.2 | The "42神（陪审团）" table splits them by 北方赫利奥波利斯诸神 / 南方底比斯诸神 / 东方尼罗河诸神 / 西方死者诸神. **Invented.** The 42 sit in **two rows of 21** (Budge 1904; UCL's Maiherperi transcription has an upper and a lower register), each tied to a **home town**, not a cardinal quarter. |
| 18 | `docs/02` §3.1 step 1 | 「摆放天平：**托特**调整天平」 — **Anubis** adjusts the balance; Thoth records. This is the exact Anubis/Thoth swap the brief asked about, and it is present in the docs. |
| 19 | `docs/02` §1.1 | 「制作木乃伊（**75**天后完成）」 — the attested figure is **70 days** (Herodotus II.86–88, and the standard museum account). |
| 20 | `docs/02` §4 | The negative confession split into 四大类别 of 10/10/10/12 with invented sample clauses. BD 125B has no such taxonomy; the real clauses are now in the database. |
| 21 | `docs/02`, `docs/03` 文献依据 | Cites **「威斯康星莎草纸」("Wisconsin papyrus")**. **No such papyrus exists** in the Book of the Dead literature. `docs/01` §2.1's diagram sourcing is likewise unattributed. This is a fabricated citation and should be removed outright. |
| 22 | `docs/01` §2.1 note, §5 table | Asserts in bold that Aaru is **outside** the Duat, in the 天界. Unsupported as a flat claim, and contradicted by BD 145/146 ("gateways of the Field of Reeds of the domain of Osiris"). The geography genuinely varies; the error is the certainty. |
| 23 | `docs/03` §3.1 | 「Akeret（双狮门）」 — the double-lion god is **Aker** (pl. *Akeru*). "Akeret" is not a form of the name. |

That is **13 code/data errors** and **10 documentation errors**.

**Not errors** (checked and found sound): all nine deity identities; Ammit's
composite description; Osiris as presiding judge; the `Ma'at` apostrophe
spelling; "Hall of Two Truths"/"两真之殿" as a rendering of `wsxt nt mAaty`;
`docs/01`'s note that Anubis preceded Osiris as lord of the dead; `docs/03` §5's
statement that Ammit waits in the Hall and is not a gate guardian; `docs/01`'s
note that Egypt has no memory-erasure mechanism analogous to 孟婆汤/Lethe; the
absence of name collisions with the 42 assessors.

---

## 8. Sources, with quality ratings

### Primary editions read directly (full text obtained and grepped, not summarised)

| Source | Nature | What it established |
|---|---|---|
| Budge, *The Book of the Dead: The Papyrus of Ani* (1895), Plates III–IV, pp. 255–259 — [Internet Archive full text](https://archive.org/details/TheBookOfTheDead-Budge-1895) | Academic edition, **public domain**. Read as full OCR text. | **The entire division of labour in the weighing scene** (§2.1): Anubis tests the balance-tongue; Thoth records with pen and palette; Thoth announces the verdict; the Ennead ratifies; Horus son of Isis leads Ani to Osiris; Isis and Nephthys stand behind the throne; Ammit's position and BM 9901's description of her; the twelve-god tribunal register. Also Sekhet-Aanru as the third division of Sekhet-hetepu (§3.2). |
| Budge, *The Egyptian Heaven and Hell*, vol. II: *The Short Form of the Book Am-Tuat and The Book of Gates* (1905) — [Internet Archive full text](https://archive.org/details/the-egyptian-heaven-and-hell-vol-2) | Academic edition, **public domain**. Principal witness: **sarcophagus of Seti I**. Read as full OCR text. | **The eleven gates and their guardian serpents** (§4.3); the Western/Eastern Vestibules; `Set-Amentet`; the "Set" that is a mountain and not Seth (§5); the Judgment Hall of Osiris inside the Book of Gates; the Amduat short-form hour/city/gate names (§4.5). |
| [UCL Digital Egypt — Book of the Dead chapters by number](https://www.ucl.ac.uk/museums-static/digitalegypt/literature/religious/bdbynumber.html) (© UCL; Stephen Quirke, 2002) | **University**, scholarly. | Authoritative chapter titles: BD 125 = "The book of entering the broad hall of the Two Goddesses Right"; **BD 144/147 = seven approaches; BD 145/146 = gateways of the Field of Reeds of the domain of Osiris**; BD 110 = Field of Hetep. The 125A/B/C/D sectioning. |
| [UCL Digital Egypt — BD 125A](https://www.ucl.ac.uk/museums-static/digitalegypt/literature/religious/bd125a.html) and [BD 125C](https://www.ucl.ac.uk/museums-static/digitalegypt/literature/religious/bd125c.html) | **University**, scholarly. Manuel-de-Codage transliteration + English, from the **Papyrus of Nu (BM EA 10477)**. | Osiris as `wnn-nfr` presiding; "the 42 gods who are with you in this broad court"; `smtr mAat`/`rdit iwsw` — "to testify to Right, to set the balance upright"; the dual `mAaty`. |

### Museum / institutional

| Source | Nature | Note |
|---|---|---|
| British Museum, Papyrus of Hunefer, [BM EA 9901](https://www.britishmuseum.org/collection/object/Y_EA9901-3) | **Museum**, authoritative. | **Page returns HTTP 403 to automated fetch.** Its description was recovered via the search index and **independently corroborated** by the Wikimedia Commons record for the same plate. Both give the same reading (Anubis leads *and* adjusts the plumb-weight; Thoth records; Horus conducts to Osiris; Isis and Nephthys flanking). Treated as **corroborated secondary quotation of a museum source**, not as a page I read. |
| [Wikimedia Commons — *The judgement of the dead in the presence of Osiris*](https://commons.wikimedia.org/wiki/File:The_judgement_of_the_dead_in_the_presence_of_Osiris.jpg) | Media repository carrying BM-derived description | Corroborates the above. ⚠ Contains one error of its own — calls Horus "Hunefer's son" (he is Osiris's son). Used only for the sequence of actions. |
| [Australian Museum — The underworld and afterlife in ancient Egypt](https://australian.museum/learn/cultures/international-collection/ancient-egyptian/the-underworld-and-the-afterlife-in-ancient-egypt/) | **Museum**, general audience | Osiris "chief judge"; Field of Reeds as destination distinct from the Duat journey. Thin — does not mention Anubis/Thoth/Horus at all. |
| [Kelsey Museum (Univ. of Michigan) — *Anubis in the Halls of Truth*](https://exhibitions.kelsey.lsa.umich.edu/jackal-gods-ancient-egypt/halls_truth.php) | **University museum** | **Not reached** — HTTP 403. Listed because it is the right next source for Anubis's judicial titles if this is revisited. |

### Secondary / consulted with caution

| Source | Nature | Verdict |
|---|---|---|
| [Wikipedia — *Book of Gates*](https://en.wikipedia.org/wiki/Book_of_Gates) | Crowd encyclopedia | Used **only** as a weak cross-check on gate sequence (§4.3) and for the Heka/Sia crew distinction. **Not seeded from.** Same publication whose *Assessors of Maat* table was found corrupt last round. |
| [Wikipedia — *The Contendings of Horus and Seth*](https://en.wikipedia.org/wiki/The_Contendings_of_Horus_and_Seth) | Crowd encyclopedia | Used for P. Chester Beatty I's date and the Ennead-under-Re-Horakhty framing. Uncontroversial and consistent with the standard account. |
| Hornung, *Das Buch von den Pforten des Jenseits* (1979) / *The Egyptian Book of Gates* (Hornung & Abt) | Academic, **in copyright** | **Not consulted.** This is the critical edition and the arbiter of the 11-vs-12 gate count (§4.2). Cited as the required next step, not quoted. |
| Herodotus II.86–88 on the seventy-day embalming | Ancient source, PD | Confirms 70 days (§7 item 19). |
| Various hobbyist/aggregator sites surfaced in search (worldhistory.org, historyandmyths.com, egyptmythology.com, ancientegyptonline, godsandmonsters, grokipedia) | Popular / AI-generated | **Not used as evidence.** Where their claims coincided with the primary editions the primary edition is cited instead. Grokipedia is machine-generated and was disregarded on sight. |

### Explicitly not established

- **The exact proper name of Book-of-Gates Gate 5** — unreadable in the
  available scan (§4.3). Not guessed.
- **Whether Hornung counts 11 or 12 gates** (§4.2). Not guessed.
- **The Amduat hour↔name alignment** in §4.5 — single rough OCR, no second
  witness. Explicitly marked non-seedable.
- **Any Chinese rendering (`name_zh`) for the gates or their guardians.** As
  with the assessors, there is no established Chinese form; inventing one would
  be fabrication.

---

## 9. Recommendations — **not implemented**

### 9.1 Do first, cheap and unambiguous (no new research needed)

Move four actors into `EG_HALL_TWO_TRUTHS` in `seed_mythology.py`:
`Horus` (also change `GUARDIAN` → `CONDUIT`), `Isis`, `Nephthys`, `Ra`,
and `Ammit`. Every one of these is settled by the Ani plates quoted in §2.1.
This also **resolves the two-seeder conflict in favour of
`populate_egyptian_actors.py`**, which should be recorded in that file's
docstring — it currently implies the opposite.

Fix Horus's description string: he escorts the vindicated deceased into Osiris's
presence. Delete "prosecutor in trials against Set" wherever it appears.

### 9.2 Roles — decide before touching

`ActorRole` has no term for "operates the instrument of judgment" (Anubis) or
"is the standard of judgment" (Ma'at). Three options, in order of preference:

1. **Leave the enum alone, fix the descriptions.** Cheapest, and the current
   description strings for Anubis and Thoth are already close to correct. Accept
   that `JUDGE` is being used loosely for "principal of the tribunal".
2. **Demote Ma'at to `CONDUIT` or a non-judicial role** and leave Anubis as
   `JUDGE`. Ma'at-as-juror is the more clearly wrong of the two.
3. **Add roles.** Not worth a migration for one civilization.

Whatever is chosen, note the count problem the assessor report already raised:
`EG_HALL_TWO_TRUTHS` would then hold **4 principals + 42 assessors + 4 relocated
= 50 actors**, of which 46 are `JUDGE`. Any UI rendering "judges of the Hall" as
a flat list needs the principals/bench distinction *before* this lands.

### 9.3 `EG_AM_TYAT` and `EG_DEVOURER`

- **`EG_AM_TYAT`: remove**, or replace with the seven ꜥrrwt of BD 144/147
  (§4.4) if the state machine needs a pre-judgment waypoint. Do not keep an
  unattested realm name in the seed.
- **`EG_DEVOURER`: re-frame as an outcome, not a residence** (§3.3 option (a)),
  and move `Ammit` out of it regardless.
- Both changes touch `disposition/services.py:71-73, 230-236`. Neither requires
  a migration.

### 9.4 The twelve gates

**Do not seed twelve rows from `docs/01` §2.2** — that table is invented.

If gates are wanted:

- **Preferred:** BD 144/147's **seven ꜥrrwt with 21 named guardians** (§4.4) —
  same corpus, same edition family, same citation policy as the 42 assessors,
  and it is about the deceased rather than the sun god. Source: Budge, *The Book
  of the Dead… Theban Recension*, vol. II — the volume already cited for the
  assessors' towns and clauses.
- **If the Book of Gates specifically:** use §4.3, resolve the 11-vs-12 count
  against Hornung first, leave Gate 5's proper name **empty rather than guessed**,
  store `source_edition` and `papyrus`/`witness` in `powers_json` exactly as the
  assessors do, and rename the org node `DUAT_GATES` (十二门) to name the book.
- **Either way**, leave `name_zh` blank and let `get_localized_name()` fall back,
  as decided for the assessors.

### 9.5 Documentation

`docs/02` and `docs/03` contain fabricated content (a vengeance goddess in the
Hall, a four-quarter taxonomy of the 42, a fake "Wisconsin papyrus" citation)
and an Anubis/Thoth role swap that directly contradicts the database. `docs/01`
§2.2's gate table is invented. **These three files are currently a *worse*
source of Egyptian fact than the seeder is**, which inverts the intended
relationship — `seed_mythology.py`'s statutes block explicitly treats the docs
as the authority for the Chinese and European corpora.

Also: the byte-identical duplicates under `埃及冥界/` mean every fix has to be
made twice. **Deduplicate before correcting**, or the two copies will diverge on
the first correction — the same "two hand-maintained copies" failure the
seeder's own comments warn about.
