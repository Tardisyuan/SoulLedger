"""GREEK — REPUBLIC_ER: the rows. Provenance and argument are in ``statutes_republic.py``.

Data only, and separated for the reason ``statutes_inferno_entries.py`` is:
the module that says WHY a corpus exists should be readable without
scrolling past every article it contains. Nothing here decides anything —
the notes carried by more than one row are defined here because the rows
need them, and the corpus's source, provenance and boundaries are stated
next door.
"""
NOT_AN_OFFENCE_NOTE = (
    "Republic X 614b-621b describes a sentence being served, not a code of "
    "offences. This article is a rule of that process, which is why its "
    "polarity is PROCEDURE. GR-ER-04 is the one article in either Greek corpus "
    "that names wrongs, and it names three and then says 'any other'."
)

NOT_A_ROUTING_INPUT_NOTE = (
    "Not an input to anything. `_greek_reading` reads SoulRecord rows and "
    "`_route_greek` reads the verdict; neither consults a Statute. This "
    "article is what a judge cites to explain a figure, not what produces one."
)

TWO_ESCHATOLOGIES_NOTE = (
    "Gorgias covers this ground too and does not agree. Gorgias 526b-c stamps "
    "a soul and sends it to Tartarus or the Isles with no term and no return; "
    "the circuit, the tenfold rate and the rebirth are this dialogue's alone. "
    "Corpus GORGIAS holds that structure and no article here cites it."
)

REPUBLIC_ER_STATUTES = [
    {
        "code": "GR-ER-01",
        "ordinal": 1,
        "polarity": "PROCEDURE",
        "title_zh": "四口之间：判决书佩于身前或身后",
        "title_en": "The four openings, and where the sentence is worn",
        "text_zh": (
            "《理想国》卷十 614c-d。厄尔见「地上有两个口，彼此相近，"
            "正对面天上另有两个口。其间有审判者坐着，他们判决之后，"
            "命正义者把判词系在身前，从右边的天路上行；"
            "同样命不义者从左边的下路下行，这些人也带着他们行为的标记，"
            "却是系在背后。」"
        ),
        "text_en": (
            "Republic X 614c-d. Er came to a place where \"there were two "
            "openings in the earth; they were near together, and over against "
            "them were two other openings in the heaven above. In the "
            "intermediate space there were judges seated, who commanded the "
            "just, after they had given judgment on them and had bound their "
            "sentences in front of them, to ascend by the heavenly way on the "
            "right hand; and in like manner the unjust were bidden by them to "
            "descend by the lower way on the left hand; these also bore the "
            "symbols of their deeds, but fastened on their backs.\""
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            "THE SENTENCE IS WORN, AND WHICH SIDE IT IS WORN ON IS PART OF IT. "
            "The just carry the judgment where they can see it; the unjust "
            "carry theirs where they cannot. That is the closest thing in "
            "either Greek corpus to a record kept ABOUT a soul rather than "
            "read off it — and it is carried by the soul, not filed anywhere.",
            "Four openings, not two roads. Gorgias has one meadow and a fork; "
            "this has a way up and a way down and, facing them, two more by "
            "which souls return. The difference is the circuit.",
        ],
        "payload": {
            "stephanus": "614c-d",
            "just": {"way": "up, on the right", "sentence_worn": "in front"},
            "unjust": {"way": "down, on the left", "sentence_worn": "behind"},
        },
    },
    {
        "code": "GR-ER-02",
        "ordinal": 2,
        "polarity": "PROCEDURE",
        "title_zh": "千年之旅，归于草地",
        "title_en": "The thousand-year journey, and the meadow they return to",
        "text_zh": (
            "《理想国》卷十 614e-615a。众魂「欣然前往草地，在那里扎营如同过节」，"
            "彼此讲述路上所经：「从下面来的，忆起地下旅途中所受所见而哭泣悲叹"
            "（那旅程历时一千年），从上面来的则述说天上的欢乐与不可思议的美景。」"
        ),
        "text_en": (
            "Republic X 614e-615a. The souls \"went forth with gladness into "
            "the meadow, where they encamped as at a festival,\" and told one "
            "another what had happened by the way, \"those from below weeping "
            "and sorrowing at the remembrance of the things which they had "
            "endured and seen in their journey beneath the earth (now the "
            "journey lasted a thousand years), while those from above were "
            "describing heavenly delights and visions of inconceivable "
            "beauty.\""
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            TWO_ESCHATOLOGIES_NOTE,
            "BOTH ROADS ARE A THOUSAND YEARS AND BOTH COME BACK HERE. The "
            "reward is not a destination in this dialogue any more than the "
            "punishment is; it is a term, and it ends. That is why the Greek "
            "realm rows carry `is_eternal=False` — a fact that belongs to this "
            "corpus and not to GORGIAS, where the Isles are where the story "
            "stops.",
            "The souls arrive REMEMBERING, and this is the same meadow they "
            "will leave from at GR-ER-11 having drunk. The forgetting is "
            "placed at the exit of the circuit, not at its entrance.",
        ],
        "payload": {
            "stephanus": "614e-615a",
            "circuit_years": 1000,
            "applies_to_both_roads": True,
            "meadow_realm_code": "EU_PLATO_MEADOW",
        },
    },
    {
        "code": "GR-ER-03",
        "ordinal": 3,
        "polarity": "PROCEDURE",
        "title_zh": "十倍偿还，百年为一期",
        "title_en": "Tenfold repayment, in periods of a hundred years",
        "text_zh": (
            "《理想国》卷十 615a-b。「他们对任何人所行的每一桩不义，都要十倍受报；"
            "即每百年偿一次——百年被算作人的一生之长——"
            "如此在一千年里付清十倍。」"
        ),
        "text_en": (
            "Republic X 615a-b. \"For every wrong which they had done to any "
            "one they suffered tenfold; or once in a hundred years — such "
            "being reckoned to be the length of man's life, and the penalty "
            "being thus paid ten times in a thousand years.\""
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            NOT_A_ROUTING_INPUT_NOTE,
            TWO_ESCHATOLOGIES_NOTE,
            "THE ARITHMETIC IS PER DEED, NOT PER WEIGHT, and that is why "
            "`_greek_reading` in apps/ledger/services.py counts wrongs instead "
            "of summing severities. Ten times each wrong, once a century, for "
            "ten centuries: the multiplier attaches to the COUNT. A cosmology "
            "that graded by magnitude would need a different sentence here and "
            "Plato does not give one.",
            "The hundred years is stated as a reckoning of a human life, not "
            "as an independent unit — the sentence is 'you live it back, ten "
            "times'. Recorded in the payload as such rather than as a bare "
            "number, because the reason is the citable part.",
        ],
        "payload": {
            "stephanus": "615a-b",
            "multiplier": 10,
            "period_years": 100,
            "period_is": "the reckoned length of a human life",
            "circuit_years": 1000,
            "unit_of_account": "each wrong done to each person",
        },
    },
    {
        "code": "GR-ER-04",
        "ordinal": 4,
        "polarity": "OFFENCE",
        "title_zh": "点名的大恶，与未列举的其余",
        "title_en": "The wrongs named, and the ones left unnamed",
        "text_zh": (
            "《理想国》卷十 615b。「譬如说，若有人曾是许多人死亡的原因，"
            "或曾出卖城邦、军队而使之为奴，或曾犯任何其他恶行，"
            "他们对每一桩、对所有这些过犯，都要十倍受罚。」"
        ),
        "text_en": (
            "Republic X 615b. \"If, for example, there were any who had been "
            "the cause of many deaths, or had betrayed or enslaved cities or "
            "armies, or been guilty of any other evil behaviour, for each and "
            "all of their offences they received punishment ten times over.\""
        ),
        "notes": [
            "THE ONLY OFFENCE-POLARITY ARTICLE IN EITHER GREEK CORPUS, and it "
            "is three instances and a catch-all, introduced by 'for example'. "
            "It is transcribed as one article rather than split into three, "
            "because splitting it would present a rhetorical series as an "
            "enumeration and the enumeration is precisely what the Greek "
            "material does not have.",
            "THE CATCH-ALL IS NOT A GAP TO BE FILLED. 'Any other evil "
            "behaviour' is Plato declining to give a list, not a list that "
            "went missing. Expanding it into articles is how the withdrawn "
            "HELL_LAW corpus was built: a plausible table, correct-looking "
            "prose, and no document behind it.",
            TWO_ESCHATOLOGIES_NOTE,
        ],
        "payload": {
            "stephanus": "615b",
            "named": [
                "being the cause of many deaths",
                "betraying cities or armies",
                "enslaving cities or armies",
            ],
            "catch_all": "or been guilty of any other evil behaviour",
            "transcription_gap": (
                "The source enumerates nothing. Three instances are given "
                "after 'for example' and closed with 'any other evil "
                "behaviour'. No fourth article is written."
            ),
        },
    },
    {
        "code": "GR-ER-05",
        "ordinal": 5,
        "polarity": "MERIT",
        "title_zh": "善行同比例受报",
        "title_en": "Beneficence requited in the same proportion",
        "text_zh": (
            "《理想国》卷十 615b-c。「行善、正义与虔敬的报偿，也按同样的比例。」"
        ),
        "text_en": (
            "Republic X 615b-c. \"And the rewards of beneficence and justice "
            "and holiness were in the same proportion.\""
        ),
        "notes": [
            "SAME PROPORTION, OTHER ROAD. This is the sentence "
            "apps/ledger/readings.py cites when it refuses 功過相抵 for this "
            "cosmology: good-doing is requited tenfold on the upward way, in "
            "its own hundred-year periods, and never as a subtraction from the "
            "term owed on the downward one. The two roads in GR-ER-01 are not "
            "two columns of one account — a soul walks one of them.",
            "Netting them would rebuild the Chinese ledger under a Greek name. "
            "《太微仙君功過格》 is the corpus built for offsetting and it is "
            "the only one here that carries prices; this article carries a "
            "rate and no price.",
            NOT_A_ROUTING_INPUT_NOTE,
        ],
        "payload": {
            "stephanus": "615b-c",
            "multiplier": 10,
            "offsets_demerit": False,
            "rewarded": ["beneficence", "justice", "holiness"],
        },
    },
    {
        "code": "GR-ER-06",
        "ordinal": 6,
        "polarity": "PROCEDURE",
        "title_zh": "更重之报，其详未述",
        "title_en": "Greater retributions, whose content is withheld",
        "text_zh": (
            "《理想国》卷十 615c。「关于生下不久便夭折的幼儿，他所说的我不必复述。"
            "至于对神与父母的虔敬与不敬，以及杀人者，"
            "另有远为重大的报应，是他描述过的。」"
        ),
        "text_en": (
            "Republic X 615c. \"I need hardly repeat what he said concerning "
            "young children dying almost as soon as they were born. Of piety "
            "and impiety to gods and parents, and of murderers, there were "
            "retributions other and greater far which he described.\""
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            "THIS ARTICLE'S CONTENT IS MISSING FROM THE SOURCE, AND THE "
            "SOURCE SAYS SO. Er described the retributions; Plato reports that "
            "he described them and does not say what they were. So the rule "
            "exists, its subjects are named — impiety toward gods, impiety "
            "toward parents, murder — and its terms are unrecoverable.",
            "The row is transcribed rather than omitted for the same reason "
            "the Antinferno's absence is recorded on EU-INF-C1 rather than "
            "left silent: a corpus that quietly dropped this would read as "
            "though Republic X priced every wrong at tenfold, when the text "
            "explicitly exempts three classes into a heavier scheme it "
            "withholds. Do NOT fill it.",
            "The newborns are a second withholding in the same sentence, and "
            "Shorey's apparatus flags it — Plato does not take up the question "
            "of infants at all. Recorded, not resolved.",
        ],
        "payload": {
            "stephanus": "615c",
            "subjects": [
                "piety and impiety toward the gods",
                "piety and impiety toward parents",
                "murderers",
                "children dying almost as soon as they were born",
            ],
            "transcription_gap": (
                "The terms are withheld BY THE SOURCE. Republic X 615c says "
                "these retributions are 'other and greater far' than the "
                "tenfold rule of GR-ER-03 and never states them. Nothing is "
                "inferred and no number is written."
            ),
        },
    },
    {
        "code": "GR-ER-07",
        "ordinal": 7,
        "polarity": "PROCEDURE",
        "title_zh": "不可医者与未服满者，出口不纳",
        "title_en": "The mouth refuses the incurable and the unfinished",
        "text_zh": (
            "《理想国》卷十 615d-616a。众魂将上行时，「洞口不但不纳他们，"
            "反而咆哮起来——每当这些不可医的罪人，或某个尚未受足惩罚的人，"
            "试图上行时」。于是「面貌如火的野人」将他们捉住，"
            "「捆住手脚与头，掷在地上鞭打剥皮，沿路拖行，"
            "在荆棘上梳刮如梳羊毛，向过路者宣告他们的罪行，"
            "宣告他们将被投入地狱」。其中有僭主阿尔狄埃俄斯，"
            "「弑其老父与长兄」，也有作过大恶的平民。"
        ),
        "text_en": (
            "Republic X 615d-616a. As the souls were about to ascend, \"the "
            "mouth, instead of admitting them, gave a roar, whenever any of "
            "these incurable sinners or some one who had not been "
            "sufficiently punished tried to ascend; and then wild men of fiery "
            "aspect, who were standing by and heard the sound, seized and "
            "carried them off; and Ardiaeus and others they bound head and "
            "foot and hand, and threw them down and flayed them with scourges, "
            "and dragged them along the road at the side, carding them on "
            "thorns like wool, and declaring to the passers-by what were their "
            "crimes, and that they were being taken away to be cast into "
            "hell.\" Ardiaeus was a tyrant of Pamphylia who \"had murdered his "
            "aged father and his elder brother\"; with him were other tyrants, "
            "and private individuals who had been great criminals."
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            TWO_ESCHATOLOGIES_NOTE,
            "TWO CLASSES ARE REFUSED AND ONLY ONE OF THEM IS PERMANENT. The "
            "incurable never leave; 'one who had not been sufficiently "
            "punished' has not finished a term that has an end. Reading the "
            "sentence as one class collapses a distinction the dialogue makes "
            "in a single clause, and it is the distinction between a life "
            "sentence and an unserved one.",
            "Ardiaeus is the counterweight to Gorgias 525d-526a and Shorey's "
            "apparatus cross-refers it here. But note what this passage adds "
            "and Gorgias denies: 'there were also besides the tyrants private "
            "individuals who had been great criminals'. Gorgias 526a says no "
            "private person was ever described as incurable. Both rows are "
            "transcribed as their own dialogue has them; neither is corrected "
            "against the other.",
        ],
        "payload": {
            "stephanus": "615d-616a",
            "refused": [
                "the incurable",
                "those who had not completed their punishment",
            ],
            "named": ["Ardiaeus the Great, tyrant of Pamphylia"],
            "contradicts": (
                "GR-GRG-10, which says no private person was ever called "
                "incurable. Left standing on both sides."
            ),
        },
    },
    {
        "code": "GR-ER-08",
        "ordinal": 8,
        "polarity": "PROCEDURE",
        "title_zh": "草地七日，第八日启程",
        "title_en": "Seven days in the meadow, and departure on the eighth",
        "text_zh": (
            "《理想国》卷十 616b。「草地上的众魂逗留七日之后，"
            "第八日必须启程上路，再过四日」便到得见那道贯通天地的光柱之处。"
        ),
        "text_en": (
            "Republic X 616b. \"Now when the spirits which were in the meadow "
            "had tarried seven days, on the eighth they were obliged to "
            "proceed on their journey, and, on the fourth day after,\" they "
            "came to the place from which the shaft of light through heaven "
            "and earth could be seen."
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            "The only interval in either Greek corpus given in days rather "
            "than centuries, and it is compulsory in both directions: seven "
            "days is how long a soul MAY stay and the eighth is when it must "
            "go. Between the thousand-year term and the choice of the next "
            "life there is a fixed recess, and it has a length.",
        ],
        "payload": {
            "stephanus": "616b",
            "days_in_the_meadow": 7,
            "departure_day": 8,
            "meadow_realm_code": "EU_PLATO_MEADOW",
        },
    },
    {
        "code": "GR-ER-09",
        "ordinal": 9,
        "polarity": "PROCEDURE",
        "title_zh": "阄与择：责在择者，神无咎",
        "title_en": "The lot and the choice: the blame is the chooser's",
        "text_zh": (
            "《理想国》卷十 617d-618a。传令者宣告：「听命运女神拉刻西斯之言。"
            "必朽的灵魂啊，看哪，新一轮的生与死。你们的守护神不由分配给你们，"
            "而是你们选择你们的守护神；抽得第一阄者先选，"
            "他所选的生活便是他的命运。德性无主，人尊之则多得，慢之则少得；"
            "责任在于选择者——神是无咎的。」摆出的生活样式远多于在场的灵魂。"
        ),
        "text_en": (
            "Republic X 617d-618a. The Interpreter proclaimed: \"Hear the word "
            "of "
            "Lachesis, the daughter of Necessity. Mortal souls, behold a new "
            "cycle of life and mortality. Your genius will not be allotted to "
            "you, but you will choose your genius; and let him who draws the "
            "first lot have the first choice, and the life which he chooses "
            "shall be his destiny. Virtue is free, and as a man honours or "
            "dishonours her he will have more or less of her; the "
            "responsibility is with the chooser — God is justified.\" And "
            "\"there were many more lives than the souls present.\""
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            TWO_ESCHATOLOGIES_NOTE,
            "αἰτία ἑλομένου· θεὸς ἀναίτιος — the load-bearing sentence of the "
            "whole myth, and the one that makes this cosmology's record "
            "meaningful. A soul's next life is not a sentence handed down; it "
            "is chosen, and the choosing is what it answers for. Cite this "
            "before attributing any Greek soul's condition to its "
            "disposition.",
            "THE LOT DECIDES ORDER, NOT OUTCOME, and the myth closes the gap "
            "itself: there were more lives laid out than souls, so even the "
            "last to choose still chooses. An implementation that drew a Greek "
            "soul's next life at random would be citing this article against "
            "what it says.",
            "THE CITATION SPANS TWO SECTIONS ON PURPOSE. The proclamation is "
            "617d-e; the count of lives — 'far more numerous than the "
            "assembly' — is 618a. Jowett's prose runs them together and carries "
            "no section numbers, so citing the whole of it as 617d-e would put "
            "half the article at a reference that does not contain it. The "
            "remainder of 618a, and the catalogue of individual choices "
            "through 620d, are not transcribed.",
        ],
        "payload": {
            "stephanus": "617d-618a",
            "greek": "αἰτία ἑλομένου· θεὸς ἀναίτιος",
            "lot_decides": "order of choosing",
            "lot_does_not_decide": "which life",
            "more_lives_than_souls": True,
        },
    },
    {
        "code": "GR-ER-10",
        "ordinal": 10,
        "polarity": "PROCEDURE",
        "title_zh": "阿特洛波斯使之不可逆",
        "title_en": "Atropos makes the choice irreversible",
        "text_zh": (
            "《理想国》卷十 620e。所选的生活经拉刻西斯与克洛托之手，"
            "再「带到阿特洛波斯那里，她纺出那线，使之不可逆转；"
            "此后他们头也不回地走过必然女神的宝座之下」。"
        ),
        "text_en": (
            "Republic X 620e. The chosen life passed from Lachesis and Clotho "
            "and was carried \"to Atropos, who spun the threads and made them "
            "irreversible, whence without turning round they passed beneath "
            "the throne of Necessity.\""
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            "The article that closes GR-ER-09. The choice is free and it is "
            "final in the same paragraph — freedom here is the freedom to "
            "choose once, not to revise. A Greek disposition is not amendable "
            "after this point, and the myth places the irreversibility with a "
            "named Fate rather than leaving it as an assumption.",
        ],
        "payload": {"stephanus": "620e", "reversible": False},
    },
    {
        "code": "GR-ER-11",
        "ordinal": 11,
        "polarity": "PROCEDURE",
        "title_zh": "忘川平原与阿墨勒斯河：定量而非等量",
        "title_en": "The plain of Forgetfulness and the river: a measure, not an equal one",
        "text_zh": (
            "《理想国》卷十 621a-b。众魂「在灼热中行往忘川平原，"
            "那是不生树木草莱的荒野；傍晚在阿墨勒斯河边扎营，"
            "那河的水没有容器盛得住。他们都必须饮下一定的量，"
            "而那些没有被智慧所救的，饮得比必需的多；"
            "各人饮下便忘却一切。」"
        ),
        "text_en": (
            "Republic X 621a-b. The souls \"marched on in a scorching heat to "
            "the plain of Forgetfulness, which was a barren waste destitute of "
            "trees and verdure; and then towards evening they encamped by the "
            "river of Unmindfulness, whose water no vessel can hold; of this "
            "they were all obliged to drink a certain quantity, and those who "
            "were not saved by wisdom drank more than was necessary. And each "
            "one as he drank forgot all things.\""
        ),
        "notes": [
            NOT_AN_OFFENCE_NOTE,
            TWO_ESCHATOLOGIES_NOTE,
            "COMPULSORY BUT NOT UNIFORM, and that is the whole article. Every "
            "soul must drink a measure; the unwise drink past it. So how much "
            "a soul forgets is the last thing in the myth that still depends "
            "on what the soul is — after Atropos has made the life "
            "irreversible. `MemoryResetMechanism` records a mechanism per "
            "realm and has no room for a quantity, so this degree is NOT "
            "modelled anywhere and must not be read into the seeded value.",
            "PLATO'S RIVER IS NOT LETHE. The PLAIN is Λήθης πεδίον and the "
            "river is Ἀμέλης, which Jowett renders 'Unmindfulness'; Shorey's "
            "note records that calling the river Lethe is later usage. The "
            "Greek realms carry `memory_reset_mechanism=\"LETHE\"` because "
            "that is this system's enum member for the mechanism, not because "
            "Republic X names the river so.",
            "Er himself was hindered from drinking, which is how there is a "
            "report at all. The exemption is narrative and is not a rule.",
        ],
        "payload": {
            "stephanus": "621a-b",
            "plain": "the plain of Forgetfulness (Λήθης πεδίον)",
            "river": "the river of Unmindfulness (Ἀμέλης)",
            "compulsory": True,
            "uniform": False,
            "degree_is_modelled": False,
        },
    },
]
