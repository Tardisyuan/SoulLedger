"""Realm tables for the four cosmologies, and the one parent/child link.

Moved verbatim out of ``seed_mythology.py``; see that command's docstring
for how the rows are matched and ``apps.actors.mythology`` for the corpus
provenance contract.

Cross-references in the comments below ("above", "below", "this file") were
written when every table in this package was one module; see the package
docstring in ``apps/actors/mythology/__init__.py``. Every table they name is
importable from that package.
"""
from apps.realms.models import RealmType

# --------------------------------------------------------------------------
# Realms
# Fields: realm_code, name_local, name_zh, name_en, name_egy, realm_type,
#         tier, description, memory_reset_mechanism, is_eternal, cycle_limit
# memory_reset_mechanism values track apps.disposition.models.MemoryResetMechanism.
# --------------------------------------------------------------------------
# THE TEN COURTS ARE TEN REALMS — one row each, `tier` == 殿号, display name ==
# the sitting king's title. This used to be eleven Chinese realms in which the
# ten courts did not appear at all as places: eight HELL rows named after
# *punishments* (剑树狱, 寒冰狱, 烊铜狱) or after whichever king happened to be
# filed there (阎罗殿, 泰山府), with five of them doubling up two or three kings
# each — 秦广王 and 楚江王 both in DY_03_QISHI, 阎罗王 and 平等王 and 判官 all in
# DY_10_YAMA. The numbers in the codes were their own third opinion: DY_03_QISHI
# was named "Seventh Court Qishi", and DY_10_YAMA was "第十殿 / 阎罗殿" while the
# actor tables (correctly) seat 阎罗王 in the fifth court. Nothing could be
# stated about a court without first asking which of the three numbering
# schemes was meant.
#
# So: ten HELL realms, `DY_COURT_NN_<KING>`, where NN is the court number, is
# the row's `tier`, and is the number in `name_zh`/`name_en`. `name_zh` is
# character-for-character the king's `title_zh` in CHINESE_ACTORS below, and
# `name_en` his `title_en`; tests/test_seed_mythology.py asserts that identity,
# so the court cannot be renamed in one table and not the other.
#
# The `DY_COURT_` prefix is what keeps the numbering unambiguous. The three
# realms that are *not* courts keep their existing codes and stay outside that
# namespace — DY_01_HEAVEN is the first heaven, not the first court, and the
# distinction is now visible in the code itself rather than resting on the
# reader knowing which DY_01 is meant.
#
# 剑树狱 / 寒冰狱 / 烊铜狱 are gone as first-class realms. They are 小地狱 —
# instruments inside a court, not courts — and keeping them alongside the ten
# would have re-created exactly the ambiguity this replaces. realms/0012
# repoints anything that referenced them onto the court whose 大地狱 covers the
# same offence and tombstones the rows; see that migration for the mapping.
CHINESE_REALMS = [
    ("DY_01_HEAVEN", "天堂", "第一层天界", "First Heaven", "TLITLITLI", RealmType.BLISS, 1,
     "Pure merit souls - highest bliss, no reincarnation", "NONE", True, None),
    # SOURCE NOT FOUND. 「杨柳宫」 could not be located as an underworld place in
    # 《玉历宝钞》, in 《佛说预修十王生七经》, or in the general folklore material
    # searched for the 2026-08-14 cast review — see
    # docs/lore-verification/verify-cn-cast.md §3.9, which files it as
    # 「查不到出处」 rather than as a fabrication, and allows that it may be this
    # project's own invention or borrowed from a novel or a game.
    #
    # It is kept, and labelled, rather than deleted. An invented realm that says
    # it is invented costs nothing; a deletion would destroy a deliberate
    # fictional element on the strength of a failed search, and "I could not
    # find it" is not "it does not exist". Whoever knows where this came from
    # should replace this note with the answer.
    ("DY_02_YANGLIU", "杨柳宫", "杨柳宫", "Yangliu Palace", "Yangliu", RealmType.BLISS, 2,
     "Souls awaiting reunion with loved ones. SOURCE UNKNOWN: no underworld "
     "place by this name appears in 《玉历宝钞》 or 《十王经》; treat as this "
     "project's own element until a source is produced",
     "MENGPO", False, None),
    # "washed by Mengpo broth" was struck from this description. 《玉历宝钞》
    # 「孟婆神」 puts the 醧忘台 「居第十殿，冥王殿前六桥之外」 and has the broth
    # drunk after sentence and before rebirth — so a soul that has drunk it
    # here, before being judged, would face its court with no memory of the
    # life being judged. The tenth court's row below already says this
    # correctly; only the holding pen and the 孟婆 actor row disagreed.
    ("DY_00_PURGATORY", "待审所", "待审所", "Purgatory Holding", "Daishensuo", RealmType.PURGATORY, 1,
     "Souls awaiting judgment - held before the first court reads the ledger",
     "MENGPO", False, None),
    ("DY_COURT_01_QINGUANG", "第一殿", "第一殿秦广王", "First Court Qinguang", "Qinguang",
     RealmType.HELL, 1,
     "Intake court - the Ledger of Life and Death is read and the soul's case "
     "opened; no punishment is administered here", "MENGPO", False, None),
    ("DY_COURT_02_CHUJIANG", "第二殿", "第二殿楚江王", "Second Court Chujiang", "Chujiang",
     RealmType.HELL, 2,
     "活大地狱 - the mildest punishment court; thieves and those who wounded "
     "others in life", "MENGPO", False, 100),
    # 忤逆尊长 is the offence 《玉历》 actually opens the third court with, and it
    # was the one missing: the row read "evil tongue, false witness,
    # oath-breaking", of which only 教唆兴讼 (incitement to litigation) has a
    # counterpart in the text. Note that filial offence is split across two
    # courts in 《玉历》 — defying one's elders here, failing to keep or bury
    # one's parents at the eighth — and the repo had put all of it at the eighth.
    ("DY_COURT_03_SONGDI", "第三殿", "第三殿宋帝王", "Third Court Songdi", "Songdi",
     RealmType.HELL, 3,
     "黑绳大地狱 - 忤逆尊长, 教唆兴讼, 背恩失节: defying one's elders, inciting "
     "litigation, betraying a trust", "MENGPO", False, 80),
    ("DY_COURT_04_WUGUAN", "第四殿", "第四殿五官王", "Fourth Court Wuguan", "Wuguan",
     RealmType.HELL, 4,
     "合大地狱 - fraud, withheld dues, falsified accounts", "MENGPO", False, 60),
    ("DY_COURT_05_YANLUO", "第五殿", "第五殿阎罗王", "Fifth Court Yama", "Yanluo",
     RealmType.HELL, 5,
     "叫唤大地狱 - the gravest sins, tried by Yama himself; the 望乡台 stands here",
     "MENGPO", False, 50),
    ("DY_COURT_06_BIANCHENG", "第六殿", "第六殿卞城王", "Sixth Court Biancheng", "Biancheng",
     RealmType.HELL, 6,
     "大叫唤大地狱 - sacrilege and irreverence", "MENGPO", False, 40),
    ("DY_COURT_07_TAISHAN", "第七殿", "第七殿泰山王", "Seventh Court Taishan", "Taishan",
     RealmType.HELL, 7,
     "热恼地狱 - desecration of the dead, trafficking in bodies", "MENGPO", False, 30),
    # COURTS 8 AND 9 ARE SWAPPED BETWEEN THE TWO MAJOR SYSTEMS, AND THIS REPO
    # FOLLOWS 《玉历宝钞》. 《佛说预修十王生七经》 and the Daoist tradition seat
    # 平等王 at the eighth and 都市王 at the ninth; 《玉历宝钞》 reverses them, and
    # that is what is seeded here and in COURT_NUMBERS. Both are real orderings
    # and neither is a mistake — but which one is in force has to be recorded,
    # because a reader checking these rows against a 十王经-based source will
    # find two courts apparently transposed and has no way to tell a version
    # difference from a bug. The rest of the file is 玉历 too (楚江 not 初江,
    # 卞城 not 变成, 泰山 not 太山), so the choice is at least consistent.
    ("DY_COURT_08_DUSHI", "第八殿", "第八殿都市王", "Eighth Court Dushi", "Dushi",
     RealmType.HELL, 8,
     "大热恼地狱 - unfilial conduct and betrayal of one's own house", "MENGPO", False, 20),
    ("DY_COURT_09_PINGDENG", "第九殿", "第九殿平等王", "Ninth Court Pingdeng", "Pingdeng",
     RealmType.HELL, 9,
     "阿鼻地狱 - the deepest hell; murder, arson, the crimes with no remedy",
     "MENGPO", False, 10),
    ("DY_COURT_10_ZHUANLUN", "第十殿", "第十殿转轮王", "Tenth Court Zhuanlun", "Zhuanlun",
     RealmType.HELL, 10,
     "The wheel of rebirth - sentences are complete; the next life is assigned "
     "and the broth of forgetting drunk. No punishment is administered here",
     "MENGPO", False, None),
]

EUROPEAN_REALMS = [
    # NOT LETHE. This row carried `memory_reset_mechanism="LETHE"` along with
    # every other European realm, and heaven is the one place in the Commedia
    # where the claim is easiest to disprove: the blessed remember, and their
    # remembering is most of what Paradiso consists of — Piccarda names the
    # convent she was taken from (Par. III), Justinian recounts the
    # whole history of the eagle (Par. VI), Cacciaguida tells Dante about
    # twelfth-century Florence and about Dante's own exile (Par. XV-XVII).
    # Lethe is also nowhere near here: it runs at the summit of Mount
    # Purgatory, and a soul reaches heaven having already crossed it, which
    # makes the reset a thing that happened to it somewhere else. A field
    # naming the mechanism *this realm* applies is the wrong place to record a
    # river two realms down the road.
    ("EU_HEAVEN", "天堂", "上帝之国", "Kingdom of Heaven", "Heaven", RealmType.BLISS, 1,
     "Eternal paradise - the highest bliss realm in Christian tradition", "NONE", True, None),
    # The mountain as a whole. It is a container now — the seven terraces below
    # hang off this row by `parent_realm` (see REALM_PARENTS) — so its
    # description says what the container holds instead of describing a single
    # undifferentiated waiting room.
    #
    # THIS ROW KEEPS LETHE — the only one of the eleven realms that used to
    # carry it still doing so. The mountain is not a level, it is the whole
    # ascent, and the ascent ends in the water: a soul admitted here leaves by
    # being drawn through Lethe and then Eunoè at the summit (Purg. XXXI,
    # XXXIII) and by no other exit. So "what happens to memory in this realm"
    # has an answer for the container even though seven of its eight parts
    # answer NONE. The alternative reading — that a container should say NONE
    # and let the summit sub-realm carry the mechanism alone — was considered
    # and rejected: it would make this row, the destination
    # `DispositionService._route_european` sends every PURGATORY and RETRY
    # verdict to, state that no memory reset occurs on a mountain whose own
    # description names both rivers.
    ("EU_PURGATORY", "炼狱", "涤罪所", "Purgatory", "Purgatory", RealmType.PURGATORY, 1,
     "Mount Purgatory entire: Ante-Purgatory (Purg. I-IX), the seven terraces "
     "and the Earthly Paradise at the summit, all of which are its sub-realms. "
     "Every soul admitted here is already saved; the suffering is remedial and "
     "it ends. The memory reset happens at the summit, in EU_EARTHLY_PARADISE "
     "after the seventh terrace — not on the way up",
     "LETHE", False, None),
    # ----------------------------------------------------------------------
    # THE SEVEN TERRACES OF MOUNT PURGATORY.
    #
    # WHY THEY EXIST. The seven capital sins were seeded in 6017f04 as seven
    # DEADLY_SIN statutes carrying a `dante_circle`, and were withdrawn whole in
    # 8308204: Dante does not layer hell by the seven sins. He layers it on
    # Aristotle's tripartition — incontinenza / malizia / matta bestialitade,
    # said outright by Virgil in Inf. XI.79-84 — and pride, envy and sloth have
    # no circle at all. The structure that IS ordered by the seven is this one,
    # Purgatorio X-XXVII, and the repo did not model it, so the withdrawn
    # articles had nowhere to return to. These seven rows are that anchor.
    #
    # ORDER IS THE POINT. Bottom to top: pride, envy, wrath, sloth, avarice,
    # gluttony, lust. `tier` is the terrace number, exactly as `tier` is the
    # circle number for EU_HELL_* and the court number for DY_COURT_*. Dante's
    # own reason for that order is the theory of disordered love Virgil gives in
    # Purg. XVII: terraces 1-3 are love perverted (aimed at a neighbour's harm),
    # terrace 4 is love defective, terraces 5-7 are love excessive. It is not
    # Gregory the Great's order and must not be credited to him — his seven
    # (Moralia in Job XXXI.xlv.87) are inanis gloria, invidia, ira, tristitia,
    # avaritia, ventris ingluvies, luxuria, with superbia the root above them
    # rather than one of them, and no acedia at all.
    #
    # SUB-REALMS, NOT REPLACEMENTS. EU_PURGATORY stays and stays a destination:
    # `DispositionService._route_european` sends every PURGATORY/RETRY verdict
    # to it, and the mountain is one place with parts, not seven places that
    # happen to be near each other. So these seven point at it through
    # `Realm.parent_realm` — the field's first use in seeded data. (Lethe used
    # to stand on this row too, which was the mountain-wide version of the same
    # error: it put the river on every terrace. It stands on
    # EU_EARTHLY_PARADISE now, which is where Dante puts it.)
    #
    # NOT DISPOSITION DESTINATIONS. No verdict routes to a terrace and this
    # change does not add one, for the same reason EU_PLATO_MEADOW is not a
    # destination: the router has verdict and karma to work with, and a terrace
    # is chosen by WHICH sin, which nothing in a Judgment currently records.
    # Routing by karma magnitude would reproduce the circle-severity ladder that
    # made "seven sins over nine circles" look plausible in the first place.
    # tests/test_purgatorio_terraces.py asserts the absence, so adding a route
    # has to be a decision rather than a drift.
    #
    # NO LETHE ON THE WAY UP. All eleven European realms carried
    # memory_reset_mechanism=LETHE, which is wrong for the nine circles (Dante's
    # damned keep their memories — Francesca, Ulysses, Ugolino all recount their
    # lives) and wrong here: Lethe is at the summit, in the Earthly Paradise,
    # after the seventh terrace. These rows say NONE, and so do the nine circles
    # and heaven now; the two rows that still say LETHE are the mountain and
    # EU_EARTHLY_PARADISE, which is the only place the water actually is.
    ("EU_PURGATORY_T1_PRIDE", "炼狱第一层", "傲慢之台", "First Terrace - Pride",
     "Superbia", RealmType.PURGATORY, 1,
     "First terrace: pride. The penitent walks bent double beneath a great "
     "stone, past carved exempla of humility (Purg. X-XII). Love perverted. "
     "Pride has no circle in the Inferno at all — this is its only place in "
     "the poem",
     "NONE", False, None),
    ("EU_PURGATORY_T2_ENVY", "炼狱第二层", "嫉妒之台", "Second Terrace - Envy",
     "Invidia", RealmType.PURGATORY, 2,
     "Second terrace: envy. The penitent's eyelids are sewn shut with iron "
     "wire (Purg. XIII-XV). Love perverted. Envy has no circle in the Inferno "
     "either; the withdrawn EU-DS-07 gave it an iron cage in the eighth "
     "circle, and no part of the poem contains one",
     "NONE", False, None),
    ("EU_PURGATORY_T3_WRATH", "炼狱第三层", "愤怒之台", "Third Terrace - Wrath",
     "Ira", RealmType.PURGATORY, 3,
     "Third terrace: wrath. The penitent walks through thick, blinding, "
     "choking smoke (Purg. XV-XVII). Love perverted. The Inferno's fifth "
     "circle also holds the wrathful, but it holds them as incontinence, not "
     "as one of the seven",
     "NONE", False, None),
    ("EU_PURGATORY_T4_SLOTH", "炼狱第四层", "懒惰之台", "Fourth Terrace - Sloth",
     "Acedia", RealmType.PURGATORY, 4,
     "Fourth terrace: sloth (acedia). The penitent runs without pause, calling "
     "out exempla of zeal (Purg. XVIII-XIX). Love defective — the single sin "
     "of too little love, and the hinge of the mountain. Sloth has no circle "
     "of its own in the Inferno: the accidiosi sunk under the Styx are read by "
     "some as acedia and by Dante as anger turned inward, and the reading is "
     "disputed",
     "NONE", False, None),
    ("EU_PURGATORY_T5_AVARICE", "炼狱第五层", "贪婪之台", "Fifth Terrace - Avarice",
     "Avaritia", RealmType.PURGATORY, 5,
     "Fifth terrace: avarice, and prodigality with it. The penitent lies face "
     "down on the ground (Purg. XIX-XXII). Love excessive. Two directions of "
     "one disorder share the terrace, the same pairing the Inferno's fourth "
     "circle makes of the avaricious and the prodigal",
     "NONE", False, None),
    ("EU_PURGATORY_T6_GLUTTONY", "炼狱第六层", "暴食之台", "Sixth Terrace - Gluttony",
     "Gula", RealmType.PURGATORY, 6,
     "Sixth terrace: gluttony. The penitent starves and thirsts beneath fruit "
     "trees whose scent draws and whose branches withhold (Purg. XXII-XXIV). "
     "Love excessive",
     "NONE", False, None),
    ("EU_PURGATORY_T7_LUST", "炼狱第七层", "淫欲之台", "Seventh Terrace - Lust",
     "Luxuria", RealmType.PURGATORY, 7,
     "Seventh and last terrace: lust. The penitent passes through a wall of "
     "flame (Purg. XXV-XXVII). Love excessive. What lies above is not an "
     "eighth terrace but the summit itself — the Earthly Paradise, Lethe and "
     "Eunoè, and the ascent to the stars",
     "NONE", False, None),
    # ----------------------------------------------------------------------
    # THE SUMMIT. Purgatorio XXVIII-XXXIII.
    #
    # WHY IT IS ITS OWN ROW. Lethe used to stand on EU_PURGATORY, i.e. on the
    # whole mountain, which put the river everywhere on it — including on the
    # seven terraces a soul crosses while it still needs the memory of the life
    # it is doing penance for. Dante is specific about where the water is:
    # Matelda meets Dante in the Earthly Paradise at the top of the mountain
    # (XXVIII), draws him through Lethe after his confession (XXXI), and gives
    # him Eunoè last of all (XXXIII), after which he is 「puro e disposto a
    # salire a le stelle」. The place is above the seventh terrace and below
    # heaven, and it is neither; it needs a row of its own to be either.
    #
    # WHY `tier` IS 8 AND WHY THAT IS NOT AN EIGHTH TERRACE. `tier` on this
    # mountain is the position in the ascent — 1..7 are the terraces, in the
    # order Purg. XVII's theory of disordered love puts them — and the summit
    # is above all seven, so the only number that keeps the column sortable is
    # 8. It does not make this a terrace: there is no eighth terrace, nothing
    # is purged here, and EU-DS-T1..T7 stop at seven precisely because the
    # eighth thing on the mountain is not a sin. The distinction is carried by
    # `realm_code` and by the description, not by the integer.
    #
    # WHY `realm_type` IS PURGATORY. It is part of Mount Purgatory: the same
    # mountain, above the last terrace, reached by climbing and left by rising
    # to the stars. BLISS would say this is the beatitude, and it is not — the
    # Empyrean is EU_HEAVEN and Dante has not got there yet; NEUTRAL would file
    # Eden alongside the ferry crossing as another waypoint nobody is sentenced
    # to. `is_eternal` is False for the same reason it is False on the
    # terraces: nobody stays.
    #
    # NOT A DISPOSITION DESTINATION, for the reason the terraces are not:
    # `DispositionService._route_european` sends PURGATORY and RETRY verdicts
    # to the mountain, and a soul reaches the summit by finishing the climb
    # rather than by being sentenced to it.
    ("EU_EARTHLY_PARADISE", "地上乐园", "地上乐园", "The Earthly Paradise",
     "EarthlyParadise", RealmType.PURGATORY, 8,
     "The summit of Mount Purgatory, above the seventh terrace: the garden of "
     "Eden, where Matelda keeps the two streams (Purg. XXVIII). A soul that "
     "has finished the seven terraces is "
     "drawn through Lethe, which takes away the memory of its sins (Purg. "
     "XXXI), and then through Eunoè, which gives back the memory of the good "
     "it did (Purg. XXXIII); after both it is 'pure and ready to rise to the "
     "stars'. This is the only place in the European cosmology where memory is "
     "touched at all — not the nine circles, where the damned remember "
     "everything, and not heaven, which a soul reaches already washed",
     "LETHE", False, None),
    # ----------------------------------------------------------------------
    # NO LETHE IN HELL. All nine circles below carried
    # `memory_reset_mechanism="LETHE"`, which is not a small mislabelling: it
    # asserts the opposite of what the Inferno is. Dante's damned keep their
    # memories and the poem is built out of them — Francesca tells the whole
    # story of the book and the kiss (Inf. V), Ulysses his last voyage
    # (XXVI), Ugolino the tower and the door (XXXIII). Farinata states the
    # mechanics outright (Inf. X.100-108): the damned see the distant future
    # and are blind to the present, so once time stops their sight will be
    # extinguished, and memory of the world is the one connection they still
    # have to it. A soul in this hell that had drunk Lethe would not be being
    # punished; it would not know what for.
    #
    # `docs/01`'s comparison table already said 「基督教 记忆消除=否」 while
    # these rows said LETHE — one of the two had to be wrong, and it was these.
    ("EU_HELL_1ST", "第一层地狱", "幽冥边境", "First Circle - Limbo", "Limbo", RealmType.HELL, 1,
     "Limbo - virtuous pagans, unbaptized infants", "NONE", True, None),
    # name_zh was 「贪食深渊」 (gluttony) against a name_en of "Second Circle -
    # Lust". Dante's second circle is lust (Inf. V) and gluttony is the third
    # (Inf. VI), so the Chinese alias was one circle out of step with the
    # English on the same row — and EU_HELL_3RD already carries 「饕餮泥沼」,
    # so the repo named gluttony twice and lust not at all.
    ("EU_HELL_2ND", "第二层地狱", "色欲之风", "Second Circle - Lust", "Lust", RealmType.HELL, 2,
     "Lustful souls - tossed by violent winds (Dante's Inferno)", "NONE", True, None),
    ("EU_HELL_3RD", "第三层地狱", "饕餮泥沼", "Third Circle - Gluttony", "Gluttony", RealmType.HELL, 3,
     "Gluttons - lie in icy sludge beneath rain and hail", "NONE", True, None),
    ("EU_HELL_4TH", "第四层地狱", "贪婪深渊", "Fourth Circle - Greed", "Greed", RealmType.HELL, 4,
     "Avaricious and prodigal - push heavy weights (Dante)", "NONE", True, None),
    ("EU_HELL_5TH", "第五层地狱", "愤怒沼泽", "Fifth Circle - Anger", "Anger", RealmType.HELL, 5,
     "Wrathful and sullen - fight on the Stygian marsh", "NONE", True, None),
    ("EU_HELL_6TH", "第六层地狱", "异端荒原", "Sixth Circle - Heresy", "Heresy", RealmType.HELL, 6,
     "Heretics - burned in flaming tombs", "NONE", True, None),
    ("EU_HELL_7TH", "第七层地狱", "暴力之渊", "Seventh Circle - Violence", "Violence", RealmType.HELL, 7,
     "Violent against neighbors, selves, God - in three rings", "NONE", True, None),
    ("EU_HELL_8TH", "第八层地狱", "欺诈深渊", "Eighth Circle - Malebolge", "Malebolge", RealmType.HELL, 8,
     "Fraud - ten concentric fosses of Malebolge", "NONE", True, None),
    ("EU_HELL_9TH", "第九层地狱", "叛徒冰湖", "Ninth Circle - Treachery", "Treachery", RealmType.HELL, 9,
     "Traitors - frozen in the lake of Cocytus (Judas, Brutus)", "NONE", True, None),
    # --------------------------------------------------------------------
    # THE CROSSING, WHICH IS DANTE'S AND STAYS HERE.
    #
    # This row and EU_PLATO_MEADOW were added together as "two Greek places",
    # because the eleven European realms were nine Dante circles plus heaven and
    # purgatory while seven of the eleven European actors were Greek, and every
    # Greek figure had been filed into whichever Christian/Dantean row looked
    # closest: Charon in Purgatory, Cerberus in Limbo, Minos and both of his
    # fellow judges in the ninth circle, Hades in Limbo.
    #
    # The pair has since been split, because they answer to different authors.
    # The meadow is Plato's and has moved to GREEK_REALMS below with the three
    # judges who stand on it. The crossing stays EUROPEAN because the actor it
    # exists to seat stays EUROPEAN: Dante puts Charon on Acheron before the
    # first circle (Inf. III), which is the anchor this deployment's Charon row
    # cites, and the crossing is the threshold of *this* hell.
    #
    # EACH ROW NAMES ITS AUTHOR. Homer, Hesiod, Pindar, Plato and Virgil do not
    # describe the same underworld — Homer has no moral sorting at all, Plato
    # has a two-way fork, Virgil has the fullest geography — so "the Greek
    # underworld" is not a thing that can be seeded. What can be seeded is one
    # named author's account of one place, which is what these are.
    #
    # Not a disposition destination. `DispositionService` routes no verdict
    # here, deliberately: a soul is not sentenced to the ferry, it passes
    # through it.
    ("EU_ACHERON", "阿刻戎渡口", "冥河渡口", "The Crossing of Acheron", "Acheron",
     RealmType.NEUTRAL, 0,
     "The far bank of Acheron, where the dead are ferried in. Virgil, Aeneid "
     "6.295-297 ('the way leads to that Tartarean stream of Acheron'); Dante "
     "puts Charon here too, before the first circle (Inferno III), which is why "
     "this is a threshold and not a circle. Euripides, Alcestis 252-256 has the "
     "same crossing as a lake. Not a destination: nobody is sentenced here.",
     "NONE", False, None),
]

# --------------------------------------------------------------------------
# GREEK — Plato's fork, and Virgil's ground it stands on.
#
# THE BASIS IS TWO TEXTS, DIVIDED BY WHAT EACH IS ASKED FOR. Gorgias 524a
# supplies the *judgment*: who tries whom, and the two roads a verdict sends a
# soul down. Aeneid 6 supplies the *topography*: what a soul crosses to get
# there, and what the place it arrives at is like. The owner took this basis
# knowing what it costs, and the division is what keeps it a basis rather than
# a blend — the two texts contradict each other precisely where their judgment
# scenes meet, and nowhere else.
#
# WHERE THEY CONTRADICT, PLATO WINS, BECAUSE THE CONTRADICTIONS ARE ALL IN THE
# JUDGMENT. Virgil has Minos shaking an urn over the silent court (6.431-433)
# and **no Aeacus at all**; his Rhadamanthus is not a judge at a fork but the
# warden of Tartarus, hearing confessions and scourging (6.566-569). Plato has
# all three at the meadow with a stated division of labour — Rhadamanthus for
# those from Asia, Aeacus for those from Europe, Minos deciding when the other
# two are in doubt. This system seeds Plato's three and its workflow runs them
# in that order, so adopting Virgil's judgment would mean deleting one seeded
# judge and reassigning another to a role his own row denies. The topography
# carries none of that: a crossing and a walled pit are places, and Plato names
# neither, so taking them from Virgil overwrites nothing.
#
# WHAT IS STILL NOT SEEDED, AND WHY THE BASIS DID NOT CHANGE IT. Virgil's
# borderland — infants, the falsely condemned, suicides, the Fields of Mourning
# (6.426-476) — sorts souls by *manner of death*. This system records no such
# thing: `Judgment` reads a verdict and `Soul` has a death date, not a death
# kind. Those regions would be realms no router could reach, which is the shape
# `EG_AM_TYAT` was retired for. They are named in
# `tests/test_greek_sentence_basis.py` so their absence is a decision with a
# reason rather than a gap.
#
# WHY THIS TABLE EXISTS AT ALL. These rows were EUROPEAN until the split, which
# put Plato's judgment ground in the same cosmology as Dante's circles and the
# Nicene Creed's last judgment. Nothing about the row was wrong; the
# civilization column was, and it had consequences beyond taxonomy — a Greek
# realm under the European tenant is reachable only through European routing,
# and a soul in it reads the European ledger reading (culpa/poena) rather than
# the term-served one Republic X actually describes.
#
# WHY THERE ARE EXACTLY THREE ROWS, AND WHY THE OBVIOUS FOURTH IS NOT HERE.
# Gorgias 524a is one passage and it names three places: the meadow at the
# parting of the ways, and the two roads out of it — "the two ways leading, one
# to the Isles of the Blest, and the other to Tartarus". The two destinations
# are added *because that sentence names them*, and for no other reason. They
# are not the start of a map of the Greek underworld.
#
# Asphodel is the case that proves the rule and it is deliberately absent.
# Homer's ἀσφοδελὸς λειμών (Od. 11.538-540) is where Achilles walks — a hero,
# not a middling soul — and the neat Tartarus/Asphodel/Elysium triad is a modern
# textbook systematisation, not a division any ancient author makes. Adopting
# Aeneid 6 does not rescue it: Virgil has no asphodel region either. It stays out
# under both halves of the basis, which is a stronger statement than it was.
#
# THE RIVERS ARE NOW PLACED BY ONE AUTHOR RATHER THAN SYNTHESISED FROM FOUR,
# which is what changed when the basis did. This paragraph used to refuse all
# five together, on the ground that Styx, Acheron, Cocytus, Phlegethon and Lethe
# come from authors who disagree and seeding them would assert a consensus
# nobody holds. That reasoning was right about a synthesis and does not apply to
# a stated source:
#
#   * Acheron is the crossing, and it is `GR_ACHERON` below — Aeneid 6.295-297,
#     with Euripides (Alcestis 252-256) and Aristophanes (Frogs 180-270) as the
#     Greek witnesses that it is not merely a Roman import.
#   * Phlegethon rings Tartarus (Aeneid 6.550-551) and stays a sentence in
#     `GR_TARTARUS`'s description. It is a feature of that place, not a place.
#   * Styx and Cocytus are named in Aeneid 6 (6.295-297, 6.323) but nothing is
#     ferried across them or sentenced beside them in this system, so a row for
#     either would be a name with no traffic.
#   * Lethe is the live one and is deliberately left for a separate change.
#     Virgil has souls drink it before returning to bodies (6.713-715) and
#     Republic X has the same act at the river Ameles on the plain of Lethe
#     (621a-b) — so both halves of the basis agree, and Greek souls in this
#     system *are* rebirth-capable. But every Greek realm carries
#     `memory_reset_mechanism="NONE"`, and changing that is a statement about
#     the rebirth path rather than about the map. Recorded here so the next
#     reader finds a decision rather than an oversight.
#
# CODES. The meadow keeps `EU_PLATO_MEADOW`. Its code records where the row was
# first written, not what it now belongs to, and renaming a `realm_code` is not
# a cosmetic edit here: it is the join key `Reincarnation.target_realm` stores as
# text, the string `consolidate_eu_pantheon` audits against, and the identifier
# realms/0012 and realms/0015 each needed a dedicated migration to change. The
# two new rows take `GR_` because they are new and nothing points at them yet.
#
# TWO OF THE THREE ARE DISPOSITION DESTINATIONS NOW; THE MEADOW IS NOT ONE.
# This paragraph used to say that none of them was, because `DispositionService`
# had no Greek branch and "routing to Tartarus or the Isles requires a Greek
# verdict vocabulary this system does not have". It has one now, and the
# vocabulary question was answered rather than waved through: PASSED and FAILED
# are the two roads 524a names, and the two verdicts that say nothing is settled
# yet (PURGATORY, RETRY) leave the soul standing on the meadow — which is where
# 524a puts a soul that has not been sent down either road, and is a statement
# about the absence of a sorting rather than a third outcome. The meadow is
# therefore reachable without being a destination, in the sense EU_ACHERON above
# is not: nobody is sentenced to it. See `DispositionService._route_greek`.
GREEK_REALMS = [
    ("EU_PLATO_MEADOW", "岔路草原", "审判岔路", "The Meadow at the Parting of the Ways",
     "Meadow", RealmType.NEUTRAL, 0,
     "Plato, Gorgias 524a: the dead are judged in a meadow at the fork in the "
     "road, one way leading to the Isles of the Blessed and the other to "
     "Tartarus. This is a sorting point that stands BEFORE any punishment, "
     "which is the whole reason the three judges cannot be housed in a circle "
     "of Dante's hell. Both roads out of it are seeded, because the same "
     "sentence names them, and GR_ACHERON is the crossing a soul reaches it "
     "by — the one piece of the map that comes from Aeneid 6 rather than "
     "from this passage. See the basis note at the top of GREEK_REALMS.",
     "NONE", False, None),
    # `is_eternal` IS STILL FALSE ON BOTH ROADS, AND IT NOW MEANS SOMETHING.
    # It was written as a recorded limitation: Gorgias 524a says where the roads
    # go and nothing about how long anyone stays, the authors who do speak to
    # duration disagree — 525c makes the incurable everlasting examples while
    # Republic X, 615a-b sentences the unjust to a thousand-year circuit and then
    # sends them back to choose a new life (617d-620d) — and `is_eternal` is a
    # BooleanField with no third state, so False was chosen as the value that
    # asserts nothing. That note ended "do not read it as 'Plato says the
    # sentence ends'", and this paragraph supersedes that sentence rather than
    # deleting it: the owner has ruled that Republic X is the norm and 525c the
    # exception, so False now carries the norm, and it is the same value for a
    # different and stronger reason. `REBIRTH_CAPABLE_CIVILIZATIONS` and
    # `DispositionService.execute` agree with it — a Greek soul leaves an
    # executed disposition REINCARNATING.
    #
    # WHAT THE COLUMN STILL CANNOT CARRY IS THE EXCEPTION, AND THAT IS NOT A
    # BOOLEAN'S FAULT. In 525c the everlastingness belongs to the *soul* — to
    # whether its wrongs are curable — not to the place; the same Tartarus holds
    # both kinds. A per-soul column for it already exists (`Disposition
    # .is_eternal`, which `create_from_judgment` copies off this flag), so the
    # shape is not missing. The input is: nothing in this system distinguishes
    # an incurable soul from a curable one, and no widening of this field would
    # supply it. Changing this to True would make every Greek soul sent left an
    # ἀνίατος, which is the smaller of the two populations and the one Plato
    # treats as remarkable. See `DispositionService._route_greek` and
    # tests/test_greek_sentence_basis.py.
    # THE CROSSING, AND WHY IT IS A SECOND ROW RATHER THAN A MOVE.
    # `EU_ACHERON` already exists and Charon stands on it — but realms/0018 says
    # in as many words why that row stays EUROPEAN: "every anchor those rows
    # cite is Dante's ... they are Greek figures Dante borrowed, and what this
    # database holds of them is the borrowing." That is correct and this row
    # does not disturb it. It is the same move the same migration made for the
    # judges: Plato's Minos was written as a *new* GREEK row beside Dante's
    # EUROPEAN one, because the two are different offices in different
    # underworlds. This is that, for the ferryman.
    #
    # A crossing is topography, so it comes from Aeneid 6.295-297 under the
    # division stated at the top of this table — and it is not a Roman import
    # smuggled in: Euripides has Charon calling from the lake (Alcestis
    # 252-256) and Aristophanes has him working the oar (Frogs 180-270). What
    # Virgil supplies is the *placement* the Greek witnesses leave vague.
    #
    # NOT A DESTINATION, AND NOT AN OUTCOME. Nobody is sentenced here — the
    # crossing happens before the judging, which is why `_route_greek` does not
    # name it and why it carries tier 0 alongside the meadow. It is reachable in
    # the sense a threshold is: a soul passes through, and no verdict puts it
    # there.
    ("GR_ACHERON", "阿刻戎渡口", "冥河渡口", "The Crossing of Acheron", "Acheron",
     RealmType.NEUTRAL, 0,
     "Where the dead are ferried into the underworld, before any judging. "
     "Virgil, Aeneid 6.295-297 places the crossing on Acheron and 6.298-304 "
     "puts Charon at it; Euripides (Alcestis 252-256) has Charon summoning from "
     "the lake and Aristophanes (Frogs 180-270) has him rowing, so the ferryman "
     "is Greek and it is his position in the map that Virgil fixes. A separate "
     "EUROPEAN row, EU_ACHERON, carries Dante's crossing (Inferno III) with "
     "Dante's Charon on it — the same figure under a different poem, kept apart "
     "for the reason realms/0018 keeps Dante's Minos apart from Plato's. "
     "Nobody is sentenced here.",
     "NONE", False, None),
     # LETHE. Both roads out of the fork end in rebirth — `is_eternal` is False
     # on each and GREEK is in REBIRTH_CAPABLE_CIVILIZATIONS — and both halves
     # of this table's basis put a forgetting-drink on that path: Republic X
     # 621a-b camps the souls by the river Ameles on the plain of Lethe before
     # they return, and Aeneid 6.713-715 has them at Lethe before going back to
     # bodies. The two texts agree here, so this is the one place the basis
     # needs no division rule.
     #
     # It is the destination that carries it, following the twelve Chinese
     # realms: 孟婆汤 is on every court a soul can be sentenced to and NONE on
     # DY_01_HEAVEN, the one that does not send anyone back. Same shape here —
     # the meadow and the crossing stay NONE because nobody is sentenced to
     # either, so no rebirth follows from them.
    ("GR_ISLES_OF_THE_BLESSED", "至福岛", "至福岛", "The Isles of the Blessed",
     "IslesOfTheBlest", RealmType.BLISS, 1,
     "Plato, Gorgias 524a: one of the two roads out of the meadow, taken by "
     "those who have lived justly. Pindar, Olympian 2 describes the same "
     "destination as requiring three lives without injustice on either side of "
     "the grave, with Rhadamanthys judging at Kronos' side — a harder entry "
     "condition than the Gorgias states, and one this row does not model. Not "
     "Homer's Elysian plain (Od. 4.563-568), which is an exemption from death "
     "granted to particular men rather than a reward for a life.",
     "LETHE", False, None),
     # LETHE, for the reason given on GR_ISLES_OF_THE_BLESSED above. Republic X
     # is explicit that the road to punishment also returns: 615a-b sets the
     # thousand-year term and 617d-620d has the same souls choosing new lives
     # afterwards. A Tartarus that reset no memory would be asserting the 525c
     # exception — the incurable, who stay — as the norm, which this table's
     # `is_eternal=False` already refuses.
    ("GR_TARTARUS", "塔尔塔罗斯", "塔尔塔罗斯", "Tartarus", "Tartaros",
     RealmType.HELL, 1,
     "Plato, Gorgias 524a: the other road out of the meadow — that is what "
     "sends a soul here, and it is the half of this row Virgil does not touch. "
     "The place itself is Virgil's (Aeneid 6.548-551): walled three times "
     "about, ringed by the Phlegethon, its gate held by Tisiphone. What this "
     "row still refuses is Virgil's 6.566-569, where Rhadamanthus presides over "
     "it and scourges — because Rhadamanthus is seeded next door as a judge at "
     "the fork with Plato's division of labour, and one actor cannot hold both "
     "offices. That refusal is the basis rule doing its work rather than an "
     "exception to it: the contradiction is in the judgment, so Plato keeps it. "
     "Hesiod (Theogony 720ff) is a third account — the pit the Titans are "
     "imprisoned in, not a destination for human dead — and is not seeded.",
     "LETHE", False, None),
]

# child realm_code -> the realm it is a part of. `Realm.parent_realm` has
# existed since realms/0001 and has been serialized and select_related the whole
# time, with nothing in the seed data ever using it: the ten courts are siblings,
# the nine circles are siblings, and no seeded row was a part of another.
#
# The seven terraces are. Dante's Purgatory is one mountain — Ante-Purgatory,
# seven terraces, Earthly Paradise — and flattening it into eight peers would
# lose the one relation that says the terraces are stages of a single ascent and
# that the summit is above all seven rather than beside them. Kept as a separate
# map rather than a twelfth column on the realm tuples so that the eleven rows
# with no parent do not each carry a `None`.
REALM_PARENTS = {
    "EU_PURGATORY_T1_PRIDE": "EU_PURGATORY",
    "EU_PURGATORY_T2_ENVY": "EU_PURGATORY",
    "EU_PURGATORY_T3_WRATH": "EU_PURGATORY",
    "EU_PURGATORY_T4_SLOTH": "EU_PURGATORY",
    "EU_PURGATORY_T5_AVARICE": "EU_PURGATORY",
    "EU_PURGATORY_T6_GLUTTONY": "EU_PURGATORY",
    "EU_PURGATORY_T7_LUST": "EU_PURGATORY",
    # The summit is the eighth part of the mountain and hangs off it the same
    # way the seven terraces do. Its `tier` (8) is what says it is above them;
    # `parent_realm` is what says it is on the same mountain rather than beside
    # it. Both statements are needed — a summit that is only "tier 8" would sort
    # correctly and belong nowhere.
    "EU_EARTHLY_PARADISE": "EU_PURGATORY",
}

# THE GATES OF THE DUAT ARE THE DEAD PERSON'S, NOT RA'S.
#
# What was here: `EG_DUAT_ENTRY` described as where the "soul begins the night
# journey", and — in `docs/` and in the org tree's `DUAT_GATES` (十二门) — a
# twelve-gate structure. **The night journey is Ra's.** The twelve gates belong
# to the *Book of Gates*, and the twelve hours belong to the *Amduat*: two
# different books, both about the sun god's nightly transit, and neither about
# the deceased. `docs/lore-verification/verify-egyptian.md` §4.2 records the
# precise relationship and the reason the two must not be interleaved — the
# Book of Gates puts a named gate at each boundary and the Amduat gives each
# hour a city and a door, so filing one book's names under the other's labels is
# a splice that reads as data and is not.
#
# The org node has since been renamed to 门之书十二门 — it does model a
# twelve-gate structure, and that structure is the Book of Gates', so the name
# now says which book rather than implying the deceased walks it. Its `code`
# stays `DUAT_GATES`, being the key `init_organizations` matches on.
#
# This application models a dead person being judged. The Book of the Dead has
# its own gate corpus, and it is the corpus the forty-two assessors already come
# from (§4.4, §9.4):
#
#   BD 144 and BD 147 (variants of one text) — "knowing the names of the keepers
#     of the seven approaches", the ꜥrrwt-gates of the house of Osiris in the
#     field of reeds. Seven gates, three keepers each (iry-ꜥꜣ doorkeeper, sꜣw
#     watcher, smi herald) = twenty-one named beings.
#   BD 145 and BD 146 (variants of one text) — "start of the gateways of the
#     Field of Reeds of the domain of Osiris", the sbḫt-portals. Twenty-one
#     portals, one demon each.
#
# TWO SERIES, NOT ONE RUN OF TWENTY-EIGHT. The seven ꜥrrwt and the twenty-one
# sbḫt are different words for different gates in different chapters, and the
# only thing that would make them one numbered sequence is somebody needing a
# tidy list. They are two rows, and they carry the same `tier` — the chapter
# titles put both at the entrance to Osiris's domain in the field of reeds, and
# no witness obtained here gives an order *between* the two texts. Equal tier is
# that statement; 3 and 4 would have been an invented sequence.
#
# WHY THERE ARE TWO ROWS AND NOT TWENTY-EIGHT — the part most likely to be
# "fixed" by someone reading this as incomplete. **Not one gate of either series
# is seeded individually, because no transcription of any of their names has
# been obtained.** What the evidence in `docs/lore-verification/` actually
# contains for BD 144-147 is the chapter titles, the counts and the keeper
# roles, from UCL Digital Egypt's chapter list (Quirke, 2002) — an academic
# source that was read. It does **not** contain the seven gate names, the
# twenty-one keepers, or the twenty-one portal demons; Budge's *Theban
# Recension* vol. II is named there as where they are, and the volume was read
# for BD 125 (the assessors' towns and clauses, pp. 366-371), not for 144-147.
# The order of the series has no second witness either, and the assessor round
# proved that matters: Ani and Nebseni disagree on the sequence of the
# forty-two, so a row called "the fourth gate" would be asserting a position
# nothing here can support.
#
# `README.md` §1 of the verification set states the rule this obeys: completing
# these lists is the one certain way to get them wrong. Twenty-eight rows named
# only by their ordinal would be that mistake in its politest form — they would
# look like data, resolve as FKs, and say nothing. Two frameworks were once
# filled in this way and had to be withdrawn whole in 8308204.
#
# WHEN THE TRANSCRIPTIONS ARE OBTAINED, the rows go in with their names and
# their citation, exactly as the forty-two assessors did, and
# `tests/test_duat_gates.py::test_a_seeded_duat_gate_names_its_source_edition`
# is what makes a numbered gate arrive with its source rather than without one.
EGYPTIAN_REALMS = [
    ("EG_DUAT_ENTRY", "杜阿特入口", "杜阿特之门", "Gate of Duat", "DuatEntry", RealmType.PURGATORY, 1,
     "Entry to the underworld Duat, where the dead person's own passage west begins. "
     "What this row records is the start of a soul's journey and nothing else; the gates "
     "that passage then meets are seeded separately as EG_SEVEN_ARRWT and "
     "EG_TWENTYONE_SEBKHET, which carry their chapters and their edition.",
     "SPELL", False, None),
    ("EG_HALL_TWO_TRUTHS", "真理殿堂", "两真之殿", "Hall of Two Truths", "HallTwoTruths", RealmType.PURGATORY, 2,
     "The weighing of the heart against Ma'at's feather", "SPELL", False, None),
    ("EG_SEVEN_ARRWT", "七道通路", "七道通路", "The Seven Approaches to the House of Osiris",
     "SevenArrwt", RealmType.PURGATORY, 3,
     "Book of the Dead 144 and 147, two variants of one text: 'knowing the names of the "
     "keepers of the seven approaches' — the ꜥrrwt-gates of the house of Osiris in the "
     "field of reeds. Seven gates, three keepers apiece (iry-ꜥꜣ doorkeeper, sꜣw watcher, "
     "smi herald), twenty-one named beings in all. Chapter title and counts from UCL "
     "Digital Egypt, Book of the Dead chapters by number (Quirke, 2002); the text is in "
     "Budge, The Book of the Dead: An English Translation of the Chapters, Hymns, etc., of "
     "the Theban Recension, vol. II — the volume already cited for the forty-two assessors' "
     "towns and clauses. This row is the set, not a member of it: no individual gate and no "
     "individual keeper is seeded, because no transcription of their names has been "
     "obtained and the order of the series has no second witness.",
     "SPELL", False, None),
    ("EG_TWENTYONE_SEBKHET", "二十一道门户", "二十一道门户",
     "The Twenty-One Portals of the Field of Reeds", "TwentyOneSebkhet", RealmType.PURGATORY, 3,
     "Book of the Dead 145 and 146, two variants of one text: 'start of the gateways of the "
     "Field of Reeds of the domain of Osiris' — the sbḫt-portals, twenty-one of them, one "
     "demon to each. A different series from the seven ꜥrrwt, in a different pair of "
     "chapters, and not a continuation of their numbering. Chapter titles from UCL "
     "Digital Egypt, Book of the Dead chapters by number (Quirke, 2002); the text is in "
     "Budge, Theban Recension, vol. II, the same volume the forty-two assessors come from. "
     "As with the seven, no individual portal and no individual demon is seeded: the names "
     "have not been transcribed here and inventing them is how this repository has gone "
     "wrong before.",
     "SPELL", False, None),
    ("EG_AARU", "阿鲁之地", "芦苇之地", "Field of Reeds (Aaru)", "Aaru", RealmType.BLISS, 1,
     "Egyptian paradise - eternal life in the Field of Reeds beyond Duat", "NONE", True, None),
    # EG_AM_TYAT IS GONE, AND IS NOT COMING BACK.
    #
    # The row read ("EG_AM_TYAT", "阿姆·特亚特", "芦苇之地边境", "Path of Amtyat",
    # NEUTRAL, tier 3, "Border realm before the final judgment"). "Amtyat" is
    # not an Egyptian place. It is absent from Budge's Book of the Dead
    # glossary, from Budge's Egyptian Heaven and Hell vol. II, from UCL Digital
    # Egypt, from museum records and from general search; there is no "path of
    # Amtyat" and no border strip before judgment anywhere in the corpus. The
    # two plausible origins are Am-Tuat (Imy-Dwꜣt — the *title of a book*, the
    # Amduat) and Amentet (Imntt, "the West", which is the whole west and not a
    # frontier), i.e. a book title or a direction mistaken for a place.
    #
    # It is deleted rather than renamed. realms/0013 tombstones the row on
    # databases that already have it; tests/test_seed_entrypoint.py records the
    # removal as deliberate so it does not read as a dropped row.
    #
    # The attested gates now exist: EG_SEVEN_ARRWT and EG_TWENTYONE_SEBKHET,
    # above. One thing they are not is a drop-in for this row's slot. Amtyat was
    # a "border realm before the final judgment" and the chapter titles put both
    # gate corpora at the *entrance to the house of Osiris in the field of
    # reeds*, i.e. after the weighing and not before it, which is why they carry
    # tier 3 and the Hall keeps tier 2. §3.4 of the verification set floated the
    # seven ꜥrrwt as a pre-judgment waypoint; that was a suggestion about the
    # state machine's shape, and the sources are what decided against it.
    # If a waypoint before the Hall is ever genuinely needed, it needs a source
    # — inventing one is what produced this row.
    #
    # EG_ANNIHILATION IS AN OUTCOME, NOT AN ADDRESS.
    #
    # It used to be 「吞噬者 / 阿米特之地 / Devourer's Realm」 with Ammit living
    # in it, which asserts three things the sources do not: that there is a
    # place, that Ammit is in it, and that it is a hell — somewhere a soul *is*
    # rather than the end of the soul. Being eaten by Ammit is the second
    # death: the heart is destroyed and the person ceases to exist. There is no
    # damned population and nowhere for it to be. Ammit herself stands at the
    # balance in the Hall, which is where every standard vignette draws her
    # (Budge, Papyrus of Ani, Plate III; BM EA 9901), and she has moved back
    # there in EGYPTIAN_ACTORS below.
    #
    # THE CODE WAS `EG_DEVOURER` AND IS NOW `EG_ANNIHILATION`. 79dee57 corrected
    # what this row claims and deliberately left the code alone, because the
    # string was a live identifier in three places at once — `DispositionService`
    # routes every failed Egyptian heart to it, existing databases record it as
    # dispositions' destination, and the frontend timeline hard-coded
    # `realm_code === "EG_DEVOURER"` as its one signal for "this soul was
    # annihilated" — so renaming it in any single place would have silently
    # stopped the annihilation state rendering.
    #
    # All three moved together:
    #   * `DispositionService.EG_ANNIHILATION` (apps/disposition/services.py),
    #   * this row, plus realms/0015_rename_devourer_to_annihilation for
    #     databases that already hold the old code. The rename is in place, so
    #     `Disposition.destination_realm` and `Actor.realm` follow the row
    #     untouched; `Reincarnation.target_realm` is a CharField holding a
    #     realm_code and is rewritten explicitly, the same way realms/0012 had
    #     to rewrite it for the ten courts,
    #   * `ANNIHILATION_REALM_CODE` in frontend/src/lib/realmCodes.ts, which the
    #     timeline now imports instead of spelling the string itself.
    #
    # tests/test_annihilation_realm_code.py reads that TypeScript module from
    # the backend suite and compares it against the constant, so the two sides
    # cannot drift apart again without a red test.
    #
    # realm_type stays HELL for the same reason and under protest: of
    # {HELL, PURGATORY, BLISS, NEUTRAL} none means "ceased to exist", and
    # NEUTRAL ("between") would be a worse lie than HELL — it would file
    # annihilation next to the ferry crossing as another waypoint.
    ("EG_ANNIHILATION", "第二次死亡", "湮灭", "Second Death (annihilation by Ammit)", "AmMit",
     RealmType.HELL, 10,
     "Not a place and not a residence: the outcome recorded when the heart is "
     "heavier than the feather and Ammit devours it. Egyptian sources call this "
     "the second death — the person ceases to exist, is not punished, and does "
     "not go anywhere. Ammit is seeded in EG_HALL_TWO_TRUTHS, where she is drawn "
     "beside the balance (Budge, Papyrus of Ani, Plate III; BM EA 9901). The row "
     "keeps its primary key across the rename from EG_DEVOURER, so dispositions "
     "already recorded against it still resolve.",
     "SPELL", True, None),
]
