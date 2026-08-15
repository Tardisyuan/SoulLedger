"""The Egyptian cast: the nine principals of the Hall, and the bench of 42.

Both tables live in one module because they are one scene — see the comment
below, which is the reason they were relocated into the same realm in the
first place. The tuple columns for ``EGYPTIAN_ACTORS`` are the ones
documented at the top of ``actors_chinese.py``; the assessors are dicts, for
the reason their own header gives.

Moved verbatim out of ``seed_mythology.py``.

Cross-references in the comments below ("above", "below", "this file") were
written when every table in this package was one module; see the package
docstring in ``apps/actors/mythology/__init__.py``. Every table they name is
importable from that package.
"""
from apps.actors.models import ActorRole

# THE WEIGHING IS ONE SCENE AND EVERYONE IN IT IS IN THE SAME ROOM.
#
# Six of these nine used to be somewhere else. Budge's Papyrus of Ani plates III
# and IV, and the British Museum's Hunefer papyrus (BM EA 9901/3), draw the same
# procedure with the same cast in one hall: Anubis works the balance, Thoth
# stands behind him with pen and palette and records, Ammit waits beside the
# scales, the Ennead ratifies, Horus takes the vindicated by the hand and leads
# him forward, and Osiris receives him enthroned with Isis and Nephthys behind
# him. Nobody in that scene is in the Field of Reeds — that is where the
# acquitted go afterwards — and nobody is stationed at the gate of the Duat.
#
# ROLES: THE ENUM DOES NOT HAVE THE WORDS THIS SCENE NEEDS. There is no role
# meaning "works the instrument of judgment" (Anubis) or "is the standard by
# which it is judged" (Ma'at). Rather than add enum values for one civilization,
# JUDGE is left to mean "principal of the tribunal" and the descriptions carry
# what each one actually does. The one demotion made is Ma'at's, because
# Ma'at-as-juror is the clearly wrong one: her feather is the counterweight in
# the pan, so she is not on the bench, she is the test.
#
# HEADCOUNT WARNING: with the four relocations below, EG_HALL_TWO_TRUTHS holds
# nine principals plus the forty-two assessors. Any UI that renders "judges of
# the Hall" as one flat list needs the principals/bench distinction first —
# `powers_json["assessor_index"]` is the discriminator, and it is present on
# exactly the forty-two.
EGYPTIAN_ACTORS = [
    ("Osiris", "奥西里斯", "Osiris", "Wsir", ActorRole.JUDGE, "EG_HALL_TWO_TRUTHS",
     "冥王奥西里斯", "冥王奥西里斯", "Osiris - Lord of the Duat", "Wsir",
     "God of the dead and resurrection - presides over the Hall of Two Truths, "
     "enthroned in his shrine, and receives the vindicated dead (Budge, Papyrus "
     "of Ani, Plate IV; BD 125A in the Papyrus of Nu, BM EA 10477)"),
    ("Anubis", "阿努比斯", "Anubis", "Inpw", ActorRole.JUDGE, "EG_HALL_TWO_TRUTHS",
     "掌秤者阿努比斯", "掌秤者阿努比斯", "Anubis - Keeper of the Scales", "Inpw",
     "Jackal-headed god - WORKS THE BALANCE. He tests the tongue of the scales "
     "and adjusts the plummet; the inscription over him in the Papyrus of Ani "
     "reads 'O weigher of righteousness, guide the balance that it may be "
     "stablished', and BD 30B calls him 'him who keepeth the scales'. He "
     "decides nothing - the role JUDGE here means principal of the tribunal, "
     "because ActorRole has no term for the one who operates the instrument"),
    ("Thoth", "托特", "Thoth", "Djehuty", ActorRole.JUDGE, "EG_HALL_TWO_TRUTHS",
     "书记之神托特", "书记之神托特", "Thoth - Scribe of the Tribunal", "Djehuty",
     "Ibis-headed god - THE REGISTRAR. He stands behind Anubis with reed-pen "
     "and palette, records the result of the weighing, and reads the finding to "
     "the assembled gods ('Hear ye this judgment...'); the Papyrus of Nebseni "
     "labels the ape on the beam 'Thoth, lord of the scales'. He reports the "
     "verdict; he does not pronounce it"),
    # Ma'at is the only demotion in this block. She was a JUDGE, which puts the
    # standard of measurement on the bench that applies it; in BM EA 9901 she
    # sits on the beam of the balance and her feather goes into the pan.
    # GUARDIAN is the least wrong of the five available roles — none of them
    # means "the criterion" — and the description is where the actual fact
    # lives. If ActorRole ever grows a non-agent value, this row is the reason.
    ("Ma'at", "玛特", "Ma'at", "Maat", ActorRole.GUARDIAN, "EG_HALL_TWO_TRUTHS",
     "真理与正义女神玛特", "真理与正义女神玛特", "Ma'at - The Standard of the Weighing", "Maat",
     "Daughter of Ra - SHE IS THE STANDARD, NOT A JUDGE. Her feather is the "
     "counterweight the heart is weighed against, and she sits on the beam of "
     "the balance (BM EA 9901). The hall is named for her: wsxt nt mAaty, the "
     "broad hall of the Two Goddesses of What is Right, a dual. Cast GUARDIAN "
     "because ActorRole has no value meaning 'the criterion'; she was cast "
     "JUDGE, which seated the measure among the people applying it"),
    ("Ammit", "阿米特", "Ammit (The Devourer)", "Ammut", ActorRole.EXECUTOR,
     "EG_HALL_TWO_TRUTHS",
     "吞噬者阿米特", "吞噬者阿米特", "Ammit - The Devourer", "Ammut",
     "The Devourer - fore-part a crocodile, hind quarters a hippopotamus, "
     "middle a lion. She waits AT THE BALANCE in the Hall, which is where every "
     "standard vignette draws her (Budge, Papyrus of Ani, Plate III; BM EA "
     "9901), and acts only if the heart fails. She was seeded into a realm "
     "named after her, which made annihilation look like an address she lived "
     "at; see EG_ANNIHILATION above"),
    # Horus was the worst-placed row in the file: GUARDIAN at the gate of the
    # Duat, a post the sources do not give him, and the deleted
    # populate_egyptian_actors had him as a JUDGE instead. He is neither. In
    # both the Ani and the Hunefer papyri, Horus son of Isis takes the
    # vindicated dead by the hand after the weighing and walks him to Osiris'
    # shrine. That is escort duty, and CONDUIT is the role for it.
    ("Horus", "荷鲁斯", "Horus", "Hor", ActorRole.CONDUIT, "EG_HALL_TWO_TRUTHS",
     "引导者荷鲁斯", "引导者荷鲁斯", "Horus - Who Leads the Vindicated Forward", "Hor",
     "Falcon-headed Horus son of Isis - takes the vindicated dead by the hand "
     "after the weighing and leads him forward to Osiris, lord of eternity "
     "(Budge, Papyrus of Ani, Plate IV; BM EA 9901/3, the Hunefer papyrus). He "
     "is not a gatekeeper of the Duat and he is not a prosecutor - the "
     "prosecution story belongs to the Contendings of Horus and Seth (Papyrus "
     "Chester Beatty I), a different text about a dispute among the living gods"),
    ("Isis", "伊西斯", "Isis", "Aset", ActorRole.CONDUIT, "EG_HALL_TWO_TRUTHS",
     "生命女神伊西斯", "生命女神伊西斯", "Isis - Goddess of Life and Magic", "Aset",
     "Great mother goddess - stands behind Osiris' throne in the Hall with "
     "Nephthys as he receives the dead (Budge, Papyrus of Ani, Plate IV). She "
     "was seeded into the Field of Reeds, which is where the acquitted go after "
     "the judgment she attends"),
    ("Nephthys", "奈芙蒂斯", "Nephthys", "NebetHet", ActorRole.CONDUIT, "EG_HALL_TWO_TRUTHS",
     "丧葬女神奈芙蒂斯", "丧葬女神奈芙蒂斯", "Nephthys - Goddess of Mourning", "NebetHet",
     "Protects the dead - stands with Isis behind Osiris' throne in the Hall "
     "(Budge, Papyrus of Ani, Plate IV). Same relocation and same reason as Isis"),
    ("Ra", "拉", "Ra (Atum)", "Re", ActorRole.OVERSEER, "EG_HALL_TWO_TRUTHS",
     "太阳神拉", "太阳神拉", "Ra - Sun God and Creator", "Re",
     "Supreme sun god - heads the row of twelve enthroned gods above the "
     "weighing scene as Harmachis, 'the great god within his boat' (Budge, "
     "Papyrus of Ani, Plate III). Aaru is not his domain, which is where this "
     "row used to be; his other netherworld office is the nightly voyage of the "
     "solar barque in the Amduat and the Book of Gates"),
]

# --------------------------------------------------------------------------
# OTHER RENDERINGS OF THESE NAMES THAT THIS REPOSITORY ACTUALLY USES.
#
# `Actor.name` -> the other written forms that denote the same being.
#
# WHY THIS TABLE EXISTS. `apps/workflow/services.py`'s 「欧西里斯称重流程」 names
# its final node 「欧西里斯 · 终审」, and this file spells the same god 「奥西里斯」.
# One Wsir, two Chinese renderings, one in each of two files, and until now
# nothing in the database said they were the same god. `workflow/0011` still
# resolved that node to the Osiris row — but only because its own frozen table
# happens to carry the actor key `"Osiris"`, and its docstring said outright
# that the pairing was an inference from the template's title rather than
# something recorded anywhere. The owner's decision was to keep both renderings
# and record the correspondence, so that is what this is: the correspondence,
# as data, on the row it belongs to.
#
# WHY NOT A FIFTH NAME COLUMN. `Actor` has four, and none of them is the shape
# this needs:
#
#   * `name` is the identity key — it is half of the (tenant, civilization,
#     name) unique constraint — and *which language it is in varies by
#     civilization*: the Chinese kings' `name` is Chinese (秦广王), the Egyptian
#     gods' is English (Osiris). It is not a language slot at all.
#   * `name_zh` / `name_en` / `name_egy` hold exactly one canonical rendering
#     per language, and they are in `ACTOR_FIELDS`, so `--update` treats a change
#     to one as a changed row. They answer "what do we display in locale L",
#     which is a different question from "what other strings mean this being".
#
# A fifth column would have to be `name_zh_alt`, and that is wrong twice over:
# it assumes there is exactly one variant, and it assumes the variant is
# Chinese — but `Heru` below is a variant of `name_egy` and `Maat` of `name_en`.
# The shape wanted is a *set* of strings per row, so it goes in `powers_json`,
# which is already where this package puts per-actor structure that Actor has no
# column for (the assessors' `assessor_index`, `home_place` and
# `negative_confession` are all there, and none of those is a "power" either).
#
# It also has to be a column that exists in the *historical* Actor model at
# `workflow/0011`'s dependency point, because that migration's `_find_actor`
# reads this data and a frozen, possibly-already-applied migration must not gain
# a new dependency. `powers_json` has been on the model since `actors/0001`.
#
# WHAT GOES IN AND WHAT DOES NOT. An entry here asserts *one being, two written
# forms*. It is not a place to reconcile disagreements about who someone is:
#
#   * `Set` / `Seth` — `scripts/populate_egyptian_actors.py` seeds a Set with
#     `name_egy='Seth'` (a Greek form in an Egyptian-name field, recorded in
#     docs/lore-verification/verify-egyptian.md §row 10). No `Set` row exists in
#     this cast at all, so there is nothing to alias; whether Set belongs in the
#     judgment of the dead is a canon question, and that script already records
#     it as an open item.
#   * `Ra` / `Atum` — `name_en` is "Ra (Atum)". Atum is a distinct god who is
#     *identified with* Ra in some contexts, which is a theological claim and
#     not a spelling. Recording it as an alias would assert the identification.
#   * `Ma'at` / `Maat` — already recorded, in a column: `name_egy` is "Maat", and
#     `fix_actor_civilization.SPELLING_MERGES` merges a stray `Maat` row into
#     `Ma'at`. Nothing to add.
#
# Every entry below names the file that uses the other spelling, so an alias
# whose only user disappears can be removed on evidence.
EGYPTIAN_ACTOR_ALIASES = {
    # 「欧」 vs 「奥」 for Wsir. The 「欧西里斯」 spelling is what
    # apps/workflow/services.py's HEART_WEIGHING template calls both itself and
    # its final node; `name_zh` here is 「奥西里斯」. Both are current, standard
    # Chinese renderings of the same god and the owner kept both.
    "Osiris": ["欧西里斯"],
    # ḥr transliterated two ways. `name_egy` here is "Hor";
    # scripts/populate_egyptian_actors.py writes "Heru" for the same god, which
    # docs/lore-verification/verify-egyptian.md records as a known low-severity
    # inconsistency between the two seed paths rather than a second deity.
    "Horus": ["Heru"],
}

# --------------------------------------------------------------------------
# The Forty-Two Assessors of Ma'at — Book of the Dead, Chapter 125 part B
# ("the Declaration of Innocence" / "negative confession").
#
# WHY THESE ROWS ARE DICTS AND NOT 11-TUPLES. Every other actor here is fully
# described by the eleven columns above. An assessor is not: the text gives each
# one a fixed *position* in the bench, a home town, and one clause of the
# confession, and none of the three has a column on Actor. They go into
# `powers_json` (a JSONField that already exists and that no seeder had used, so
# this table needs no migration).
#
# `assessor_index` is the load-bearing one. `Actor.Meta.ordering` is
# ["civilization", "role", "name"], which sorts the bench *alphabetically* —
# i.e. wrong, and wrong in a way that looks fine. Anything that displays the 42
# must order on powers_json["assessor_index"] explicitly.
#
# EDITION. Budge's transliteration of the Papyrus of Nebseni (BM EA 9900, sheet
# 30). Names from The Gods of the Egyptians vol. I (1904) pp. 418-419; home
# places and confession clauses from The Book of the Dead: ... the Theban
# Recension vol. II (1901) ch. CXXV pt. 2, pp. 366-371. Both public domain, same
# translator reading the same sheet, so the merge is one edition and not a
# splice of two. The 42-slot sequence was cross-checked slot by slot against an
# independent witness — UCL Digital Egypt's transcription of the Papyrus of
# Maiherperi (Quirke, 2002) — and all 42 correspond.
#
# The edition has to be recorded in the data, not just chosen, because the
# manuscripts genuinely differ: the Papyrus of Ani puts the same gods in a
# different order (Budge 1895 prints Ani in the main text and Nebseni in an
# appendix, flagging the divergence himself), and Papyrus Cairo 2512 has only 32
# declarations. There is no "the" list. Hence `source_edition` and `papyrus` on
# every row.
#
# NOT-FABRICATED, DELIBERATELY. Where the source is uncertain the uncertainty is
# carried into the row as `source_notes` rather than smoothed over: #8 has no
# home town (that is what the text says, so the field is empty, not guessed),
# #32's clause is partly unreadable in the scan, #37's name reading is Budge's
# own query, #38 and #39 carry Budge's own question marks on the place, and
# #21/#22/#23 are the three places where the second witness disagrees. This
# table replaced a 33-name list of major deities (Shu, Geb, Nut, Hathor, the
# four sons of Horus...) that was assembled from a "nine great judges" sentence
# in an encyclopedia article and was not a roster of assessors at all — see
# backend/scripts/populate_egyptian_actors.py.
#
# `name_zh` is left blank on all 42. These have no established Chinese
# rendering; `get_localized_name()` already falls back to `name_en`. Inventing
# Chinese names for forty-two obscure deities is the exact failure this table
# exists to correct.
#
# COLLISION GUARD. None of the 42 collides with a seeded Egyptian actor
# (Osiris, Anubis, Thoth, Ma'at, Ammit, Horus, Isis, Nephthys, Ra, or Set from
# the script). The two near misses are #34 `Nefer-Tem` and #26 `Basti`: neither
# Nefertem nor Bastet is currently seeded as a major deity, and if one ever is,
# it must NOT be spelled `Nefer-Tem` or `Basti` or it will merge into an
# assessor row. tests/test_seed_mythology.py pins both names.
# --------------------------------------------------------------------------
ASSESSOR_REALM_CODE = "EG_HALL_TWO_TRUTHS"
ASSESSOR_PAPYRUS = "Nebseni (BM EA 9900, sheet 30)"
ASSESSOR_SOURCE_EDITION = (
    "Budge 1904, The Gods of the Egyptians I, pp. 418-419 (names); "
    "Budge 1901, The Book of the Dead: ... the Theban Recension II, "
    "ch. CXXV pt. 2, pp. 366-371 (home places, confession clauses). "
    "Public domain. Sequence cross-checked against UCL Digital Egypt's "
    "Papyrus of Maiherperi transcription (Quirke 2002), 42/42. "
    "negative_confession is a one-line paraphrase of Budge's clause, not his prose."
)

# Per-row keys: index, name, meaning (Budge's epithet gloss; "" where he gives
# none), home_place ("" only for #8, which has none in the text), denies
# (paraphrase of the confession clause), notes (verbatim source caveats).
EGYPTIAN_ASSESSORS = [
    {"index": 1, "name": "Usekht-nemmat", "meaning": "whose strides are long",
     "home_place": "Annu (Heliopolis)", "denies": "wrongdoing / iniquity"},
    {"index": 2, "name": "Hept-shet", "meaning": "embraced by flame",
     "home_place": "Kher-aha", "denies": "robbery with violence"},
    {"index": 3, "name": "Fenti", "meaning": "the divine Nose",
     "home_place": "Khemennu (Hermopolis)", "denies": "violence against a person"},
    {"index": 4, "name": "Am-khaibetu", "meaning": "who eatest shades",
     "home_place": "the place where the Nile riseth", "denies": "theft"},
    {"index": 5, "name": "Neha-hau", "meaning": "",
     "home_place": "Re-stau", "denies": "killing a man or a woman",
     "notes": ["Budge also prints the name as 'Neha-hra'; both readings are his."]},
    {"index": 6, "name": "Rerti", "meaning": "double Lion-god",
     "home_place": "heaven", "denies": "short measure (\"made light the bushel\")"},
    {"index": 7, "name": "Maati-f-em-tes", "meaning": "whose two eyes are like flint",
     "home_place": "Sekhem (Letopolis)", "denies": "acting deceitfully",
     "notes": ["Budge's reading. The modern reading of the same signs is "
               "'irty.fy-m-ds' ('his two eyes are of flint') — a decipherment "
               "refinement a century later, not a different god."]},
    {"index": 8, "name": "Neba-per-em-khetkhet",
     "meaning": "Flame, who comest forth as thou goest back",
     "home_place": "", "denies": "purloining what belongs to God",
     "notes": ["No home place: the formula here is 'who comest forth as [thou] "
               "goest back' rather than a town. Stored empty because that is "
               "what the text says, not because the datum is missing."]},
    {"index": 9, "name": "Set-kesu", "meaning": "Crusher of bones",
     "home_place": "Suten-henen (Heracleopolis)", "denies": "uttering falsehood"},
    {"index": 10, "name": "Uatch-nes", "meaning": "who makest the flame wax strong",
     "home_place": "Het-ka-Ptah (Memphis)", "denies": "carrying away food"},
    {"index": 11, "name": "Qerti", "meaning": "the two sources of the Nile",
     "home_place": "Amentet", "denies": "uttering evil words"},
    {"index": 12, "name": "Hetch-abehu", "meaning": "whose teeth shine",
     "home_place": "Ta-she (the Fayyum)", "denies": "attacking a man"},
    {"index": 13, "name": "Am-senf", "meaning": "who dost consume blood",
     "home_place": "the house of slaughter", "denies": "killing the god's cattle"},
    {"index": 14, "name": "Am-beseku", "meaning": "who dost consume the entrails",
     "home_place": "the mābet chamber", "denies": "acting deceitfully"},
    {"index": 15, "name": "Neb-Maat", "meaning": "god of Right and Truth",
     "home_place": "the city of double Maati", "denies": "laying waste ploughed land"},
    {"index": 16, "name": "Thenemi", "meaning": "who goest backwards",
     "home_place": "the city of Bast (Bubastis)", "denies": "prying / making mischief",
     "notes": ["Dropped entirely by one Internet Archive scan of Budge 1904 "
               "(godsofegyptianso00budg jumps 15 -> 17); read off a second, "
               "independent scan of the same edition (Cornell, cu31924092320500) "
               "and confirmed by the Maiherperi witness ('i.tnmy pr m bAst'). "
               "Not reconstructed."]},
    {"index": 17, "name": "Aati", "meaning": "",
     "home_place": "Annu (Heliopolis)", "denies": "slander (\"setting the mouth in motion\")"},
    {"index": 18, "name": "Tutu-f", "meaning": "doubly evil",
     "home_place": "the nome of Ati (9th Lower Egyptian, Busiris)",
     "denies": "anger without cause"},
    {"index": 19, "name": "Uamemti", "meaning": "the serpent",
     "home_place": "the house of slaughter", "denies": "adultery with another man's wife",
     "notes": ["Budge 1901 spells the name 'Uamenti'; Budge 1904 'Uamemti'."]},
    {"index": 20, "name": "Maa-an-f", "meaning": "who lookest upon what is brought to him",
     "home_place": "the Temple of Amsu (Min)", "denies": "sin against purity"},
    {"index": 21, "name": "Heri-seru", "meaning": "Chief of the divine Princes",
     "home_place": "the city of Nehatu", "denies": "striking fear into a man",
     "notes": ["Home place differs between witnesses: Budge/Nebseni 'Nehatu' vs "
               "UCL/Maiherperi 'Imu'. The Nebseni value is recorded; the variant "
               "is not silently resolved."]},
    {"index": 22, "name": "Khemi", "meaning": "the Destroyer",
     "home_place": "the Lake of Kaui (Khas?)",
     "denies": "encroaching upon sacred times and seasons",
     "notes": ["Home place differs between witnesses: Budge/Nebseni 'the Lake of "
               "Kaui (Khas?)' vs UCL/Maiherperi 'the great place'. Budge's own "
               "query is kept."]},
    {"index": 23, "name": "Shet-kheru", "meaning": "who orderest speech",
     "home_place": "Urit", "denies": "being a man of anger",
     "notes": ["Home place differs between witnesses: Budge/Nebseni 'Urit' vs "
               "UCL/Maiherperi 'the shrine'."]},
    {"index": 24, "name": "Nekhen", "meaning": "the Child",
     "home_place": "the Lake of Heq-at (13th Lower Egyptian nome)",
     "denies": "deafness to the words of truth"},
    {"index": 25, "name": "Ser-kheru", "meaning": "disposer of speech",
     "home_place": "the city of Unes (19th Upper Egyptian nome)",
     "denies": "stirring up strife",
     "notes": ["Budge also prints the name as 'Ser-khera'."]},
    {"index": 26, "name": "Basti", "meaning": "",
     "home_place": "the Secret city", "denies": "making anyone weep"},
    {"index": 27, "name": "Hra-f-ha-f", "meaning": "whose face is turned backwards",
     "home_place": "the Dwelling", "denies": "impurity"},
    {"index": 28, "name": "Ta-ret", "meaning": "Leg of fire",
     "home_place": "Akhekhu", "denies": "\"eating my heart\" (losing one's temper)"},
    {"index": 29, "name": "Kenemti", "meaning": "",
     "home_place": "Kenemet", "denies": "abuse of others"},
    {"index": 30, "name": "An-hetep-f", "meaning": "who bringest thine offering",
     "home_place": "Sau (Sais)", "denies": "acting with violence"},
    {"index": 31, "name": "Neb-hrau", "meaning": "lord of faces",
     "home_place": "Tchefet", "denies": "judging hastily"},
    {"index": 32, "name": "Serekhi", "meaning": "who givest knowledge",
     "home_place": "Unth", "denies": "taking vengeance upon the god",
     "notes": ["Confession clause is PARTIAL. The scan of Budge 1901 vol. II "
               "p. 370 is unreadable across part of this clause ('I have not >. "
               "ueeeeeee'); the recoverable half is 'I have not taken vengeance "
               "upon the god'. Budge 1895's Nebseni appendix gives the fuller "
               "sense as transgressing against / vexing God. Not completed by "
               "guesswork."]},
    {"index": 33, "name": "Neb-abui", "meaning": "lord of two horns",
     "home_place": "Satiu", "denies": "multiplying speech overmuch"},
    {"index": 34, "name": "Nefer-Tem", "meaning": "",
     "home_place": "Het-ka-Ptah (Memphis)", "denies": "deceit / wickedness"},
    {"index": 35, "name": "Tem-sep", "meaning": "",
     "home_place": "Tattu (Busiris)", "denies": "cursing the king"},
    {"index": 36, "name": "Ari-em-ab-f", "meaning": "whose heart doth labour",
     "home_place": "the city of Tebti", "denies": "fouling water"},
    {"index": 37, "name": "Ahi-mu", "meaning": "Ahi of the water",
     "home_place": "Nu", "denies": "raising the voice haughtily",
     "notes": ["Name reading is UNCERTAIN — Budge himself prints it as "
               "'Ahi-mu (?)'. The query is his, and it is kept."]},
    {"index": 38, "name": "Utu-rekhit", "meaning": "who givest commands to mankind",
     "home_place": "[Sau (?)]", "denies": "cursing the god",
     "notes": ["Home place is UNCERTAIN — Budge prints '[Sau (?)]' with his own "
               "query, and this is one of the two slots where the Maiherperi "
               "witness disagrees. Recorded exactly as Budge has it, brackets "
               "and question mark included."]},
    {"index": 39, "name": "Neheb-nefert", "meaning": "",
     "home_place": "the Lake of Nefer (?)", "denies": "insolence",
     "notes": ["Home place is UNCERTAIN — Budge's own query. UCL/Maiherperi has "
               "'Gem' in this slot. Budge's reading recorded, disagreement not "
               "resolved."]},
    {"index": 40, "name": "Neheb-kau", "meaning": "",
     "home_place": "[thy] city", "denies": "seeking distinctions for oneself",
     "notes": ["Budge's text gives the place as '[thy] city' — the bracket is "
               "his, and the phrase is what the formula says here."]},
    {"index": 41, "name": "Tcheser-tep", "meaning": "whose head is holy",
     "home_place": "[thy] habitation",
     "denies": "wealth beyond what is justly one's own",
     "notes": ["Budge's text gives the place as '[thy] habitation' — bracket his."]},
    {"index": 42, "name": "An-a-f", "meaning": "who bringest thine own arm",
     "home_place": "Aukert (the underworld)",
     "denies": "contempt for the god of one's own town"},
]
