"""EUROPEAN — DEADLY_SIN. TRANSCRIBED here, from Dante's Purgatorio X-XXVII.

One of the two corpora whose text is written out in this package. Read the
provenance contract in ``apps.actors.mythology`` before touching it: which
corpus is transcribed and which is a pointer is the distinction that the
withdrawn EU-DS-01..07 table was lost for want of.

Moved verbatim out of ``seed_mythology.py``.

Cross-references in the comments below ("above", "below", "this file") were
written when every table in this package was one module; see the package
docstring in ``apps/actors/mythology/__init__.py``. Every table they name is
importable from that package.
"""

#: Provenance carried by every one of the seven. One string for the corpus
#: because they all come from the same place in the same poem.
DEADLY_SIN_SOURCE = (
    "Dante, Purgatorio X-XXVII — the seven terraces of Mount Purgatory, the one "
    "structure in the Commedia that the seven capital sins order. The sequence "
    "is Dante's own, resting on the theory of disordered love Virgil states in "
    "Purg. XVII, and is NOT Gregory the Great's: his seven (Moralia in Job "
    "XXXI.xlv.87) are inanis gloria, invidia, ira, tristitia, avaritia, ventris "
    "ingluvies, luxuria, with superbia their root and not one of them. "
    "docs/lore-verification/verify-christian-structure.md §3.3."
)

#: Carried by all seven, because the mistake it guards against was made once
#: already and made for all seven at once.
NOT_A_CIRCLE_NOTE = (
    "This is a terrace, not a circle. Dante layers hell on Aristotle's "
    "tripartition — incontinenza / malizia / matta bestialitade, said by Virgil "
    "at Inf. XI.79-84 — and pride, envy and sloth get no circle in it at all. "
    "The withdrawn EU-DS-01..07 carried a `dante_circle`; no such coordinate "
    "exists in Dante and it is not restored here."
)

#: Also carried by all seven: `opposing_virtue` is the one field in the payload
#: that is not Dante's.
CONTRARY_VIRTUE_NOTE = (
    "`opposing_virtue_*` is from the 'seven contrary virtues', a pairing that "
    "descends from Prudentius' Psychomachia (c. 410). It is a common later "
    "table whose wording varies between versions — charity or kindness against "
    "envy — not a list the Church defined, and not one Dante publishes; he "
    "names exempla on each terrace instead."
)

# The seven capital sins, one article per terrace, bottom to top.
#
# `ordinal` is the terrace number and so is `payload["purgatorio_terrace"]`, and
# `payload["terrace_realm_code"]` names the realm row seeded above. The three
# agree or tests/test_purgatorio_terraces.py fails: an article that says terrace
# 2 while pointing at the fifth terrace's realm is exactly the drift that let
# five of the seven sit on the wrong terrace in the withdrawn table.
EUROPEAN_STATUTES = [
    {
        "code": "EU-DS-T1",
        "ordinal": 1,
        "polarity": "OFFENCE",
        "title_zh": "傲慢",
        "title_en": "Pride",
        "text_zh": (
            "傲慢（Superbia）。炼狱山第一层，《炼狱篇》X-XII。属「爱之偏邪」——"
            "爱指向邻人之恶。苦修：背负巨石弯腰而行，沿途是刻在石上的谦逊范例。"
        ),
        "text_en": (
            "Pride (Superbia). The first terrace of Mount Purgatory, Purg. "
            "X-XII. Love perverted — turned toward a neighbour's harm. The "
            "penitent walks bent double beneath a great stone, past carved "
            "exempla of humility."
        ),
        "notes": [
            NOT_A_CIRCLE_NOTE,
            CONTRARY_VIRTUE_NOTE,
            "Gregory the Great treats superbia not as one of the seven but as "
            "the root they grow from (Moralia in Job XXXI.xlv.87: 'Radix "
            "quippe cuncti mali superbia est'). Dante gives it a terrace, and "
            "the lowest; the ordinal here is Dante's, not Gregory's.",
        ],
        "payload": {
            "purgatorio_terrace": 1,
            "terrace_realm_code": "EU_PURGATORY_T1_PRIDE",
            "latin": "Superbia",
            "opposing_virtue_zh": "谦逊",
            "opposing_virtue_en": "humility",
            "purgation_zh": "背负巨石弯腰而行",
            "purgation_en": "bowed double beneath a great stone",
            "cantos": "Purg. X-XII",
            "love_disorder": "perverted",
        },
    },
    {
        "code": "EU-DS-T2",
        "ordinal": 2,
        "polarity": "OFFENCE",
        "title_zh": "嫉妒",
        "title_en": "Envy",
        "text_zh": (
            "嫉妒（Invidia）。炼狱山第二层，《炼狱篇》XIII-XV。属「爱之偏邪」。"
            "苦修：眼睑被铁丝缝合。"
        ),
        "text_en": (
            "Envy (Invidia). The second terrace, Purg. XIII-XV. Love "
            "perverted. The penitent's eyelids are sewn shut with iron wire."
        ),
        "notes": [
            NOT_A_CIRCLE_NOTE,
            CONTRARY_VIRTUE_NOTE,
            "The withdrawn EU-DS-07 put envy on the seventh terrace under "
            "「被冷水浸泡」 and in the eighth circle of hell under 「被铁笼囚禁」. "
            "Neither is in the poem; the iron cage was invented outright, and "
            "Malebolge contains no cage. Purg. XIII is the eyelids and the "
            "wire.",
        ],
        "payload": {
            "purgatorio_terrace": 2,
            "terrace_realm_code": "EU_PURGATORY_T2_ENVY",
            "latin": "Invidia",
            "opposing_virtue_zh": "仁爱",
            "opposing_virtue_en": "charity",
            "purgation_zh": "眼睑被铁丝缝合",
            "purgation_en": "eyelids sewn shut with iron wire",
            "cantos": "Purg. XIII-XV",
            "love_disorder": "perverted",
        },
    },
    {
        "code": "EU-DS-T3",
        "ordinal": 3,
        "polarity": "OFFENCE",
        "title_zh": "愤怒",
        "title_en": "Wrath",
        "text_zh": (
            "愤怒（Ira）。炼狱山第三层，《炼狱篇》XV-XVII。属「爱之偏邪」。"
            "苦修：行走于呛人的浓烟之中。"
        ),
        "text_en": (
            "Wrath (Ira). The third terrace, Purg. XV-XVII. Love perverted. "
            "The penitent walks through thick, blinding, choking smoke."
        ),
        "notes": [
            NOT_A_CIRCLE_NOTE,
            CONTRARY_VIRTUE_NOTE,
            "The Inferno's fifth circle holds the wrathful too (Inf. "
            "VII-VIII), but as incontinence under Aristotle's scheme rather "
            "than as an item on this list. The overlap of four sins with "
            "circles 2-5 is a coincidence of the two vocabularies, not a "
            "correspondence.",
        ],
        "payload": {
            "purgatorio_terrace": 3,
            "terrace_realm_code": "EU_PURGATORY_T3_WRATH",
            "latin": "Ira",
            "opposing_virtue_zh": "温良",
            "opposing_virtue_en": "meekness",
            "purgation_zh": "行走于呛人的浓烟中",
            "purgation_en": "walking through choking smoke",
            "cantos": "Purg. XV-XVII",
            "love_disorder": "perverted",
        },
    },
    {
        "code": "EU-DS-T4",
        "ordinal": 4,
        "polarity": "OFFENCE",
        "title_zh": "懒惰",
        "title_en": "Sloth",
        "text_zh": (
            "懒惰（Acedia）。炼狱山第四层，《炼狱篇》XVIII-XIX。属「爱之不足」——"
            "七宗罪中唯一一条「爱得太少」，位于全山的转折处。苦修：不停奔跑呼喊。"
        ),
        "text_en": (
            "Sloth (Acedia). The fourth terrace, Purg. XVIII-XIX. Love "
            "defective — the single sin of too little love, and the hinge "
            "between the three below and the three above. The penitent runs "
            "without pause, calling out exempla of zeal."
        ),
        "notes": [
            NOT_A_CIRCLE_NOTE,
            CONTRARY_VIRTUE_NOTE,
            "DISPUTED, AND LEFT DISPUTED: whether acedia has any place in the "
            "Inferno at all. The accidiosi sunk beneath the Styx in the fifth "
            "circle are connected to it by some readings, while Dante presents "
            "them as anger turned inward (UT Austin, Danteworlds, circle 5). "
            "This article states the terrace and takes no position on the "
            "circle. The withdrawn EU-DS-05 stated circle 3, which is "
            "gluttony's, and its own note admitted as much.",
            "Gregory's seven have tristitia and no acedia (Moralia in Job "
            "XXXI.xlv.87); acedia is the name the later Western list uses and "
            "the one that fits Dante's fourth terrace.",
        ],
        "payload": {
            "purgatorio_terrace": 4,
            "terrace_realm_code": "EU_PURGATORY_T4_SLOTH",
            "latin": "Acedia",
            "opposing_virtue_zh": "热忱",
            "opposing_virtue_en": "zeal",
            "purgation_zh": "不停奔跑呼喊",
            "purgation_en": "running without pause",
            "cantos": "Purg. XVIII-XIX",
            "love_disorder": "defective",
        },
    },
    {
        "code": "EU-DS-T5",
        "ordinal": 5,
        "polarity": "OFFENCE",
        "title_zh": "贪婪",
        "title_en": "Avarice",
        "text_zh": (
            "贪婪（Avaritia），与挥霍同层。炼狱山第五层，《炼狱篇》XIX-XXII。"
            "属「爱之过度」。苦修：面朝下俯卧于地。"
        ),
        "text_en": (
            "Avarice (Avaritia), with prodigality beside it. The fifth "
            "terrace, Purg. XIX-XXII. Love excessive. The penitent lies face "
            "down on the ground."
        ),
        "notes": [
            NOT_A_CIRCLE_NOTE,
            CONTRARY_VIRTUE_NOTE,
            "The terrace holds the prodigal as well as the miserly (Purg. "
            "XXII), so this article is not 'stinginess' but disordered "
            "attachment to goods in either direction — the same pairing the "
            "Inferno's fourth circle makes of the avari and the prodighi.",
        ],
        "payload": {
            "purgatorio_terrace": 5,
            "terrace_realm_code": "EU_PURGATORY_T5_AVARICE",
            "latin": "Avaritia",
            "opposing_virtue_zh": "慷慨",
            "opposing_virtue_en": "generosity",
            "purgation_zh": "面朝下俯卧于地",
            "purgation_en": "lying face down on the ground",
            "cantos": "Purg. XIX-XXII",
            "love_disorder": "excessive",
        },
    },
    {
        "code": "EU-DS-T6",
        "ordinal": 6,
        "polarity": "OFFENCE",
        "title_zh": "暴食",
        "title_en": "Gluttony",
        "text_zh": (
            "暴食（Gula）。炼狱山第六层，《炼狱篇》XXII-XXIV。属「爱之过度」。"
            "苦修：在够不到的果树下饥渴。"
        ),
        "text_en": (
            "Gluttony (Gula). The sixth terrace, Purg. XXII-XXIV. Love "
            "excessive. The penitent starves and thirsts beneath fruit trees "
            "whose scent draws and whose branches withhold."
        ),
        "notes": [NOT_A_CIRCLE_NOTE, CONTRARY_VIRTUE_NOTE],
        "payload": {
            "purgatorio_terrace": 6,
            "terrace_realm_code": "EU_PURGATORY_T6_GLUTTONY",
            "latin": "Gula",
            "opposing_virtue_zh": "节制",
            "opposing_virtue_en": "temperance",
            "purgation_zh": "在够不到的果树下饥渴",
            "purgation_en": "hunger and thirst beneath unreachable fruit",
            "cantos": "Purg. XXII-XXIV",
            "love_disorder": "excessive",
        },
    },
    {
        "code": "EU-DS-T7",
        "ordinal": 7,
        "polarity": "OFFENCE",
        "title_zh": "淫欲",
        "title_en": "Lust",
        "text_zh": (
            "淫欲（Luxuria）。炼狱山第七层，也是最后一层，《炼狱篇》XXV-XXVII。"
            "属「爱之过度」。苦修：穿过巨大的火墙。"
        ),
        "text_en": (
            "Lust (Luxuria). The seventh and last terrace, Purg. XXV-XXVII. "
            "Love excessive. The penitent passes through a wall of flame."
        ),
        "notes": [
            NOT_A_CIRCLE_NOTE,
            CONTRARY_VIRTUE_NOTE,
            "Nothing is above the seventh terrace except the summit itself: "
            "the Earthly Paradise, Lethe and Eunoè (Purg. XXVIII, XXXI, "
            "XXXIII). There is no eighth terrace.",
        ],
        "payload": {
            "purgatorio_terrace": 7,
            "terrace_realm_code": "EU_PURGATORY_T7_LUST",
            "latin": "Luxuria",
            "opposing_virtue_zh": "贞洁",
            "opposing_virtue_en": "chastity",
            "purgation_zh": "穿过巨大的火墙",
            "purgation_en": "passing through a wall of flame",
            "cantos": "Purg. XXV-XXVII",
            "love_disorder": "excessive",
        },
    },
]
