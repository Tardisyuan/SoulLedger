"""EUROPEAN — INFERNO. The 26 transcribed places, one dict per article.

Split out of ``statutes_inferno.py`` for the reason ``gongguoge_entries.py`` is
split out of ``statutes_chinese.py``: the provenance, the notes every row
carries and the builder are one kind of thing, and the transcription is
another. Read ``statutes_inferno.py`` first — it holds the source, the wall of
Dis, and the rule about what may and may not be written down here.

WHAT IS LITERAL HERE AND WHAT IS NOT. Every clause of every article is literal
in this file: the canto range, the sinners, the contrapasso, the guardian, the
Aristotelian heading, and every caveat. What the builder does is assemble them
into ``text_zh``/``text_en`` and attach the corpus-wide notes. Nothing about a
place is inferred from another place, with one deliberate exception —
``within_dis`` is read from ``DIS_WALL`` rather than repeated 26 times, because
the wall is one fact about the whole poem and 26 copies of it is 26 chances for
one of them to disagree. ``tests/test_inferno_circles.py`` holds the second,
hand-written copy of that division.

WHAT IS NOT WRITTEN HERE. No shade is named on the strength of a commentator.
``docs/lore-verification/verify-christian-structure.md`` §7 records that Digital
Dante (Barolini) and the Dartmouth Dante Project could not be reached, so the
report makes no claim about what any commentator says, and neither does this
file. Where a name is contested — "Alessandro" at Inf. XII.107 — the dispute is
recorded and the identification is not made.
"""

#: One dict per place, in the poem's own order of descent.
#:
#: keys
#:   suffix        the tail of the citation code, appended to ``EU-INF-``
#:   circle        1-9. Present on subdivisions too: a bolgia is a part of the
#:                 eighth circle, and an article that did not say so would be a
#:                 flat list item again.
#:   kind          None for a circle; "girone" / "bolgia" / "zona" otherwise
#:   index         the subdivision's number within its circle; None for a circle
#:   name          the poem's own name for the place. ONLY the four zones of
#:                 Cocytus have one; every other value here is None, and a name
#:                 appearing on a bolgia would be an invention.
#:   aristotle     the heading Virgil gives it at Inf. XI, or None where the
#:                 speech gives it none. None is a finding, not a blank to fill.
#:   guardian      the being posted there, or None. Never guessed: Limbo has no
#:                 guardian in the poem and this says so by carrying None.
#:   realm_code    the realm row this system already has for the place, or None.
#:                 Only the nine circles have one; the seventeen subdivisions
#:                 have none, which is §6.2-§6.4 of the verification report and
#:                 is the reason this corpus exists.
INFERNO_ENTRIES = [
    # ----------------------------------------------------------------------
    # Upper hell — outside the walls of Dis. Inf. IV-VIII.
    # ----------------------------------------------------------------------
    {
        "suffix": "C1",
        "circle": 1,
        "kind": None,
        "index": None,
        "name": None,
        "title_zh": "第一圈·幽冥边境",
        "title_en": "Limbo",
        "cantos": "Inf. IV",
        "guardian": None,
        "aristotle": None,
        "sinners_zh": "未受洗的婴儿；无罪而未受洗的有德异教徒（荷马、亚里士多德）；"
                      "以及但丁破例安置于此的几位基督之后的非基督徒"
                      "（萨拉丁 IV.129、阿维森纳 IV.143、阿威罗伊 IV.144）",
        "sinners_en": (
            "The unbaptized infants; the virtuous pagans who lived before "
            "Christ — Homer, Aristotle; and the non-Christians of Dante's own "
            "era whom he places here by exception — Saladin (IV.129, d. 1193), "
            "Avicenna (IV.143, d. 1037), Averroes (IV.144, d. 1198)."
        ),
        "contrapasso_zh": "没有肉体刑罚。此处唯一的苦是无望而仍有欲（Inf. IV.42「我们无望地活在渴望中」）。",
        "contrapasso_en": (
            "No bodily punishment at all. The only suffering here is longing "
            "without hope (Inf. IV.42)."
        ),
        "realm_code": "EU_HELL_1ST",
        "notes": (
            "Limbo IS the first circle. The popular chart that puts it outside "
            "the nine and calls the first circle pride is the error "
            "docs/lore-verification/verify-christian-structure.md §4.4 records "
            "in docs/03's diagram; it is also how the withdrawn EU-DS-01 came "
            "to carry Limbo's own condition — 'endless longing' — as pride's "
            "punishment.",
            "`aristotle` is None because no sin is charged. Inf. IV.34-42 gives "
            "the fault as the absence of baptism, not an act, so none of "
            "Virgil's three headings reaches it. The blank is the finding.",
        ),
        "transcription_gap": {
            "where": "below the first circle — the Antinferno, Inf. III",
            "conjectured_split_here": False,
            "conjecture": (
                "Not a conjecture but a declared omission, recorded here "
                "because this is the article the boundary runs under. The "
                "Antinferno — the gate and its inscription, the ignavi who "
                "took no side, the Acheron and Charon who ferries it — is a "
                "real place in Inf. III and is NOT transcribed in this corpus, "
                "which covers the nine circles and their subdivisions only. "
                "verify-christian-structure.md §6.1 counts it among the "
                "poem's 24 places; this corpus's 26 articles count the nine "
                "circles as articles in their own right and do not count the "
                "Antinferno at all. Neither total is wrong; they count "
                "different things, and neither may be quietly restated as the "
                "other."
            ),
        },
    },
    {
        "suffix": "C2",
        "circle": 2,
        "kind": None,
        "index": None,
        "name": None,
        "title_zh": "第二圈·淫欲",
        "title_en": "Lust",
        "cantos": "Inf. V",
        "guardian": "Minos",
        "aristotle": "incontinenza",
        "sinners_zh": "情欲之罪（Inf. V.63-65 举出克娄巴特拉与海伦）",
        "sinners_en": "The carnal, who subjected reason to appetite.",
        "contrapasso_zh": "被永不止息的狂风卷着吹打，如生前被情欲卷走一般。",
        "contrapasso_en": (
            "Swept forever on a wind that never rests, as appetite swept them."
        ),
        "realm_code": "EU_HELL_2ND",
        "notes": (
            "Minos stands at this circle's entrance and assigns every soul its "
            "circle by coiling his tail that many times (Inf. V.4-12). He is "
            "the sorting mechanism of the whole Inferno and he is posted HERE, "
            "not at the ninth circle.",
        ),
    },
    {
        "suffix": "C3",
        "circle": 3,
        "kind": None,
        "index": None,
        "name": None,
        "title_zh": "第三圈·暴食",
        "title_en": "Gluttony",
        "cantos": "Inf. VI",
        "guardian": "Cerberus",
        "aristotle": "incontinenza",
        "sinners_zh": "饕餮者",
        "sinners_en": "The gluttonous.",
        "contrapasso_zh": "俯卧于冰冷腥臭的烂泥中，头上是永不停歇的冷雨、冰雹与黑雪。",
        "contrapasso_en": (
            "Lying in cold and filthy sludge under a ceaseless fall of cold "
            "rain, hail and black snow."
        ),
        "realm_code": "EU_HELL_3RD",
        "notes": (),
    },
    {
        "suffix": "C4",
        "circle": 4,
        "kind": None,
        "index": None,
        "name": None,
        "title_zh": "第四圈·贪婪与挥霍",
        "title_en": "Avarice and Prodigality",
        "cantos": "Inf. VII",
        "guardian": "Plutus",
        "aristotle": "incontinenza",
        "sinners_zh": "吝啬者（avari）与挥霍者（prodighi）——两群人，不是一条罪",
        "sinners_en": (
            "The miserly (avari) AND the prodigal (prodighi) — two crowds, not "
            "one sin."
        ),
        "contrapasso_zh": "分作两半圈推着巨大的重物对撞，撞上便互相咒骂，再各自转回去重来。",
        "contrapasso_en": (
            "Two half-circles rolling great weights against each other, "
            "colliding, reviling each other, and turning back to do it again."
        ),
        "realm_code": "EU_HELL_4TH",
        "notes": (
            "This circle is NOT 'greed'. It holds the two opposite disorders of "
            "one attachment, which is why the withdrawn EU-DS-02 mapping 貪婪 "
            "onto it was imprecise even where it was not wrong: the seven "
            "capital sins have no article for prodigality at all.",
        ),
    },
    {
        "suffix": "C5",
        "circle": 5,
        "kind": None,
        "index": None,
        "name": None,
        "title_zh": "第五圈·愤怒（与忧郁沉抑者）",
        "title_en": "Wrath and the Sullen",
        "cantos": "Inf. VII-VIII",
        "guardian": "Phlegyas",
        "aristotle": "incontinenza",
        "sinners_zh": "暴怒者（iracondi）在水面，忧郁沉抑者（accidiosi / tristi）在泥下",
        "sinners_en": (
            "The wrathful (iracondi) on the surface, and the sullen "
            "(accidiosi / tristi) beneath it."
        ),
        "contrapasso_zh": "暴怒者在斯提克斯沼的水面上互相撕咬；沉抑者陷在泥下，含着泥浆咕哝，永远说不成一句完整的话。",
        "contrapasso_en": (
            "The wrathful tear at one another on the surface of the Styx; the "
            "sullen lie sunk beneath the mud, gurgling a hymn they can never "
            "finish."
        ),
        "realm_code": "EU_HELL_5TH",
        "notes": (
            "Phlegyas ferries the Styx here. Charon, who ferries the Acheron, "
            "belongs to the Antinferno and not to any circle — see EU-INF-C1's "
            "transcription_gap.",
        ),
        "conjecture": (
            "DISPUTED, AND LEFT DISPUTED: whether the accidiosi sunk under the "
            "Styx are acedia. Some readings connect them to it; Dante presents "
            "them as anger turned inward, and UT Austin's Danteworlds (circle "
            "5) reads them as repressed anger without joining them to acedia. "
            "This article states the two groups and takes no position. The "
            "withdrawn EU-DS-05 resolved the question by asserting circle 3, "
            "which is gluttony's."
        ),
    },
    # ----------------------------------------------------------------------
    # Lower hell — within the walls of Dis. Inf. IX-XXXIV.
    # ----------------------------------------------------------------------
    {
        "suffix": "C6",
        "circle": 6,
        "kind": None,
        "index": None,
        "name": None,
        "title_zh": "第六圈·异端",
        "title_en": "Heresy",
        "cantos": "Inf. IX-XI",
        "guardian": "the fallen angels, the three Furies and Medusa on the walls of Dis",
        "aristotle": None,
        "sinners_zh": "异端，尤指否认灵魂不朽的伊壁鸠鲁及其门徒（Inf. X.13-15）",
        "sinners_en": (
            "Heretics, and chiefly the Epicureans who denied the soul's "
            "immortality (Inf. X.13-15)."
        ),
        "contrapasso_zh": "囚于敞开的石棺中焚烧，末日之后石棺封闭。",
        "contrapasso_en": "Burning in open tombs, to be sealed shut at the Last Judgment.",
        "realm_code": "EU_HELL_6TH",
        "notes": (
            "THE FIRST CIRCLE INSIDE THE WALL. The gate is barred by the fallen "
            "angels and held by the Furies and the threat of Medusa until a "
            "messenger from heaven opens it (Inf. VIII.67-IX.105). Everything "
            "from here down is inside Dis; everything above is outside.",
            "Virgil's discourse on the layout of hell (Inf. XI) is delivered "
            "while the travellers are still in this circle, which is why its "
            "canto range runs to XI.",
        ),
        "conjecture": (
            "`aristotle` is None and that is a refusal, not an oversight. "
            "verify-christian-structure.md §2 places circles 6-9 inside Dis "
            "collectively, and Virgil's tripartition at Inf. XI.79-84 names "
            "incontinence, malice and bestiality — malice dividing into "
            "violence and fraud. Heresy is inside the wall without a heading "
            "in that speech. Assigning it one would be this corpus's reading "
            "rather than the poem's, and the report makes no such assignment, "
            "so neither does this article."
        ),
    },
    {
        "suffix": "C7",
        "circle": 7,
        "kind": None,
        "index": None,
        "name": None,
        "title_zh": "第七圈·暴力（三环）",
        "title_en": "Violence",
        "cantos": "Inf. XII-XVII",
        "guardian": "the Minotaur",
        "aristotle": "malizia — violenza",
        "sinners_zh": "施暴者，按施暴的对象分作三环（gironi）：对他人、对自己、对上帝与自然与技艺",
        "sinners_en": (
            "The violent, divided into three rings (gironi) by whom the "
            "violence was done to: neighbour, self, or God, nature and art."
        ),
        "contrapasso_zh": "三环各有其刑，见本圈三条子条文。",
        "contrapasso_en": "Each ring has its own; see the three articles under this one.",
        "realm_code": "EU_HELL_7TH",
        "notes": (
            "The three gironi are the poem's own division and are numbered in "
            "it (Inf. XI.28-33 lays them out before they are entered). "
            "Malebolge's ten and Cocytus's four are counted differently — see "
            "EU-INF-C8 and EU-INF-C9.",
        ),
    },
    {
        "suffix": "C7-R1",
        "circle": 7,
        "kind": "girone",
        "index": 1,
        "name": None,
        "title_zh": "第七圈第一环·对他人的暴力",
        "title_en": "Violence against Neighbour",
        "cantos": "Inf. XII",
        "guardian": "the Centaurs — Chiron, Nessus, Pholus",
        "aristotle": "malizia — violenza",
        "sinners_zh": "杀人者、劫掠者、暴君",
        "sinners_en": "Murderers, plunderers and tyrants.",
        "contrapasso_zh": "沉在沸血之河弗列革吞（Phlegethon）中，深浅按罪；浮出该有的深度就被半人马射回去。",
        "contrapasso_en": (
            "Sunk in Phlegethon, the river of boiling blood, each to the depth "
            "his guilt fixes; the Centaurs shoot any who rise higher."
        ),
        "realm_code": None,
        "notes": (),
        "conjecture": (
            "Inf. XII.107 names one tyrant only as 「Alessandro」. Whether that "
            "is Alexander the Great or Alexander of Pherae is contested, and "
            "verify-christian-structure.md §4.4 marks it as contested. This "
            "article therefore names no shade at all. docs/03 wrote 'Alexander "
            "the Great' as settled."
        ),
    },
    {
        "suffix": "C7-R2",
        "circle": 7,
        "kind": "girone",
        "index": 2,
        "name": None,
        "title_zh": "第七圈第二环·对自己的暴力",
        "title_en": "Violence against Self",
        "cantos": "Inf. XIII",
        "guardian": "the Harpies",
        "aristotle": "malizia — violenza",
        "sinners_zh": "自杀者，以及毁掉自己家业的挥霍者",
        "sinners_en": (
            "Suicides, and those who squandered their own substance to ruin."
        ),
        "contrapasso_zh": "自杀者化作荆棘枯树，鹰身女妖啄食其叶，创口出血才能发声；毁产者被黑母犬追上撕碎。",
        "contrapasso_en": (
            "The suicides are grown into thorn trees whose leaves the Harpies "
            "feed on, and who can speak only from a wound; the squanderers are "
            "run down and torn apart by black bitches."
        ),
        "realm_code": None,
        "notes": (
            "The squanderers here are not the prodighi of the fourth circle. "
            "The fourth circle's prodigality is incontinence in the use of "
            "goods; this is destruction of one's own substance as violence "
            "against the self, and the poem puts them in different circles on "
            "opposite sides of the wall of Dis.",
        ),
    },
    {
        "suffix": "C7-R3",
        "circle": 7,
        "kind": "girone",
        "index": 3,
        "name": None,
        "title_zh": "第七圈第三环·对上帝、自然与技艺的暴力",
        "title_en": "Violence against God, Nature and Art",
        "cantos": "Inf. XIV-XVII",
        "guardian": None,
        "aristotle": "malizia — violenza",
        "sinners_zh": "亵渎者、鸡奸者、放高利贷者",
        "sinners_en": "Blasphemers, sodomites and usurers.",
        "contrapasso_zh": "灼热的沙地上永落火雨：亵渎者仰卧，鸡奸者不停奔跑，放贷者蹲坐，颈上挂着钱袋。",
        "contrapasso_en": (
            "A burning sand under a rain of fire: the blasphemers lie supine, "
            "the sodomites run without stopping, the usurers crouch with "
            "purses at their necks."
        ),
        "realm_code": None,
        "notes": (
            "BLASPHEMY IS HERE, AND IT IS NOT HERESY. The heretics are the "
            "sixth circle; blasphemy is violence against God and belongs to "
            "this ring. Reading one as the other is the shape of mistake "
            "8308204 was withdrawn for, and "
            "tests/test_european_hell_basis.py names it as such.",
            "The descent out of this ring is on Geryon's back (Inf. XVII), "
            "which is how the eighth circle is entered.",
        ),
    },
    {
        "suffix": "C8",
        "circle": 8,
        "kind": None,
        "index": None,
        "name": None,
        "title_zh": "第八圈·欺诈（恶囊 Malebolge，十囊）",
        "title_en": "Fraud (Malebolge)",
        "cantos": "Inf. XVIII-XXX",
        "guardian": "Geryon",
        "aristotle": "malizia — frode",
        "sinners_zh": "对无特殊信任关系者行欺，分作十道同心的石囊（bolge）",
        "sinners_en": (
            "Fraud worked on those bound by no special trust, in ten "
            "concentric stone pouches (bolge)."
        ),
        "contrapasso_zh": "十囊各有其刑，见本圈十条子条文。",
        "contrapasso_en": "Each pouch has its own; see the ten articles under this one.",
        "realm_code": "EU_HELL_8TH",
        "notes": (
            "Fraud is graver than violence in this poem, and the reason is "
            "stated rather than implied: it corrupts the bond peculiar to man "
            "(Inf. XI.22-27). A system that sorts by how much harm was done "
            "cannot express that, which is what "
            "tests/test_european_hell_basis.py pins.",
            "Cantos XVIII-XXX are thirteen of the Inferno's thirty-four — the "
            "largest single stretch of the poem, and the part this deployment "
            "had flattened into one realm with one label.",
        ),
    },
    {
        "suffix": "C8-B01",
        "circle": 8,
        "kind": "bolgia",
        "index": 1,
        "name": None,
        "title_zh": "第八圈第一囊·拉皮条者与诱奸者",
        "title_en": "Panders and Seducers",
        "cantos": "Inf. XVIII",
        "guardian": None,
        "aristotle": "malizia — frode",
        "sinners_zh": "拉皮条者与诱奸者",
        "sinners_en": "Panders and seducers.",
        "contrapasso_zh": "分两列反向而行，被有角的魔鬼在身后挥鞭抽打。",
        "contrapasso_en": (
            "Driven in two files walking opposite ways, whipped from behind by "
            "horned demons."
        ),
        "realm_code": None,
        "notes": (
            "One pouch, two groups walking in opposite directions — the "
            "division is inside the bolgia and is not a further numbered "
            "place.",
        ),
    },
    {
        "suffix": "C8-B02",
        "circle": 8,
        "kind": "bolgia",
        "index": 2,
        "name": None,
        "title_zh": "第八圈第二囊·谄媚者",
        "title_en": "Flatterers",
        "cantos": "Inf. XVIII",
        "guardian": None,
        "aristotle": "malizia — frode",
        "sinners_zh": "谄媚者",
        "sinners_en": "Flatterers.",
        "contrapasso_zh": "浸没在粪便之中。",
        "contrapasso_en": "Sunk in human excrement.",
        "realm_code": None,
        "notes": (
            "The withdrawn EU-DS-07 put envy in the eighth circle alongside "
            "「馋媚者」 and 「邪术师」 — that is this pouch and the fourth — and "
            "gave it a punishment (「被铁笼囚禁」) that appears in no bolgia and "
            "in no part of the poem. There is no cage in Malebolge.",
        ),
    },
    {
        "suffix": "C8-B03",
        "circle": 8,
        "kind": "bolgia",
        "index": 3,
        "name": None,
        "title_zh": "第八圈第三囊·买卖圣职者",
        "title_en": "Simoniacs",
        "cantos": "Inf. XIX",
        "guardian": None,
        "aristotle": "malizia — frode",
        "sinners_zh": "买卖圣职者",
        "sinners_en": "Those who sold ecclesiastical office.",
        "contrapasso_zh": "倒插在石孔中只露双足，脚底被火焰不停燎烧。",
        "contrapasso_en": (
            "Set head-down in stone holes with only the feet showing, the "
            "soles burning."
        ),
        "realm_code": None,
        "notes": (),
    },
    {
        "suffix": "C8-B04",
        "circle": 8,
        "kind": "bolgia",
        "index": 4,
        "name": None,
        "title_zh": "第八圈第四囊·占卜者、术士与星相家",
        "title_en": "Diviners, Sorcerers and Astrologers",
        "cantos": "Inf. XX",
        "guardian": None,
        "aristotle": "malizia — frode",
        "sinners_zh": "占卜者、术士、星相家",
        "sinners_en": "Diviners, sorcerers and astrologers.",
        "contrapasso_zh": "头颅被反扭一百八十度，只能倒退着走，泪水沿背脊流下。",
        "contrapasso_en": (
            "Their heads twisted round backwards, so that they must walk in "
            "reverse and weep down their own backs."
        ),
        "realm_code": None,
        "notes": (),
    },
    {
        "suffix": "C8-B05",
        "circle": 8,
        "kind": "bolgia",
        "index": 5,
        "name": None,
        "title_zh": "第八圈第五囊·贪赃枉法者",
        "title_en": "Barrators",
        "cantos": "Inf. XXI-XXII",
        "guardian": "the Malebranche",
        "aristotle": "malizia — frode",
        "sinners_zh": "贪赃枉法的公职者",
        "sinners_en": "Those who trafficked in public office for money.",
        "contrapasso_zh": "沉在沸腾的沥青里，一露头就被魔鬼用钩子钩住。",
        "contrapasso_en": (
            "Sunk in boiling pitch, hooked by demons the moment they surface."
        ),
        "realm_code": None,
        "notes": (),
    },
    {
        "suffix": "C8-B06",
        "circle": 8,
        "kind": "bolgia",
        "index": 6,
        "name": None,
        "title_zh": "第八圈第六囊·伪善者",
        "title_en": "Hypocrites",
        "cantos": "Inf. XXIII",
        "guardian": None,
        "aristotle": "malizia — frode",
        "sinners_zh": "伪善者",
        "sinners_en": "Hypocrites.",
        "contrapasso_zh": "穿着外镀黄金、内灌铅块的斗篷，缓慢地绕行。",
        "contrapasso_en": (
            "Walking slowly in cloaks gilded on the outside and lined with "
            "lead."
        ),
        "realm_code": None,
        "notes": (),
    },
    {
        "suffix": "C8-B07",
        "circle": 8,
        "kind": "bolgia",
        "index": 7,
        "name": None,
        "title_zh": "第八圈第七囊·盗贼",
        "title_en": "Thieves",
        "cantos": "Inf. XXIV-XXV",
        "guardian": None,
        "aristotle": "malizia — frode",
        "sinners_zh": "盗贼",
        "sinners_en": "Thieves.",
        "contrapasso_zh": "被蛇追咬，与蛇互换形体——偷走他人所有的，连自己的形体也保不住。",
        "contrapasso_en": (
            "Pursued and bitten by serpents, exchanging shape with them: those "
            "who took what was another's cannot keep even their own form."
        ),
        "realm_code": None,
        "notes": (),
    },
    {
        "suffix": "C8-B08",
        "circle": 8,
        "kind": "bolgia",
        "index": 8,
        "name": None,
        "title_zh": "第八圈第八囊·恶谋士",
        "title_en": "Counsellors of Fraud",
        "cantos": "Inf. XXVI-XXVII",
        "guardian": None,
        "aristotle": "malizia — frode",
        "sinners_zh": "以言辞设谋行骗者（Ulysses、Guido da Montefeltro）",
        "sinners_en": (
            "Those who counselled fraud — Ulysses and Guido da Montefeltro "
            "among them."
        ),
        "contrapasso_zh": "各自裹在一束火焰里，火焰的尖端摆动才是他们说话的声音。",
        "contrapasso_en": (
            "Each wrapped in a single flame, speaking only through its moving "
            "tip."
        ),
        "realm_code": None,
        "notes": (
            "The charge is consiglieri frodolenti, counsel given to deceive — "
            "not 'liar' at large. docs/03 filed Ulysses as 「骗子」, which is "
            "the flattening this corpus exists to undo.",
        ),
    },
    {
        "suffix": "C8-B09",
        "circle": 8,
        "kind": "bolgia",
        "index": 9,
        "name": None,
        "title_zh": "第八圈第九囊·制造分裂者",
        "title_en": "Sowers of Discord",
        "cantos": "Inf. XXVIII-XXIX",
        "guardian": None,
        "aristotle": "malizia — frode",
        "sinners_zh": "分裂宗教、国家与血亲的人（Mohammed、Bertran de Born）",
        "sinners_en": (
            "Those who split religion, state and kin — Mohammed and Bertran de "
            "Born among them."
        ),
        "contrapasso_zh": "被持剑的魔鬼反复劈开；伤口在绕行一周后合拢，回到剑下再被劈开。",
        "contrapasso_en": (
            "Cleft again and again by a demon's sword; the wound closes over "
            "one circuit of the pouch and is opened afresh."
        ),
        "realm_code": None,
        "notes": (),
    },
    {
        "suffix": "C8-B10",
        "circle": 8,
        "kind": "bolgia",
        "index": 10,
        "name": None,
        "title_zh": "第八圈第十囊·伪造者",
        "title_en": "Falsifiers",
        "cantos": "Inf. XXIX-XXX",
        "guardian": None,
        "aristotle": "malizia — frode",
        "sinners_zh": "伪造者：炼金术士、伪币制造者、作伪证者、冒名顶替者",
        "sinners_en": (
            "Falsifiers of metal (alchemists), of coin, of word (perjurers) "
            "and of person (impersonators)."
        ),
        "contrapasso_zh": "各患一种恶疾：癞疮、狂躁、水肿、高热。",
        "contrapasso_en": (
            "Each afflicted with a disease of his own: scabs, frenzy, dropsy, "
            "burning fever."
        ),
        "realm_code": None,
        "notes": (
            "Four kinds of falsification in one pouch, matched to four "
            "diseases. The four are not separately numbered places and are not "
            "given articles of their own here.",
        ),
    },
    {
        "suffix": "C9",
        "circle": 9,
        "kind": None,
        "index": None,
        "name": None,
        "title_zh": "第九圈·背叛（科奇土斯冰湖 Cocytus，四带）",
        "title_en": "Treachery (Cocytus)",
        "cantos": "Inf. XXXI-XXXIV",
        "guardian": "the Giants at the rim; Antaeus lowers the travellers in",
        "aristotle": "matta bestialitade",
        "sinners_zh": "背叛者，按背叛的信任关系分作四带：血亲、国家、宾主、恩主",
        "sinners_en": (
            "Traitors, divided by the bond betrayed: kin, country, guest, "
            "benefactor."
        ),
        "contrapasso_zh": "冻在科奇土斯冰湖中，各带的姿势不同。",
        "contrapasso_en": (
            "Frozen into the lake of Cocytus, each zone held in a different "
            "posture."
        ),
        "realm_code": "EU_HELL_9TH",
        "notes": (
            "The betrayed bond, not the deed, is what divides this circle. "
            "That is the sharpest case in "
            "tests/test_european_hell_basis.py::"
            "test_nothing_in_this_system_classifies_a_sin_the_way_dante_does: "
            "no taxonomy of deeds produces it, and this corpus does not supply "
            "one.",
        ),
        "conjecture": (
            "The assignment of 「matta bestialitade」 to treachery is a reading "
            "of Inf. XI, recorded as such in "
            "verify-christian-structure.md §2, and not a sentence in the poem. "
            "Virgil separates fraud from treachery by whether a special bond "
            "of trust existed (Inf. XI.52-66); he does not say in that speech "
            "which of his three headings the ninth circle falls under. The "
            "value is carried because the report carries it, and it is marked "
            "here so that nobody re-derives it as settled."
        ),
    },
    {
        "suffix": "C9-Z1",
        "circle": 9,
        "kind": "zona",
        "index": 1,
        "name": "Caina",
        "title_zh": "第九圈第一带·该隐带（背叛血亲）",
        "title_en": "Caina — Treachery to Kin",
        "cantos": "Inf. XXXII",
        "guardian": None,
        "aristotle": "matta bestialitade",
        "sinners_zh": "背叛血亲者",
        "sinners_en": "Those who betrayed their own kin.",
        "contrapasso_zh": "冻在冰中，头露在冰面之上，面朝下。",
        "contrapasso_en": "Frozen in the ice with the head out, faces turned down.",
        "realm_code": None,
        "notes": (),
    },
    {
        "suffix": "C9-Z2",
        "circle": 9,
        "kind": "zona",
        "index": 2,
        "name": "Antenora",
        "title_zh": "第九圈第二带·安忒诺尔带（背叛国家与党派）",
        "title_en": "Antenora — Treachery to Country",
        "cantos": "Inf. XXXII-XXXIII",
        "guardian": None,
        "aristotle": "matta bestialitade",
        "sinners_zh": "背叛国家或党派者（Ugolino 与 Ruggieri 的一段在此）",
        "sinners_en": (
            "Those who betrayed country or party; Ugolino and Ruggieri are "
            "here."
        ),
        "contrapasso_zh": "冻在冰中，头露在冰面之上。",
        "contrapasso_en": "Frozen in the ice with the head out.",
        "realm_code": None,
        "notes": (),
    },
    {
        "suffix": "C9-Z3",
        "circle": 9,
        "kind": "zona",
        "index": 3,
        "name": "Tolomea",
        "title_zh": "第九圈第三带·托勒密带（背叛宾主）",
        "title_en": "Tolomea — Treachery to Guests",
        "cantos": "Inf. XXXIII",
        "guardian": None,
        "aristotle": "matta bestialitade",
        "sinners_zh": "背叛宾主之谊者",
        "sinners_en": "Those who betrayed a guest or a host.",
        "contrapasso_zh": "仰面冻结，泪水在眼眶里结成冰，把眼睛封死，连哭也哭不出去。",
        "contrapasso_en": (
            "Frozen face upward, the tears freezing in the eye sockets and "
            "sealing the eyes so that grief cannot even leave the face."
        ),
        "realm_code": None,
        "notes": (),
    },
    {
        "suffix": "C9-Z4",
        "circle": 9,
        "kind": "zona",
        "index": 4,
        "name": "Giudecca",
        "title_zh": "第九圈第四带·犹大带（背叛恩主）",
        "title_en": "Giudecca — Treachery to Benefactors",
        "cantos": "Inf. XXXIV",
        "guardian": "Lucifer",
        "aristotle": "matta bestialitade",
        "sinners_zh": "背叛恩主者；Judas、Brutus、Cassius 在路济弗尔的三张嘴中",
        "sinners_en": (
            "Those who betrayed a benefactor; Judas, Brutus and Cassius are in "
            "Lucifer's three mouths."
        ),
        "contrapasso_zh": "完全埋在冰下，姿态各异，无一能出声；三名首恶被路济弗尔的三张嘴永远咀嚼。",
        "contrapasso_en": (
            "Wholly buried under the ice in every posture and wholly silent; "
            "the three chief traitors are chewed forever in Lucifer's three "
            "mouths."
        ),
        "realm_code": None,
        "notes": (
            "The bottom of hell. Nothing is below the fourth zone: the "
            "travellers climb down Lucifer's flank and out (Inf. XXXIV.70-139). "
            "There is no tenth circle and no fifth zone.",
        ),
    },
]
