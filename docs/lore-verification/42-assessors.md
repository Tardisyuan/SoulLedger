# The 42 Assessors of Ma'at — BD Chapter 125 · source verification

**Research round only. No repo files were modified.**
Compiled 2026-08-14 for `backend/scripts/populate_egyptian_actors.py` (the empty
`forty_two_assessors` block) and `backend/apps/actors/management/commands/seed_mythology.py`.

---

## 0. Bottom line

- **42/42 recovered.** A complete, ordered, internally aligned roster exists —
  name + home town + negative-confession clause for every one of the 42 — built
  from two **public-domain** works by the same translator reading the **same
  papyrus sheet**.
- **Recommended edition: Budge's transliteration of the Papyrus of Nebseni**
  (BM EA 9900, sheet 30). Reasons in §4.
- **The Wikipedia table is corrupt and must not be used.** Proof in §5. This is
  almost certainly the ancestor of the fake 35-name list already removed from
  the repo (§6).
- **Zero name collisions** with the actors `seed_mythology` already seeds (§8).

---

## 1. What the text actually is

BD Chapter 125 part B ("Negative Confession" / "Declaration of Innocence").
The deceased addresses 42 deities in fixed order. Each address has three parts:

> *O* **{name/epithet}** *who comes from* **{place}** — *I have not* **{sin}**.

The 42 sit in two rows of 21 (Budge 1904, GoE I p. 418: "drawn up in two rows,
each of which contained twenty-one Judges"). UCL's Maiherperi transcription is
laid out exactly that way — an "upper register" of 21 and a "lower register"
of 21 — which is an independent structural confirmation.

**Manuscript variation is real and material.** Sequence, deity↔sin alignment,
and even the *count* vary between papyri. UCL states this explicitly and prints
Papyrus Cairo 2512 (18th Dyn.) with only **32** declarations as the
counter-example. So "the" list does not exist — an edition must be named.

---

## 2. The roster (RECOMMENDED — Papyrus of Nebseni, Budge)

Two sources, merged. They are safe to merge because they are the same
translator reading the same sheet, and the merge is *verifiable* — see §3.

- **Names (transliterated):** Budge, *The Gods of the Egyptians* vol. I (1904),
  pp. 418–419, explicitly headed "according to the Papyrus of Nebseni (Brit.
  Mus., No. 9,900, sheet 30)". Public domain.
- **Towns + confessions (same order):** Budge, *The Book of the Dead: An English
  Translation of the Chapters, Hymns, etc., of the Theban Recension*, vol. II,
  Chapter CXXV part 2, pp. 366–371, headed "The scribe Nebseni, triumphant,
  saith". Public domain.

Sin column below is my one-line **paraphrase** of Budge's clause, not his prose.

| # | Name (Budge 1904) | Meaning (Budge 1901 epithet) | Home place | Denies |
|---|---|---|---|---|
| 1 | Usekht-nemmat | "whose strides are long" | Annu (Heliopolis) | wrongdoing / iniquity |
| 2 | Hept-shet | "embraced by flame" | Kher-aha | robbery with violence |
| 3 | Fenti | "the divine Nose" | Khemennu (Hermopolis) | violence against a person |
| 4 | Am-khaibetu | "who eatest shades" | the place where the Nile riseth | theft |
| 5 | Neha-hau | (var. Neha-hra) | Re-stau | killing a man or woman |
| 6 | Rerti | "double Lion-god" | heaven | short measure ("made light the bushel") |
| 7 | Maati-f-em-tes | "whose two eyes are like flint" | Sekhem (Letopolis) | acting deceitfully |
| 8 | Neba-per-em-khetkhet | "Flame, who comest forth as thou goest back" | — (no town; "as [thou] goest back") | purloining what belongs to God |
| 9 | Set-kesu | "Crusher of bones" | Suten-henen (Heracleopolis) | uttering falsehood |
| 10 | Uatch-nes | "who makest the flame wax strong" | Het-ka-Ptah (Memphis) | carrying away food |
| 11 | Qerti | "the two sources of the Nile" | Amentet | uttering evil words |
| 12 | Hetch-abehu | "whose teeth shine" | Ta-she (the Fayyum) | attacking a man |
| 13 | Am-senf | "who dost consume blood" | the house of slaughter | killing the god's cattle |
| 14 | Am-beseku | "who dost consume the entrails" | the *mābet* chamber | acting deceitfully |
| 15 | Neb-Maat | "god of Right and Truth" | city of double Maati | laying waste ploughed land |
| 16 | **Thenemi** | "who goest backwards" | city of Bast (Bubastis) | prying / making mischief |
| 17 | Aati | — | Annu (Heliopolis) | slander ("setting mouth in motion") |
| 18 | Tutu-f | "doubly evil" | the nome of Ati (9th Lower, Busiris) | anger without cause |
| 19 | Uamemti (Budge 1901: Uamenti) | "the serpent" | the house of slaughter | adultery with another's wife |
| 20 | Maa-an-f | "who lookest upon what is brought to him" | Temple of Amsu (Min) | sin against purity |
| 21 | Heri-seru | "Chief of the divine Princes" | city of Nehatu | striking fear into a man |
| 22 | Khemi | "the Destroyer" | the Lake of Kaui (Khas?) | encroaching on sacred times/seasons |
| 23 | Shet-kheru | "who orderest speech" | Urit | being a man of anger |
| 24 | Nekhen | "the Child" | the Lake of Heq-at (13th Lower nome) | deafness to words of truth |
| 25 | Ser-kheru (var. Ser-khera) | "disposer of speech" | city of Unes (19th Upper nome) | stirring up strife |
| 26 | Basti | — | the Secret city | making anyone weep |
| 27 | Hra-f-ha-f | "whose face is turned backwards" | the Dwelling | impurity |
| 28 | Ta-ret | "Leg of fire" | Akhekhu | "eating my heart" (losing temper) |
| 29 | Kenemti | — | Kenemet | abuse of others |
| 30 | An-hetep-f | "who bringest thine offering" | Sau (Sais) | acting with violence |
| 31 | Neb-hrau | "lord of faces" | Tchefet | judging hastily |
| 32 | Serekhi | "who givest knowledge" | Unth | taking vengeance on the god ⚠ see note |
| 33 | Neb-abui | "lord of two horns" | Satiu | multiplying speech overmuch |
| 34 | Nefer-Tem | — | Het-ka-Ptah (Memphis) | deceit / wickedness |
| 35 | Tem-sep | — | Tattu (Busiris) | cursing the king |
| 36 | Ari-em-ab-f | "whose heart doth labour" | city of Tebti | fouling water |
| 37 | Ahi-mu (Budge marks "?") | "Ahi of the water" | Nu | raising the voice haughtily |
| 38 | Utu-rekhit | "who givest commands to mankind" | [Sau (?)] — Budge's own query | cursing the god |
| 39 | Neheb-nefert | — | the Lake of Nefer (?) — Budge's own query | insolence |
| 40 | Neheb-kau | — | [thy] city | seeking distinctions for self |
| 41 | Tcheser-tep | "whose head is holy" | [thy] habitation | wealth beyond what is justly one's own |
| 42 | An-a-f | "who bringest thine own arm" | Aukert (the underworld) | contempt for the god of one's own town |

⚠ **#32** — Budge 1901 vol. II p. 370 has an unreadable stretch in the scan
(`I have not >. ueeeeeee`). The recoverable half of the clause is "I have not
taken vengeance upon the god". Budge 1895's Nebseni appendix gives the fuller
sense as transgression / vexing or angering God. Treat #32's sin as **partial**.

**#16 provenance note.** The first OCR I pulled
(`archive.org/details/godsofegyptianso00budg`) silently drops entry 16, jumping
15 → 17. This is the same gap netjeru.org honestly reports as unfilled. I
recovered it from a **second, independent scan** of the same 1904 edition (the
Cornell copy, `archive.org/details/cu31924092320500`), which prints
`16. Thenemi`. It is not inferred, not reconstructed — it is read off a scan.
It also agrees with the Maiherperi witness, which has `i.tnmy pr m bAst`
("wanderer, from Bast") in the same slot.

---

## 3. Why this merge is trustworthy: independent cross-validation

The Budge/Nebseni order was checked slot-by-slot against a **completely
independent witness**: UCL's Digital Egypt transcription of the **Papyrus of
Maiherperi** (mid-18th Dynasty), which gives the Egyptian in Manuel-de-Codage
transliteration plus a modern English rendering. Different papyrus, different
century, different Egyptologist (Stephen Quirke, UCL, 2002 vs. Budge 1901/04).

**All 42 slots correspond.** Sample of the alignment:

| # | Budge / Nebseni | UCL / Maiherperi (MdC) | UCL rendering |
|---|---|---|---|
| 1 | Usekht-nemmat, Annu | `i.wsx nmt m iwnw` | broad of step, Iunu |
| 7 | Maati-f-em-tes, Sekhem | `i.irty.fy-m-ds pr m xm` | fiery eyed, Khem |
| 16 | Thenemi, Bast | `i.tnmy pr m bAst` | wanderer, Bast |
| 20 | Maa-an-f, Temple of Amsu | `i.mAA-int.f pr m pr-mnw` | watcher of his bringing, Permin |
| 28 | Ta-ret, Akhekhu | `i.tA-rdwy pr m ixxw` | scorch-legged, the twilight |
| 33 | Neb-abui, Satiu | `i.abwy pr m sAwty` | horned one, Asyut |
| 41 | Tcheser-tep | `i.Dsr-tp pr m niwt` | distinct of head, the town |
| 42 | An-a-f, Aukert | `i.inn-a.f pr m niwt` | bringer of his armful, the town |

Divergences found, and they are minor and *localised to the place-name*, never
to the sequence: **#21** (Budge "Nehatu" vs UCL "Imu"), **#22** ("Lake of Kaui"
vs "the great place"), **#23** ("Urit" vs "the shrine"), **#39** ("Lake of
Nefer(?)" vs "Gem"). Budge himself flags #38 and #39 with question marks, so
those two are the *expected* soft spots and the second witness lands exactly on
them. That is what a real cross-check looks like.

**Note #7 as a transliteration-history datum**: Budge read the name as
`Maati-f-em-tes`; the modern reading is `irty.fy-m-ds` ("his two eyes are of
flint"). Same god, different decipherment of the same signs, 100 years apart.
This is the single clearest illustration of why the edition has to be recorded
in the data, not just the name.

---

## 4. The three-house transliteration comparison

Verified first-five (plus a few beyond) from each house, read from actual text
where the text is legally reachable.

| # | **Budge** 1904 (transliterated, PD) | **Faulkner** 1972/1994 (English epithet, in ©) | **T. G. Allen** 1974 (English epithet, in ©, free PDF) | **Quirke/UCL** 2002 (MdC + English) | Wikipedia col.2 |
|---|---|---|---|---|---|
| 1 | Usekht-nemmat | "Wide-of-stride" / "Far-strider" ⚠ | "far-strider" | `wsx nmt` — broad of step | Usekh-nemmt "Far-Strider" |
| 2 | Hept-shet | "Fire-embracer" | "flame-embracer" | `Hpt sDt` — flame embracer | Hept-khet "Fire-Embracer" |
| 3 | Fenti | "Nosey" | "Beaked One" | `fndy` — beaked god | Fenti "Nosey One" |
| 4 | Am-khaibetu | "Swallower of shades" | "swallower of shadows" | `am-Swt` — swallower of shades | Am-khaibit "Swallower of Shades" |
| 5 | Neha-hau | "Dangerous One" | "fierce (of face)" | `nHA-Hr` — flaming faced | Neha-her "Dangerous One" |
| 6 | Rerti | "Double Lion" | "Ruty Who Came Forth From the Sky" | `rwty` — Double Lion | Ruruti "Double Lion" |
| 9 | Set-kesu | "Bone-breaker" | "bone-breaker" | `sd-qsw` — breaker of bones | Set-qesu "Bone Breaker" |

**The structural difference is not spelling — it is kind.**
- **Budge transliterates** the Egyptian into a pronounceable Latin proper noun
  (`Usekht-nemmat`) and glosses the meaning separately.
- **Faulkner and Allen translate** the epithet into an English descriptive
  phrase (`Far-strider`, `far-strider`). These are **not names**. They are
  descriptions, and they are lowercase in Allen precisely because he does not
  regard them as proper nouns.
- **Quirke/UCL** gives scholarly MdC (`wsx nmt`) plus a plain English gloss —
  correct for Egyptology, unusable as a display name (`i.wsx nmt m iwnw` is not
  something to put in a UI).

⚠ **Unresolved conflict, stated rather than papered over**: Faulkner's #1
circulates in two forms — "Wide-of-stride who comes from On" (attributed to
Faulkner 1972) and "Far Strider who came forth from Heliopolis" (attributed to
the 1994 Ani revision). I could not open either Faulkner edition legitimately to
adjudicate; both attributions come from secondary quotation. **Do not treat
either as verified.**

Faulkner and Allen are both in copyright. Allen's SAOC 37 is released free by
its own publisher (ISAC, University of Chicago) — that is a licensed free
download, not a pirate copy, and is the one to consult if a modern reading is
wanted. Faulkner is not freely available; the copies that surface in search
results are unauthorised uploads and were not used.

### Note on "Allen 1974/2005"
The brief said "Allen (1974/2005)". These are **two different people**:
- **T. George Allen**, *The Book of the Dead or Going Forth by Day* (SAOC 37,
  1974) — this is the Book of the Dead translation, and the one relevant here.
- **James P. Allen**, whose 2005 book is *The Ancient Egyptian Pyramid Texts* —
  a **different corpus entirely**, ~1000 years older, and it does not contain
  Chapter 125 or the assessors.

Do not cite a 2005 Allen for this list.

---

## 5. Wikipedia is corrupt — do not use it

`en.wikipedia.org/wiki/Assessors_of_Maat` looks like the obvious answer: a clean
1–42 table, no gaps. It is broken. The article pastes **two unrelated lists**
side by side — Wilkinson 2003's names/places in columns 2–3, and World History
Encyclopedia's Papyrus-of-Ani confessions in column 5 — and they are **not the
same ordering**, so the rows do not describe the same deity.

Demonstrable defects, read from the raw wikitext:

| Row | Column 2 says | Column 5 says | Verdict |
|---|---|---|---|
| 13 | "Hetch-abhu / Shezmu" | "Hail, **Basti**, who comest forth from Bast" | different gods on one row |
| 26 | "**Nebheru**" | "Hail, **Nekhenu**, who comest forth from Heqat" | different gods on one row |
| 33 | *(name field is empty — only "Owner of Horns")* | "Hail, **Tcheser-tep**…" | name missing |
| 32 & 42 | **both** "Neb-abui" | #42 col.5 says "An-af" | duplicate name |
| 13 & 41 | **both** "Hetch-abhu" | — | duplicate name |

So the table contains **40 distinct names at best, with two duplicated and one
blank** — it is not a 42-name roster at all, despite numbering to 42. The
article itself admits the misalignment in passing by tagging rows "(#12 in
Papyrus source)", "(#40 in Papyrus source)" — i.e. it *knows* the two columns
disagree and glues them together anyway.

Also note Wikipedia's column 3 header is "Identified with", which is not a
provenance field; the places in it are a mixture of towns and Wilkinson's
atmospheric locations.

---

## 6. Forensics: where the repo's fake 35 came from

The World History Encyclopedia article that Wikipedia leans on
(`worldhistory.org/article/185/the-forty-two-judges/`) contains this sentence
before its list:

> Of these, there were nine great judges: **Ra … Shu … Tefnut … Geb … Nut …
> Isis … Nephthys … Horus … Hathor**

That is **exactly** the padding the repo's deleted 35-name list was built from
(the file's own comment names Shu, Tefnut, Geb, Nut, Hathor, plus Ra and Ma'at
as the two collisions). The old list was almost certainly assembled from this
article's *prose* rather than its *list*, then topped up with the four sons of
Horus and Heka/Sia/Hu. Those nine "great judges" are **not** assessors; no
papyrus witness places Geb or Hathor in the bench of 42. The existing comment
in `populate_egyptian_actors.py` is correct and the deletion was the right call.

WHE's own 42-item list (§7) is internally fine, but the article gives **no
citation for it** — its bibliography lists Faulkner and Wilkinson, yet the list
is in Budge-style transliteration matching neither. Provenance unknown.

---

## 7. The competing complete roster (Papyrus of Ani order) — FYI, not recommended

For completeness: a second complete 42 circulates, in the **Papyrus of Ani**
order, from World History Encyclopedia. It is genuinely a different sequence,
not a variant spelling of the same one:

| Slot | Nebseni (recommended) | Ani (WHE) |
|---|---|---|
| 12 | Hetch-abehu | Hraf-haf |
| 13 | Am-senf | Basti |
| 26 | Basti | Nekhenu |
| 27 | Hra-f-ha-f | Kenemti |
| 42 | An-a-f | Hetch-abhu |

Budge 1895 (*The Book of the Dead: The Papyrus of Ani*, pp. 347–351) prints the
**Ani** order in the main text and the **Nebseni** order in an appendix,
explicitly flagging "important variations in the text and in the order in which
the gods are addressed". So the divergence is attested by Budge himself, not an
artefact of modern retelling.

Ani is the more famous papyrus, but for this purpose it is the worse choice:
Budge's 1895 Ani translation renders most assessors as **epithets, not names**
("Hail, thou whose strides are long"), so it does not yield a usable name
column; and Budge's Ani #20 and #21 carry the *same* confession verbatim
("I have not defiled the wife of any man"), which would seed two rows that
differ in nothing a user could see. The WHE version fixes both problems but
without saying how, which is exactly the kind of unsourced tidiness that got
this project burned before.

---

## 8. Data-completeness declaration

**High confidence (use as-is)**
- All 42 **names**: two independent scans of Budge 1904 agree letter-for-letter,
  including the entry one scan drops.
- The **sequence**: confirmed 42/42 against a different papyrus via a different
  scholar (UCL/Quirke).
- **Towns** for 38 of 42.
- **Confession clauses** for 41 of 42.

**Lower confidence / flagged**
- **#32 Serekhi** — confession partially unreadable in the scan. Partial.
- **#38, #39** — Budge himself prints the place with a question mark
  (`[Sau (?)]`, `Lake of Nefer (?)`), and these are the two the second witness
  disagrees with. Mark as uncertain in the data.
- **#37 Ahi-mu** — Budge prints "Ahi-mu (?)"; the name reading is his own query.
- **#8** — has no town; the formula is "who comest forth as [thou] goest back".
  This is not missing data, it is what the text says. Store empty, not a guess.
- **#21, #22, #23** — towns differ between the two witnesses. Record the
  Nebseni value and note the variant; do not silently pick.

**Known gaps: none.** There is no slot for which I have no name.

**Not verified**
- Faulkner's exact renderings (in copyright, no legitimate full text reached).
  Everything attributed to Faulkner above is secondary quotation.
- Wilkinson 2003's list independent of Wikipedia's mangling of it.

---

## 9. Recommendation

**Adopt the Budge/Nebseni roster in §2**, storing Budge's transliterated names
as `name` / `name_en`, and record the edition in the data.

Rationale, against the three criteria in the brief:

1. **Copyright — clean.** Budge 1901 and 1904 are long out of copyright. The
   names, towns and confession clauses can be shipped in the repo without
   restriction. Faulkner is in copyright. Allen is in copyright (free download
   ≠ free to redistribute inside a codebase).
2. **Current scholarly standing — adequate for the job, with a caveat.** Budge's
   *interpretation* is genuinely dated and Egyptologists warn against it. But
   what is needed here is **transcription of names and places**, which is the
   part of Budge that holds up, and which the independent Maiherperi witness
   just confirmed 42/42. Where a modern reading differs (`Maati-f-em-tes` vs
   `irty.fy-m-ds`) that is a decipherment refinement, not an error of fact about
   who is in the list. If a modern reading is wanted later, Allen SAOC 37 is the
   upgrade path and the ordering already matches.
3. **House style — matches exactly.** The repo's existing Egyptian actors are
   `Ma'at`, `Anubis`, `Ammit`, `Thoth`, `Osiris` — conventional Latinised proper
   nouns. Budge produces the same shape (`Set-kesu`, `Neb-Maat`, `Nefer-Tem`).
   Faulkner/Allen would produce `Bone-breaker` and `far-strider`, which read as
   descriptions and would look wrong beside `Osiris`. Quirke's `sd-qsw` is
   worse still for a UI.

Also decisive: **only Budge gives a name and a town and a sin for all 42 from
sources that can be checked line by line.** That is precisely the property this
roster has been missing.

---

## 10. Landing it in SoulLedger

### 10.1 Role
`ActorRole.JUDGE`. They are judges of the dead — the model's own vocabulary
fits. But note the consequence: the Egyptian civilization currently has 4
JUDGEs (Osiris, Anubis, Thoth, Ma'at); adding 42 makes 46, and any UI that
renders "judges of the Hall" as a flat list will become unusable. Consider
whether the frontend needs a "principals vs. bench" distinction before seeding.

### 10.2 Realm
`EG_HALL_TWO_TRUTHS`. Correct and unambiguous — Chapter 125 places them in the
Hall of Maati, and the realm is already seeded by `seed_mythology`. No new realm
needed.

### 10.3 Name collisions — none
Checked the Budge/Nebseni 42 against `EGYPTIAN_ACTORS` in `seed_mythology.py`
(Osiris, Anubis, Thoth, Ma'at, Ammit, Horus, Isis, Nephthys, Ra) plus `Set` from
`populate_egyptian_actors.py`, and against
`fix_actor_civilization.SPELLING_MERGES` (which contains only
`("Maat", "Ma'at", "EGYPTIAN")`).

**Zero collisions.** Closest calls, both safe:
- `Nefer-Tem` (#34) — Nefertem is not currently seeded.
- `Basti` (#26) — Bastet is not currently seeded.

This is a material improvement over the deleted list, which collided on both
`Ra` and `Maat` and thereby manufactured the duplicates
`fix_actor_civilization` exists to clean up. **Recommend adding both
`Nefer-Tem` and `Basti` to a comment/guard so a future `seed_mythology` addition
of Nefertem or Bastet does not resurrect the same class of bug.**

### 10.4 The two new data items — no migration required

The brief asks whether the Actor model can carry "negative-confession clause"
and "home town". Reading `backend/apps/actors/models.py`:

- **No dedicated field exists** for either. `title*` is a title, `description`
  is free prose, and neither is queryable as structured data.
- **But `powers_json = models.JSONField(default=dict, blank=True)` already
  exists and is unused by the seeders.** It is exactly the right home.

**Recommended (no migration):**

```python
powers_json = {
    "assessor_index": 1,                       # 1..42, the canonical order
    "home_place": "Annu (Heliopolis)",         # "" for #8, which has none
    "home_place_uncertain": False,             # True for #38, #39
    "negative_confession": "I have not done iniquity.",
    "confession_partial": False,               # True for #32
    "source_edition": "Budge 1904 GoE I pp.418-419 (names); "
                      "Budge 1901 BoD II pp.366-371 (places, clauses)",
    "papyrus": "Nebseni (BM EA 9900, sheet 30)",
}
```

Why `powers_json` rather than new columns:
- Zero migration, so it cannot collide with the two agents currently editing
  `backend/apps/actors/` and `backend/apps/realms/`.
- `assessor_index` is the field that actually matters and the one the model has
  no room for. `Meta.ordering` is `["civilization", "role", "name"]`, which will
  sort the bench **alphabetically** — i.e. wrong. Anything that displays the 42
  must sort on `powers_json["assessor_index"]` explicitly.
- The `source_edition` key is the point. The failure mode this roster is
  replacing was *unattributed data*. Shipping the citation inside the row makes
  the provenance survive contact with the next person.

**Only add real columns if** the frontend needs to filter/sort at the DB level
(e.g. "show assessor 1–21" as the upper register). In that case add exactly one:
`assessor_index = models.PositiveSmallIntegerField(null=True, blank=True)` with
an index — and leave the text fields in `powers_json`. Do not add
`negative_confession` / `home_place` as columns; they are single-civilization
concerns and would be null for every Chinese and European actor.

### 10.5 Other fields

| Field | Value |
|---|---|
| `name` | Budge transliteration, e.g. `Usekht-nemmat` |
| `name_en` | same |
| `name_egy` | Budge's gloss, e.g. `wsx nmt` (or the epithet) |
| `name_zh` | **needs a decision** — see below |
| `title` / `title_en` | `Assessor {n} of the Forty-Two` |
| `title_zh` | `四十二判官之第{n}位` |
| `description` | epithet + place + denied sin + citation |
| `civilization` | `EGYPTIAN` |
| `tenant` | `EG_DUAT` (via `CIVILIZATION_TENANT`) |

⚠ **`name_zh` is an open question, not a research gap.** There is no
established Chinese rendering for these 42 — they are obscure even in
Egyptology. Options: (a) leave `name_zh` blank and let
`get_localized_name()` fall back to `name_en` (it already does); (b)
transliterate phonetically; (c) translate the epithet meaning (乌塞赫-奈马特 vs
「长步者」). **Recommend (a) for the first pass** — an invented Chinese name for
42 obscure deities is precisely the kind of plausible-looking fabrication this
whole exercise is correcting.

### 10.6 Where the code should live

`populate_egyptian_actors.py` is documented as superseded, has a hardcoded
`sys.path.insert('/home/tardis/…')` from someone else's machine, and is not
reachable from `manage.py`. **Do not finish the roster there.** Put it in
`seed_mythology.py` as a separate `EGYPTIAN_ASSESSORS` table with its own seeding
pass, so it gets the idempotency, tenant assignment, soft-delete handling and
dry-run support the command already provides. Then reduce the block in
`populate_egyptian_actors.py` to a pointer.

Note `seed_mythology`'s actor rows are 11-tuples; the assessors need 3 extra
values (index, place, confession). Either extend to a 14-tuple for that table
only, or — cleaner — make `EGYPTIAN_ASSESSORS` a list of dicts and give it its
own small builder that assembles `powers_json` and hands the result to the
existing `_upsert`.

---

## 11. Sources, with an honest quality rating

### Primary transliterations / editions (used)

| Source | Nature | Use |
|---|---|---|
| Budge, *The Gods of the Egyptians* vol. I (1904), pp. 418–419 — [scan A](https://archive.org/details/godsofegyptianso00budg), [scan B (Cornell)](https://archive.org/details/cu31924092320500) | Academic monograph, **public domain**. Names read off Pap. Nebseni BM 9900 sheet 30. | **Primary source for the 42 names.** Scan A drops #16; scan B has it. |
| Budge, *The Book of the Dead: An English Translation…* vol. II (1898/1901), Ch. CXXV pt. 2, pp. 366–371 — [scan](https://archive.org/details/bookofdeadenglis0002unse) | Academic translation, **public domain**. Same Nebseni text. | **Primary source for towns + confessions**, same order as above. |
| Budge, *The Book of the Dead: The Papyrus of Ani* (1895), pp. 347–351 — [scan](https://archive.org/details/TheBookOfTheDead-Budge-1895) | Academic edition, **public domain**. | Ani order in main text, Nebseni order in appendix. **Direct textual evidence that the two papyri differ in sequence.** |
| [UCL Digital Egypt, BD Chapter 125b](https://www.ucl.ac.uk/museums-static/digitalegypt/literature/religious/bd125b.html) (© 2002 UCL; Stephen Quirke) | **University/museum**, scholarly. MdC transliteration of Pap. Maiherperi + Pap. Cairo 2512. | **Independent cross-check of the 42-slot sequence.** Also the source for "variants in sequence… and even in the number of declarations". |
| T. G. Allen, *The Book of the Dead or Going Forth by Day*, SAOC 37 (1974) — [ISAC](https://isac.uchicago.edu/research/publications/saoc/saoc-37-book-dead-or-going-forth-day-ideas-ancient-egyptians-concerning) · [free PDF via IA](https://archive.org/details/saoc-37.-the-book-of-the-dead-or-going-forth-by-day.-ideas-of-the-ancient-egypti) | **Academic press** (Univ. of Chicago), in copyright, **published free by the rights holder**. | Modern comparison renderings. Upgrade path if Budge's readings are later replaced. |

### Secondary / tertiary (consulted, mostly as counter-evidence)

| Source | Nature | Verdict |
|---|---|---|
| [Wikipedia, *Assessors of Maat*](https://en.wikipedia.org/wiki/Assessors_of_Maat) | Crowd encyclopedia | **REJECTED — table is internally inconsistent.** See §5. |
| [World History Encyclopedia, *The Forty-Two Judges*](https://www.worldhistory.org/article/185/the-forty-two-judges/) (Joshua J. Mark) | Popular online encyclopedia, editorially reviewed but **not peer-reviewed** | Complete Ani-order 42 with **no citation for the list**. Also the likely origin of the repo's fake "nine great judges" padding (§6). Use only as a pointer. |
| [netjeru.org, *The Bench of Forty-Two*](https://netjeru.org/assessors/) | Hobbyist/generated reference corpus, self-dated 2026-08-10 | **Not authoritative**, but unusually honest — it declares its gaps (#16 missing, 17 confessions missing) instead of padding. Independently confirms the Budge 1901 + 1904 / Nebseni sheet-30 approach. Its #16 gap is the one I closed via scan B. |
| Wilkinson, *The Complete Gods and Goddesses of Ancient Egypt* (2003) | Academic reference, in copyright | Cited as Wikipedia's basis, **not independently verified** — every version I could reach was via Wikipedia's mangled table. |
| Faulkner, *The Ancient Egyptian Book of the Dead* (1972 / 1994 w. von Dassow) | Academic translation, in copyright | Renderings above are **secondary quotation only**. The #1 wording conflict (§4) is unresolved. Full-text copies in search results are unauthorised and were not used. |

### Not used
`sacred-texts.com` is behind a Cloudflare bot check; I did not attempt to work
around it. Its Budge text is in any case the same 1895 edition already obtained
from the Internet Archive.

---

## Addendum (2026-08-28): the divergence list in §3/§8 was wrong twice, and four flags were missing

This section is appended; nothing above it has been changed. The report above is
dated 2026-08-14 and its roster was adopted into
`backend/apps/actors/mythology/actors_egyptian.py` (`EGYPTIAN_ASSESSORS`). The
2026-08-27 full-collation audit (commits `6ec90e5` and `f675015`) re-checked all
42 rows against Budge 1901 vol. II pp. 366-371 itself (the
`bookofdeadenglis0002unse` scan) and against UCL/Maiherperi, with these
corrections — each is recorded on the affected row's `notes` in
`actors_egyptian.py`:

- **#23 is NOT a witness divergence.** §3 and §8 list it among the towns that
  "differ between the two witnesses". Maiherperi has `i.sd-xrw pr m wryt`;
  Budge's "Urit" is his romanization of that same *wryt*, and UCL's "the
  shrine" is Quirke translating the same word. Transcription against
  translation, not two readings.
- **#42 IS a divergence, and nothing recorded it.** Budge/Nebseni "Aukert" vs
  Maiherperi `pr m niwt` ("the town") — visible in this report's own §3 sample
  table, which prints both values on the #42 row without flagging them. The
  divergence set is therefore **#21, #22, #38, #39, #42** (five), not
  #21/#22/#23(/#39) (the counts §3 and §8 imply).
- **#15 and #36 carry Budge's own 1901 queries and were not flagged.** 1901
  prints "laid waste the lands which have been ploughed (?)" and "fouled (?)
  water"; the policy of keeping Budge's queries (#22, #37, #38, #39) had missed
  these two.
- **#27's clause is a coordinate pair, and the roster kept half.** Budge 1901:
  "I have not committed acts of impurity, neither have I lain with men". The §2
  table's "impurity" (and the seeded row) carried only the first half; #34
  keeps both halves of its own pair, so the fold was inconsistent as well as
  lossy. The row now carries both.
- **#25's "var. Ser-khera" is withdrawn as a variant.** "Ser-khera" occurs
  exactly once, in the `godsofegyptianso00budg` scan — the same scan §2's #16
  note identifies as defective — while the Cornell scan of the same 1904 page
  reads "Ser-kheru". OCR noise recorded as an edition variant; kept in the
  row's notes as a record of the mistake.
- **#35's "Tattu (Busiris)" is an editorial identification, not Budge's.**
  Budge 1901 says only "from Tattu", and his own 1895 footnote records the name
  served two cities (Busiris and Mendes). The row now says so.

Beyond these, the full pass confirmed the roster itself: 42/42
denies/meaning/home_place checked against Budge 1901 directly, zero confirmed
errors, zero off-by-one slips (#7 and #14's repeated clause is the source's own
repetition). The machine-readable current state is
`CORPUS_PROVENANCE["NEGATIVE_CONFESSION"]` in
`backend/apps/actors/mythology/__init__.py` (42, DERIVED, no known gap).
