"""GREEK — GORGIAS: the rows. Provenance and argument are in ``statutes_gorgias.py``.

Data only, and separated for the reason ``statutes_inferno_entries.py`` is:
the module that says WHY a corpus exists should be readable without
scrolling past every article it contains. Nothing here decides anything —
the notes carried by more than one row are defined here because the rows
need them, and the corpus's source, provenance and boundaries are stated
next door.
"""
# Carried by every row. The first is the corpus's whole warrant and the second
# is the boundary it must not cross.
NOT_AN_OFFENCE_NOTE = (
    "Gorgias 523a-526d states no offences. It states how the dead are tried. "
    "This article is a rule of that court, which is why its polarity is "
    "PROCEDURE and not OFFENCE — citing it says something about the "
    "proceeding, not about the soul's account. The one corpus in this system "
    "that prices deeds is GONGGUOGE, and it is Chinese."
)

NOT_A_ROUTING_INPUT_NOTE = (
    "Not an input to `_route_greek`. That method reads the verdict and nothing "
    "else, because Plato's fork has no depth to read: 524a says which way each "
    "soul is sent, never how far along. An article is a thing a judge can "
    "point at by hand."
)

# Gorgias and Republic X are BOTH Plato and BOTH about the judgement of the
# dead, and they do not describe the same afterlife. Every row that touches
# material the Er myth also touches carries this, so that the overlap is
# visible on the row rather than only in a module docstring.
TWO_ESCHATOLOGIES_NOTE = (
    "Republic X covers this ground too and does not agree. Gorgias sends a "
    "soul to the Isles or to Tartarus and the myth ends there; Republic X "
    "615a-b sentences it to a thousand-year circuit and 621a-b sends it back "
    "to be born again. Shorey's apparatus to the Loeb Republic cross-refers "
    "Gorg. 524a, 525c and 525d-526a at exactly these points, so the kinship is "
    "real — but a corpus that merged the two would assert a terminal sentence "
    "AND a return, which is neither dialogue. Corpus REPUBLIC_ER holds the "
    "other structure and no article here cites it."
)

GORGIAS_STATUTES = [
    {
        "code": "GR-GRG-01",
        "ordinal": 1,
        "polarity": "PROCEDURE",
        "title_zh": "两处归宿之律",
        "title_en": "The law of the two destinations",
        "text_zh": (
            "《高尔吉亚》523a-b。「一生行于正义与虔敬者，死后往至福群岛，"
            "在那里全然幸福，恶不能及；行不义与不敬者，往复仇与惩罚之所，"
            "名曰塔尔塔罗斯。」此律立于克洛诺斯之世，「向来如此，至今仍行于天上」——"
            "523d-e 的改制改的是审判程序，不是这条归宿之律。"
        ),
        "text_en": (
            "Gorgias 523a-b. \"He who has lived all his life in justice and "
            "holiness shall go, when he is dead, to the Islands of the "
            "Blessed, and dwell there in perfect happiness out of the reach of "
            "evil; but that he who has lived unjustly and impiously shall go "
            "to the house of vengeance and punishment, which is called "
            "Tartarus.\" The law dates from the days of Cronos and \"has "
            "always been, and still continues to be in Heaven\" — the reform "
            "at 523d-e changes the procedure, not this."
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            NOT_A_ROUTING_INPUT_NOTE,
            "The two destinations are seeded as GR_ISLES_OF_THE_BLESSED and "
            "GR_TARTARUS. The third Greek realm, EU_PLATO_MEADOW, is the venue "
            "of GR-GRG-06 and not a destination; the fourth, GR_ACHERON, is "
            "Virgil's and appears nowhere in this dialogue.",
        ],
        "payload": {
            "stephanus": "523a-b",
            "destination_realm_codes": [
                "GR_ISLES_OF_THE_BLESSED",
                "GR_TARTARUS",
            ],
            "predates_the_reform": True,
        },
    },
    {
        "code": "GR-GRG-02",
        "ordinal": 2,
        "polarity": "PROCEDURE",
        "title_zh": "生前受审，故判决屡误",
        "title_en": "Judgment before death gave wrong verdicts",
        "text_zh": (
            "《高尔吉亚》523b-c。改制前，「判决在人将死的当天作出；审判者活着，"
            "受审者也活着，结果判决屡屡失当」。冥王与至福群岛的当局为此上告宙斯，"
            "说「灵魂找错了地方」。"
        ),
        "text_en": (
            "Gorgias 523b-c. Before the reform \"the judgment was given on the "
            "very day on which the men were to die; the judges were alive, and "
            "the men were alive; and the consequence was that the judgments "
            "were not well given.\" Pluto and the authorities from the Islands "
            "of the Blessed brought the complaint to Zeus: \"the souls found "
            "their way to the wrong places.\""
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            "The complaint comes FROM THE RECEIVING REALMS, not from the "
            "judged and not from the bench. That is the detail worth citing: "
            "the myth's account of how a mis-sorting is discovered is that the "
            "destination notices who arrived.",
        ],
        "payload": {"stephanus": "523b-c"},
    },
    {
        "code": "GR-GRG-03",
        "ordinal": 3,
        "polarity": "PROCEDURE",
        "title_zh": "生者受审时的四种蔽障",
        "title_en": "What a living trial admitted",
        "text_zh": (
            "《高尔吉亚》523c-d。宙斯指出病根：「受审的人穿着衣服，因为他们活着；"
            "许多人灵魂邪恶，却披着俊美的身体、财富或门第，到审判之日，"
            "众多证人出来作证说他们活得正直。」审判者也一样——"
            "「他们自己审判时也穿着衣服；眼、耳与整个身体横在他们自己的灵魂之前，如同一层帷幕。」"
        ),
        "text_en": (
            "Gorgias 523c-d. Zeus names the fault: \"the persons who are "
            "judged have their clothes on, for they are alive; and there are "
            "many who, having evil souls, are apparelled in fair bodies, or "
            "encased in wealth or rank, and, when the day of judgment arrives, "
            "numerous witnesses come forward and testify on their behalf that "
            "they have lived righteously.\" The bench is no better: \"they "
            "themselves too have their clothes on when judging; their eyes and "
            "ears and their whole bodies are interposed as a veil before their "
            "own souls.\""
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            "Four specific corruptions are named — a fair body, wealth, rank, "
            "and witnesses — and the fourth is the one a records system should "
            "read twice. Testimony is listed as a thing that MISLEADS a court, "
            "which is why the procedure that replaces it (GR-GRG-07) admits no "
            "evidence except the soul itself.",
        ],
        "payload": {
            "stephanus": "523c-d",
            "corruptions": ["fair body", "wealth", "rank", "witnesses"],
        },
    },
    {
        "code": "GR-GRG-04",
        "ordinal": 4,
        "polarity": "PROCEDURE",
        "title_zh": "夺去死期之预知",
        "title_en": "Foreknowledge of death withdrawn",
        "text_zh": (
            "《高尔吉亚》523d-e。宙斯的第一道补救：「我要夺去人现在拥有的、"
            "对死期的预知——普罗米修斯已奉我命去取走这项能力。」"
            "并且「他们将猝然而死，被剥夺一切亲属，把他们华美的装束抛散在地上」。"
        ),
        "text_en": (
            "Gorgias 523d-e. Zeus's first remedy: \"I will deprive men of the "
            "foreknowledge of death, which they possess at present: this power "
            "which they have Prometheus has already received my orders to take "
            "from them.\" And \"they shall die suddenly and be deprived of all "
            "their kindred, and leave their brave attire strewn upon the "
            "earth.\""
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            "A rule about the living, enforced before death, and the only one "
            "in this corpus that is. It is here because it is part of the same "
            "reform: without it a man could arrange his appearance for a known "
            "day, which is the abuse GR-GRG-03 describes.",
        ],
        "payload": {"stephanus": "523d-e", "enforced_before_death": True},
    },
    {
        "code": "GR-GRG-05",
        "ordinal": 5,
        "polarity": "PROCEDURE",
        "title_zh": "两造俱裸：受审者与审判者皆已死",
        "title_en": "Both parties stripped, the judge dead too",
        "text_zh": (
            "《高尔吉亚》523e-524a。宙斯的第二道补救：「他们受审前要被完全剥光，"
            "因为他们将在死后受审；审判者也要赤裸，也就是说要已死——"
            "他要以赤裸的灵魂洞穿其他赤裸的灵魂。」"
        ),
        "text_en": (
            "Gorgias 523e-524a. Zeus's second remedy: \"they shall be entirely "
            "stripped before they are judged, for they shall be judged when "
            "they are dead; and the judge too shall be naked, that is to say, "
            "dead — he with his naked soul shall pierce into the other naked "
            "souls.\""
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            "The symmetry is the article. It is not enough that the judged be "
            "stripped; the judge is disqualified while living, because his own "
            "senses are the veil GR-GRG-03 describes. This is the warrant for "
            "the bench of GR-GRG-06 being three DEAD men.",
        ],
        "payload": {"stephanus": "523e-524a", "applies_to_the_bench": True},
    },
    {
        "code": "GR-GRG-06",
        "ordinal": 6,
        "polarity": "PROCEDURE",
        "title_zh": "法庭：分区、地点与终裁",
        "title_en": "The bench, the venue, and the appeal",
        "text_zh": (
            "《高尔吉亚》524a。「两位来自亚细亚，弥诺斯与拉达曼提斯，一位来自欧罗巴，"
            "埃阿科斯。他们死后，将在岔路口的草地上审判，两条路由此分出，"
            "一条通往至福群岛，另一条通往塔尔塔罗斯。拉达曼提斯审来自亚细亚的，"
            "埃阿科斯审来自欧罗巴的。我要给弥诺斯首席之权，"
            "在另两位有疑难时由他终审。」"
        ),
        "text_en": (
            "Gorgias 524a. \"Two from Asia, Minos and Rhadamanthus, and one "
            "from Europe, Aeacus. And these, when they are dead, shall give "
            "judgment in the meadow at the parting of the ways, whence the two "
            "roads lead, one to the Islands of the Blessed, and the other to "
            "Tartarus. Rhadamanthus shall judge those who come from Asia, and "
            "Aeacus those who come from Europe. And to Minos I shall give the "
            "primacy, and he shall hold a court of appeal, in case either of "
            "the two others are in any doubt.\""
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            NOT_A_ROUTING_INPUT_NOTE,
            TWO_ESCHATOLOGIES_NOTE,
            "Rhadamanthus and Aeacus are PARALLEL by region; Minos is not a "
            "third instance in a chain but the tie-breaker when the other two "
            "are in doubt. docs/lore-verification/verify-greek.md §2.1 records "
            "that a frontend preset once ordered them 初审 → 复核 → 终审, "
            "which is a chain this sentence does not describe.",
        ],
        "payload": {
            "stephanus": "524a",
            "venue_realm_code": "EU_PLATO_MEADOW",
            "judges": {
                "Rhadamanthus": "Asia",
                "Aeacus": "Europe",
                "Minos": "final decision in case of doubt",
            },
        },
    },
    {
        "code": "GR-GRG-07",
        "ordinal": 7,
        "polarity": "PROCEDURE",
        "title_zh": "灵魂自带其行为的疤痕",
        "title_en": "The soul bears the marks of its deeds",
        "text_zh": (
            "《高尔吉亚》524b-525a。「当一个人被剥去身体，灵魂一切天生的或习得的"
            "情状都袒露可见。」审判者「把他们放在近旁，全然不偏地察看，不知道这是谁的灵魂」；"
            "他可能拿到的是大君王或别的权贵的灵魂，「毫无健全之处，"
            "灵魂被鞭痕所标记，满是伪誓与罪行的印记和疤痕，每一桩行为都在其上留下污渍」。"
        ),
        "text_en": (
            "Gorgias 524b-525a. \"When a man is stripped of the body, all the "
            "natural or acquired affections of the soul are laid open to "
            "view.\" The judge \"places them near him and inspects them quite "
            "impartially, not knowing whose the soul is\"; he may lay hands on "
            "the soul of a king or potentate \"who has no soundness in him, "
            "but his soul is marked with the whip, and is full of the prints "
            "and scars of perjuries and crimes with which each action has "
            "stained him.\""
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            "The rule of evidence, and the reason this court needs no ledger. "
            "There is no record to consult and no witness to hear: the soul IS "
            "the record. That is a genuine difference from every other "
            "cosmology in this system, all three of which weigh, count or read "
            "something kept about the soul rather than read the soul.",
            "\"Not knowing whose the soul is\" is blind assessment, stated as "
            "a requirement. It is the same guarantee GR-GRG-05 gives from the "
            "other side.",
        ],
        "payload": {"stephanus": "524b-525a", "evidence": "the soul itself"},
    },
    {
        "code": "GR-GRG-08",
        "ordinal": 8,
        "polarity": "PROCEDURE",
        "title_zh": "刑罚的双重职分",
        "title_en": "The twofold office of punishment",
        "text_zh": (
            "《高尔吉亚》525b。「刑罚的本分是双重的：受正当惩罚者，"
            "或者应当因此变好、得其益处，或者应当被立为同侪之鉴，"
            "使他们看见他所受的，因而畏惧、因而变好。」"
        ),
        "text_en": (
            "Gorgias 525b. \"Now the proper office of punishment is twofold: "
            "he who is rightly punished ought either to become better and "
            "profit by it, or he ought to be made an example to his fellows, "
            "that they may see what he suffers, and fear and become better.\""
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            "Neither branch is retribution. Both are forward-looking — one "
            "toward the punished, one toward the onlookers — and the article "
            "is worth citing precisely because a sentence recorded under this "
            "corpus is claiming one of those two purposes and not a third.",
        ],
        "payload": {
            "stephanus": "525b",
            "purposes": ["the punished is improved", "others are warned"],
        },
    },
    {
        "code": "GR-GRG-09",
        "ordinal": 9,
        "polarity": "PROCEDURE",
        "title_zh": "可医与不可医",
        "title_en": "Curable and incurable",
        "text_zh": (
            "《高尔吉亚》525b-c。「受神与人惩罚而得改善的，是其罪可医者；"
            "他们在此世如在彼世，都藉痛苦而改善，因为除此别无他途可使他们脱离其恶。"
            "但那些犯下最重罪行、因其罪行而不可医者，则被立为鉴戒；"
            "因为他们既不可医，能得益处的时候已经过去了。」"
        ),
        "text_en": (
            "Gorgias 525b-c. \"Those who are improved when they are punished "
            "by gods and men, are those whose sins are curable; and they are "
            "improved, as in this world so also in another, by pain and "
            "suffering; for there is no other way in which they can be "
            "delivered from their evil. But they who have been guilty of the "
            "worst crimes, and are incurable by reason of their crimes, are "
            "made examples; for, as they are incurable, the time has passed at "
            "which they can receive any benefit.\""
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            TWO_ESCHATOLOGIES_NOTE,
            "THE SORTING RULE OF THIS COSMOLOGY, and it is not a magnitude. "
            "Curability is a property of the soul, not a total struck from a "
            "column, which is why `_route_greek` takes no severity figure and "
            "why `LedgerService.get_unoffset_demerit` returns None for a Greek "
            "soul. A demerit sum could not express this distinction however "
            "large it grew.",
        ],
        "payload": {
            "stephanus": "525b-c",
            "classes": ["curable", "incurable"],
            "is_a_magnitude": False,
        },
    },
    {
        "code": "GR-GRG-10",
        "ordinal": 10,
        "polarity": "PROCEDURE",
        "title_zh": "不可医者多出于掌权之人",
        "title_en": "The incurable come from the powerful",
        "text_zh": (
            "《高尔吉亚》525d-526a。「这些可怖的鉴戒，我相信多半取自僭主、"
            "君王、权贵与公人之列，因为他们是最大、最不敬的罪行的作者，"
            "只因他们有那个权力。」荷马作证：受永罚者总是君王与权贵——"
            "坦塔罗斯、西西弗斯、提梯俄斯。"
            "「但从没有人把忒尔西特斯，或任何作恶的平民，"
            "描述为受永罚或不可医的。」"
        ),
        "text_en": (
            "Gorgias 525d-526a. \"Of these fearful examples, most, as I "
            "believe, are taken from the class of tyrants and kings and "
            "potentates and public men, for they are the authors of the "
            "greatest and most impious crimes, because they have the power.\" "
            "Homer witnesses it — Tantalus, Sisyphus, Tityus. \"But no one "
            "ever described Thersites, or any private person who was a "
            "villain, as suffering everlasting punishment, or as incurable.\""
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            TWO_ESCHATOLOGIES_NOTE,
            "The claim is about CAPACITY, and Plato states the negative case "
            "explicitly, which is what makes it citable rather than a mood: a "
            "private villain is not incurable because he never had the power "
            "to commit the crimes that make a soul so. The dialogue adds the "
            "counter-instance in the same breath — Aristeides, a man of power "
            "who lived justly (526b) — so this is a tendency the myth argues "
            "for, not a status conferred by office.",
        ],
        "payload": {
            "stephanus": "525d-526a",
            "named_examples": ["Tantalus", "Sisyphus", "Tityus", "Archelaus"],
            "counter_instance": "Aristeides son of Lysimachus (526b)",
        },
    },
    {
        "code": "GR-GRG-11",
        "ordinal": 11,
        "polarity": "PROCEDURE",
        "title_zh": "盖印与两条判决",
        "title_en": "The stamp and the two sentences",
        "text_zh": (
            "《高尔吉亚》526b-c。拉达曼提斯拿到一个恶灵魂时，"
            "「对他一无所知，既不知他是谁，也不知他的父母是谁；"
            "他只知道自己拿到了一个恶人；见此，他给他盖上可医或不可医的印记，"
            "把他遣往塔尔塔罗斯」。而当他看见一个「在圣洁与真实中生活过的正义灵魂」——"
            "「最可能是一位做自己本分、不在生前搅扰他人之事的哲人」——"
            "便遣往至福群岛。"
        ),
        "text_en": (
            "Gorgias 526b-c. When Rhadamanthus gets a soul of the bad kind he "
            "\"knows nothing about him, neither who he is, nor who his parents "
            "are; he knows only that he has got hold of a villain; and seeing "
            "this, he stamps him as curable or incurable, and sends him away "
            "to Tartarus.\" And when he looks on a just soul \"who has lived "
            "in holiness and truth\" — \"most likely to have been a "
            "philosopher who has done his own work, and not troubled himself "
            "with the doings of other men in his lifetime\" — \"him "
            "Rhadamanthus sends to the Islands of the Blessed.\""
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            NOT_A_ROUTING_INPUT_NOTE,
            "READ THE FIRST SENTENCE TWICE. The stamp is curable OR incurable "
            "and the destination is Tartarus EITHER WAY. Curability decides "
            "what happens to a soul once it is there — improved by suffering "
            "(GR-GRG-09) or hung up as an example (GR-GRG-08) — not whether it "
            "goes. A reading that sends the curable somewhere gentler invents "
            "a third road, and 524a gives two.",
            "The philosopher is named as the LIKELIEST just soul, not the only "
            "one: Jowett has \"he may have been a private man or not\", and "
            "GR-GRG-10 has already granted Aristeides, who held office.",
        ],
        "payload": {
            "stephanus": "526b-c",
            "both_stamps_go_to": "GR_TARTARUS",
            "isles_realm_code": "GR_ISLES_OF_THE_BLESSED",
        },
    },
]
