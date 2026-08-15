"""Realm tables for the three cosmologies, and the one parent/child link.

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
    ("EU_HEAVEN", "天堂", "上帝之国", "Kingdom of Heaven", "Heaven", RealmType.BLISS, 1,
     "Eternal paradise - the highest bliss realm in Christian tradition", "LETHE", True, None),
    # The mountain as a whole. It is a container now — the seven terraces below
    # hang off this row by `parent_realm` (see REALM_PARENTS) — so its
    # description says what the container holds instead of describing a single
    # undifferentiated waiting room.
    ("EU_PURGATORY", "炼狱", "涤罪所", "Purgatory", "Purgatory", RealmType.PURGATORY, 1,
     "Mount Purgatory entire: Ante-Purgatory (Purg. I-IX), the seven terraces "
     "that are its sub-realms, and the Earthly Paradise at the summit where "
     "Lethe and Eunoè run (Purg. XXVIII, XXXI, XXXIII). Every soul admitted "
     "here is already saved; the suffering is remedial and it ends. The memory "
     "reset happens at the summit, after the seventh terrace — not on the way up",
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
    # to it, Lethe stands on it, and the mountain is one place with parts, not
    # seven places that happen to be near each other. So these seven point at it
    # through `Realm.parent_realm` — the field's first use in seeded data.
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
    # after the seventh terrace. These rows say NONE.
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
    ("EU_HELL_1ST", "第一层地狱", "幽冥边境", "First Circle - Limbo", "Limbo", RealmType.HELL, 1,
     "Limbo - virtuous pagans, unbaptized infants", "LETHE", True, None),
    # name_zh was 「贪食深渊」 (gluttony) against a name_en of "Second Circle -
    # Lust". Dante's second circle is lust (Inf. V) and gluttony is the third
    # (Inf. VI), so the Chinese alias was one circle out of step with the
    # English on the same row — and EU_HELL_3RD already carries 「饕餮泥沼」,
    # so the repo named gluttony twice and lust not at all.
    ("EU_HELL_2ND", "第二层地狱", "色欲之风", "Second Circle - Lust", "Lust", RealmType.HELL, 2,
     "Lustful souls - tossed by violent winds (Dante's Inferno)", "LETHE", True, None),
    ("EU_HELL_3RD", "第三层地狱", "饕餮泥沼", "Third Circle - Gluttony", "Gluttony", RealmType.HELL, 3,
     "Gluttons - lie in icy sludge beneath rain and hail", "LETHE", True, None),
    ("EU_HELL_4TH", "第四层地狱", "贪婪深渊", "Fourth Circle - Greed", "Greed", RealmType.HELL, 4,
     "Avaricious and prodigal - push heavy weights (Dante)", "LETHE", True, None),
    ("EU_HELL_5TH", "第五层地狱", "愤怒沼泽", "Fifth Circle - Anger", "Anger", RealmType.HELL, 5,
     "Wrathful and sullen - fight on the Stygian marsh", "LETHE", True, None),
    ("EU_HELL_6TH", "第六层地狱", "异端荒原", "Sixth Circle - Heresy", "Heresy", RealmType.HELL, 6,
     "Heretics - burned in flaming tombs", "LETHE", True, None),
    ("EU_HELL_7TH", "第七层地狱", "暴力之渊", "Seventh Circle - Violence", "Violence", RealmType.HELL, 7,
     "Violent against neighbors, selves, God - in three rings", "LETHE", True, None),
    ("EU_HELL_8TH", "第八层地狱", "欺诈深渊", "Eighth Circle - Malebolge", "Malebolge", RealmType.HELL, 8,
     "Fraud - ten concentric fosses of Malebolge", "LETHE", True, None),
    ("EU_HELL_9TH", "第九层地狱", "叛徒冰湖", "Ninth Circle - Treachery", "Treachery", RealmType.HELL, 9,
     "Traitors - frozen in the lake of Cocytus (Judas, Brutus)", "LETHE", True, None),
    # --------------------------------------------------------------------
    # TWO GREEK PLACES, ADDED BECAUSE THE GREEK CAST HAD NOWHERE TO STAND.
    #
    # Until now the eleven European realms were nine Dante circles plus heaven
    # and purgatory — every one of them Christian or Dantean — while seven of
    # the eleven European actors are Greek. There was no Greek place in the
    # system at all, so each Greek figure had been filed into whichever
    # Christian/Dantean row looked closest, and every one of those placements
    # was wrong: Charon in Purgatory, Cerberus in Limbo, Minos and both of his
    # fellow judges in the ninth circle, Hades in Limbo.
    #
    # The fix is not to redistribute them among Dante's circles. Dante uses
    # exactly one of these figures as a judge (Minos, Inf. V) and does not use
    # Aeacus or Rhadamanthus at all, so any circle they were given would be an
    # invention. These two rows are the smallest set of *attested* Greek places
    # that lets the cast be placed by a source instead of by proximity.
    #
    # EACH ROW NAMES ITS AUTHOR. Homer, Hesiod, Pindar, Plato and Virgil do not
    # describe the same underworld — Homer has no moral sorting at all, Plato
    # has a two-way fork, Virgil has the fullest geography — so "the Greek
    # underworld" is not a thing that can be seeded. What can be seeded is one
    # named author's account of one place, which is what these are. Do not add
    # a third row on the assumption that these two are the start of a complete
    # map; see docs/lore-verification/verify-greek.md §5 for the list of what
    # is missing and why completing it is a research task, not a data entry.
    #
    # Neither is a disposition destination. `DispositionService` routes no
    # verdict to either, deliberately: a soul is not sentenced to the ferry or
    # to the fork, it passes through them.
    ("EU_ACHERON", "阿刻戎渡口", "冥河渡口", "The Crossing of Acheron", "Acheron",
     RealmType.NEUTRAL, 0,
     "The far bank of Acheron, where the dead are ferried in. Virgil, Aeneid "
     "6.295-297 ('the way leads to that Tartarean stream of Acheron'); Dante "
     "puts Charon here too, before the first circle (Inferno III), which is why "
     "this is a threshold and not a circle. Euripides, Alcestis 252-256 has the "
     "same crossing as a lake. Not a destination: nobody is sentenced here.",
     "NONE", False, None),
    ("EU_PLATO_MEADOW", "岔路草原", "审判岔路", "The Meadow at the Parting of the Ways",
     "Meadow", RealmType.NEUTRAL, 0,
     "Plato, Gorgias 524a: the dead are judged in a meadow at the fork in the "
     "road, one way leading to the Isles of the Blessed and the other to "
     "Tartarus. This is a sorting point that stands BEFORE any punishment, "
     "which is the whole reason the three judges cannot be housed in a circle "
     "of Dante's hell. Neither destination the fork leads to is modelled here, "
     "and neither is invented: this row is the judgment ground only.",
     "NONE", False, None),
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
}

EGYPTIAN_REALMS = [
    ("EG_DUAT_ENTRY", "杜阿特入口", "杜阿特之门", "Gate of Duat", "DuatEntry", RealmType.PURGATORY, 1,
     "Entry to the underworld Duat - soul begins the night journey", "SPELL", False, None),
    ("EG_HALL_TWO_TRUTHS", "真理殿堂", "两真之殿", "Hall of Two Truths", "HallTwoTruths", RealmType.PURGATORY, 2,
     "The weighing of the heart against Ma'at's feather", "SPELL", False, None),
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
    # If the disposition state machine ever does need a waypoint between the
    # gate and the hall, the attested filler is the seven ꜥrrwt-gates of BD
    # 144/147 — literally the approaches to the house of Osiris, same scripture
    # and same edition as the forty-two assessors below. Do not invent a second
    # transit realm; inventing one is what produced this row.
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
