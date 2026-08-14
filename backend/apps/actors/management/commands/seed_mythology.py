"""
Idempotent seeder for the three civilizations' mythology reference data.

Why this exists
---------------
Every Realm and Actor in this system — the Ten Courts of Diyu, Dante's nine
circles, the Hall of Two Truths — used to live only in
``backend/scripts/seed_chinese_data.py``, a standalone script somebody had to
remember to run by hand. No fixtures directory, no data migration carries any
of it: the per-app data migrations are all RBAC and menu rows. A fresh clone
therefore came up with an empty cosmology, and so did CI. Anything that
depends on this data existing (judgment routing, realm pickers, cross-tenant
dispatch) had nothing to stand on.

This command is that script turned into a re-runnable entry point, plus the
tenant assignment the script declared helpers for but never actually called.

Design notes
------------
* **Match keys.** Realms match on ``realm_code`` (unique, stable). Actors have
  no code column, so they match on ``(civilization, name)`` — the same pair the
  ``unique_actor_tenant_civ_name`` constraint uses, minus the tenant (which
  this command is the thing that fills in). Names are never used to *infer* a
  civilization here: each block below states its civilization explicitly.
  Keyword-sniffing an actor's name is what mis-tagged Ma'at, Pluto and Lethe as
  CHINESE and spawned the duplicate rows ``fix_actor_civilization`` exists to
  clean up.

* **Create-only by default.** Two sibling commands deliberately edit these
  same rows after seeding — ``fix_actor_civilization`` (civilization repairs +
  dedupe, Ma'at/Maat spelling merge) and ``consolidate_eu_pantheon``
  (Pluto/Hades merge, opt-in Norse purge). If seeding overwrote existing rows
  every run, the seeder and those commands would take turns undoing each
  other. So the default is get_or_create semantics; pass ``--update`` when you
  explicitly want the seed values to win.

* **Soft-deleted rows are left alone.** A row that was soft-deleted (e.g. Pluto,
  merged into Hades) is reported and skipped, never resurrected and never
  duplicated — re-creating it would collide with the unique constraint anyway,
  since that constraint does not exclude deleted rows.

Usage::

    python manage.py seed_mythology                        # all three, create missing
    python manage.py seed_mythology --civilization=chinese  # one civilization
    python manage.py seed_mythology --dry-run               # print the plan, write nothing
    python manage.py seed_mythology --update                # also refresh existing rows
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.actors.models import Actor, ActorRole
from apps.judgment.models import Statute
from apps.realms.models import Realm, RealmType
from apps.souls.models import CIVILIZATION_TENANT, Civilization
from apps.tenants.models import Tenant

# --------------------------------------------------------------------------
# Tenants — the administrative record each cosmology's rows are filed under.
# Descriptions are owned by `manage.py seed_tenants`; only the fields this
# command needs to guarantee are set here.
# --------------------------------------------------------------------------
TENANTS = {
    "CN_DIYU": "Chinese Afterlife",
    "EU_HEAVEN_HELL": "European Afterlife",
    "EG_DUAT": "Egyptian Afterlife",
}

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
    # EG_DEVOURER IS AN OUTCOME, NOT AN ADDRESS.
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
    # WHY THE CODE STAYS `EG_DEVOURER` WHEN THE MEANING HAS CHANGED. The
    # obvious follow-through is to rename it EG_ANNIHILATION. The code is a
    # live identifier, not a label: `DispositionService` routes every failed
    # Egyptian heart to this string, executed dispositions in existing
    # databases record it as their destination, and
    # frontend/src/components/souls/SoulLifecycleTimeline.tsx hard-codes
    # `realm_code === "EG_DEVOURER"` as the one signal it has for "this soul was
    # annihilated". Renaming the code is therefore NOT the one-line change in
    # disposition/services.py it looks like — it is that line plus a migration
    # plus a frontend change that has to land in the same deploy, or the
    # annihilation state silently stops rendering. The rename is a coordinated
    # follow-up; correcting what the row *claims* is not, and is done here.
    #
    # realm_type stays HELL for the same reason and under protest: of
    # {HELL, PURGATORY, BLISS, NEUTRAL} none means "ceased to exist", and
    # NEUTRAL ("between") would be a worse lie than HELL — it would file
    # annihilation next to the ferry crossing as another waypoint.
    ("EG_DEVOURER", "第二次死亡", "湮灭", "Second Death (annihilation by Ammit)", "AmMit",
     RealmType.HELL, 10,
     "Not a place and not a residence: the outcome recorded when the heart is "
     "heavier than the feather and Ammit devours it. Egyptian sources call this "
     "the second death — the person ceases to exist, is not punished, and does "
     "not go anywhere. Ammit is seeded in EG_HALL_TWO_TRUTHS, where she is drawn "
     "beside the balance (Budge, Papyrus of Ani, Plate III; BM EA 9901). The "
     "realm_code is retained as a stable identifier for dispositions already "
     "recorded against it.",
     "SPELL", True, None),
]

# --------------------------------------------------------------------------
# Actors
# Fields: name, name_zh, name_en, name_egy, role, realm_code,
#         title, title_zh, title_en, title_egy, description
#
# COURT NUMBERING — canon, decided. The standard 十殿阎罗 ordering is the one
# source of truth for which king sits in which court:
#
#   1 秦广王  2 楚江王  3 宋帝王  4 五官王  5 阎罗王
#   6 卞城王  7 泰山王  8 都市王  9 平等王  10 转轮王
#
# Two other places in this repo already spell it that way — apps/org's
# init_organizations (DIYU_05=阎罗王, DIYU_09=平等王, DIYU_10=转轮王) and
# apps/workflow/services.py's 十殿审判流程 template. This file and
# seed_chinese_data.py were the two that disagreed (阎罗王 as 十殿阎王, 转轮王 as
# 第九殿, 平等王 as 第十殿); they now match. A third opinion used to live in
# populate_chinese_actors, which rewrote the titles at runtime — that command
# is gone (see the judicial-personnel note below).
# tests/test_seed_mythology.py::test_ten_kings_carry_their_canonical_court_number
# locks the mapping so it cannot drift again.
#
# The realm a king sits in is no longer a separate axis. It used to be — there
# were fewer seeded realms than courts, so 秦广王 and 楚江王 shared one row and
# the court number lived in the title only, which is how DY_10_YAMA came to be
# called 第十殿 while its resident 阎罗王 is the fifth court. CHINESE_REALMS now
# carries one DY_COURT_NN row per court, each king sits in his own, and
# test_seed_mythology asserts king N is in DY_COURT_NN and nowhere else.
# --------------------------------------------------------------------------
CHINESE_ACTORS = [
    ("阎罗王", "阎罗王", "Yama King", "Yanluo", ActorRole.JUDGE, "DY_COURT_05_YANLUO",
     "第五殿阎罗王", "第五殿阎罗王", "Fifth Court Yama", "Yanluo",
     "Fifth court judge - the best-known of the ten kings, tries the gravest sins"),
    ("秦广王", "秦广王", "Qinguang Wang", "Qinguang", ActorRole.JUDGE, "DY_COURT_01_QINGUANG",
     "第一殿秦广王", "第一殿秦广王", "First Court Qinguang", "Qinguang",
     "First court judge - evaluates the Ledger of Life and Death"),
    # FOUR OF THESE DESCRIPTIONS CONTRADICTED THE COURT THEY SIT IN. The realm
    # rows above were right in every case and the actor rows had never been
    # updated to match, so the same court described itself two ways depending
    # on which table you read. 楚江王 "awards merit for good deeds" against a
    # 活大地狱; 卞城王 "manages reincarnation scheduling", which is the *tenth*
    # king's work and the one thing the sixth court does not do; 都市王 "judge
    # of merchants and craftsmen", reading 「都市」 as a marketplace when it is
    # the capital and his docket is unfilial conduct; 泰山王 "judge of the
    # mountains", which borrows 泰山府君 and is not what 《玉历》 gives the
    # seventh court. All four now say what their own realm row says.
    ("楚江王", "楚江王", "Chujiang Wang", "Chujiang", ActorRole.JUDGE, "DY_COURT_02_CHUJIANG",
     "第二殿楚江王", "第二殿楚江王", "Second Court Chujiang", "Chujiang",
     "Second court judge - presides over 活大地狱, the mildest punishment court: "
     "abduction, appropriating what belongs to others, maiming"),
    ("宋帝王", "宋帝王", "Songdi Wang", "Songdi", ActorRole.JUDGE, "DY_COURT_03_SONGDI",
     "第三殿宋帝王", "第三殿宋帝王", "Third Court Songdi", "Songdi",
     "Third court judge - presides over 黑绳大地狱: defying one's elders, "
     "inciting litigation, betraying a trust"),
    ("五官王", "五官王", "Wuguan Wang", "Wuguan", ActorRole.JUDGE, "DY_COURT_04_WUGUAN",
     "第四殿五官王", "第四殿五官王", "Fourth Court Wuguan", "Wuguan",
     "Fourth court judge - chief accountant of deeds"),
    ("卞城王", "卞城王", "Biancheng Wang", "Biancheng", ActorRole.JUDGE, "DY_COURT_06_BIANCHENG",
     "第六殿卞城王", "第六殿卞城王", "Sixth Court Biancheng", "Biancheng",
     "Sixth court judge - presides over 大叫唤大地狱: sacrilege against images "
     "and scriptures, irreverence toward heaven and earth"),
    ("泰山王", "泰山王", "Taishan Wang", "Taishan", ActorRole.JUDGE, "DY_COURT_07_TAISHAN",
     "第七殿泰山王", "第七殿泰山王", "Seventh Court Taishan", "Taishan",
     "Seventh court judge - presides over 热恼大地狱: taking bones for medicine, "
     "and the scattering of kin from one another"),
    ("都市王", "都市王", "Dushi Wang", "Dushi", ActorRole.JUDGE, "DY_COURT_08_DUSHI",
     "第八殿都市王", "第八殿都市王", "Eighth Court Dushi", "Dushi",
     "Eighth court judge - presides over 大热恼大地狱: unfilial conduct, the "
     "parent left unkept in life and unburied in death. 「都市」 is the capital, "
     "not a marketplace"),
    ("平等王", "平等王", "Pingdeng Wang", "Pingdeng", ActorRole.JUDGE, "DY_COURT_09_PINGDENG",
     "第九殿平等王", "第九殿平等王", "Ninth Court Pingdeng", "Pingdeng",
     "Ninth court - embodies perfect impartial justice"),
    ("转轮王", "转轮王", "Zhuanlun Wang", "Zhuanlun", ActorRole.JUDGE, "DY_COURT_10_ZHUANLUN",
     "第十殿转轮王", "第十殿转轮王", "Tenth Court Zhuanlun", "Zhuanlun",
     "Tenth court - the wheel of rebirth; assigns fate for the next life"),
    # 孟婆 MOVED FROM THE HOLDING PEN TO THE TENTH COURT. 《玉历宝钞》
    # 「孟婆神」 places her 醧忘台 「居第十殿，冥王殿前六桥之外」 — the tenth
    # court, outside the six bridges before the king's hall — and the broth is
    # drunk after sentence, on the way to the next life. Seating her at
    # DY_00_PURGATORY had her erasing a soul's memory of the life it was about
    # to be tried for. DY_COURT_10_ZHUANLUN's own description already said this
    # ("the broth of forgetting drunk"), so the two tables disagreed about the
    # same act.
    ("孟婆", "孟婆", "Meng Po", "Mengpo", ActorRole.CONDUIT, "DY_COURT_10_ZHUANLUN",
     "孟婆", "孟婆", "Meng Po", "Mengpo",
     "The Meng Po - keeps the 醧忘台 at the tenth court, 「居第十殿，冥王殿前六桥"
     "之外」, and serves the broth of forgetting to souls already sentenced and "
     "bound for the next life"),
    # 牛头/马面 stay in the holding pen. 《玉历》 shows them at the fifth court
    # 「牛头、马面，押赴高台」, escorting the condemned up the 望乡台, but escort
    # duty is by nature not confined to one court and the fifth court is the one
    # place the text happens to name them. Recording that in the description is
    # what the source supports; moving the rows would assert a posting the text
    # does not give them either.
    ("牛头", "牛头", "Ox Head", "Niutou", ActorRole.GUARDIAN, "DY_00_PURGATORY",
     "牛头马面", "牛头马面", "Ox Head and Horse Face", "Niuma",
     "Ox Head - one of the two guardians who escort the dead. 《玉历》 names the "
     "pair at the fifth court, 「牛头、马面，押赴高台」, marching the condemned up "
     "the 望乡台; the escort itself runs across all ten courts"),
    ("马面", "马面", "Horse Face", "Mamian", ActorRole.GUARDIAN, "DY_00_PURGATORY",
     "马面", "马面", "Horse Face", "Mamian",
     "Horse Face - companion guardian of the underworld dead; see 牛头 for the "
     "fifth-court 望乡台 escort 《玉历》 names them in"),
    ("白无常", "白无常", "White Impermanence", "Bai Wuchang", ActorRole.CONDUIT, "DY_00_PURGATORY",
     "白无常", "白无常", "White Wuchang", "BaiWuchang",
     "White Impermanence - captures wandering souls, brings gentle death"),
    ("黑无常", "黑无常", "Black Impermanence", "Hei Wuchang", ActorRole.CONDUIT, "DY_00_PURGATORY",
     "黑无常", "黑无常", "Black Wuchang", "HeiWuchang",
     "Black Impermanence - captures wicked souls with chains of darkness"),
    ("判官", "判官", "Registrar", "Panguan", ActorRole.JUDGE, "DY_COURT_05_YANLUO",
     "判官", "判官", "Clerk-Registrar of the Dead", "Panguan",
     "Registrars who compile and verify the Book of Life and Death"),
    # 钟馗 IS KEPT AND LABELLED, NOT REMOVED. He does not appear anywhere in
    # 《玉历宝钞》, so nothing in the ten-court system gives him a torture-chamber
    # post; "assists in torture" was a modern popular reading written as if it
    # were canon. His attested character is the opposite end of the business —
    # 驱邪捉鬼, hunting malignant ghosts and warding a household, from 沈括
    # 《梦溪笔谈·补笔谈》卷三 (Wu Daozi's painting, Xuanzong's dream) and the
    # Dunhuang Tang manuscript 《除夕钟馗驱傩文》, both New Year exorcism
    # material. Removing him would delete a real figure over a placement error;
    # what the data owed was the note that he is not part of this system.
    ("钟馗", "钟馗", "Zhong Kui", "Zhongkui", ActorRole.EXECUTOR, "DY_COURT_05_YANLUO",
     "钟馗", "钟馗", "Zhong Kui - Demon Queller", "Zhongkui",
     "Demon queller - hunts malignant ghosts and wards the household (沈括 "
     "《梦溪笔谈·补笔谈》卷三; Dunhuang 《除夕钟馗驱傩文》). NOT A 《玉历宝钞》 "
     "FIGURE: he appears nowhere in that text and holds no office in the ten "
     "courts. His pairing with the 罚恶司 of the 四大判官 is a late popular "
     "attribution, and this row is filed at the fifth court for want of a "
     "posting, not on a source"),
    # Named judicial personnel beyond the ten kings. These three used to live in
    # a separate `populate_chinese_actors` command that could never run: it
    # defined a bare `run()` instead of a `Command` class, so `manage.py
    # populate_chinese_actors` died on AttributeError, and it did
    # `sys.path.insert` + `django.setup()` at import time against a hardcoded
    # path from somebody else's machine. The three rows were therefore
    # unreachable from any supported entry point while the rest of the app went
    # on referencing them — apps/org's init_organizations files 崔珏（崔府君）and
    # 魏征 as 四大判官 org units, apps/workflow/services.py opens the 申诉审判流程
    # appeal template with a 魏征 · 察查司 node (mirrored in the frontend's
    # workflow-templates.ts), and apps/perm/migrations/0015 names 地藏 as the
    # Chinese analogue of Osiris when describing the per-civilization overseer
    # role. They are canon; they now seed here like everything else.
    #
    # Realms match on realm_code, not on the display strings the old command
    # looked up. It searched for `name_zh='阎罗殿'` and `name_zh='齐世寺'` and
    # degraded to realm=None when it missed — and both of those rows are now
    # gone, renamed by the DY_COURT_NN restructure above, so a display-name
    # lookup would today attach all three to nothing. 阎罗殿 became
    # DY_COURT_05_YANLUO and 齐世寺's kings moved to DY_COURT_01_QINGUANG.
    # 地藏王's own seat in the source material (莲花台 / 九华山) is not a realm
    # this system models, so he keeps the court he was filed under rather than
    # getting one invented for him.
    ("魏征", "魏征", "Wei Zheng", "Weizheng", ActorRole.JUDGE, "DY_COURT_05_YANLUO",
     "察查司正堂", "察查司正堂", "Head of the Appeals Court", "Weizheng",
     "Head of the 察查司 - audits wrongful convictions and overturns a king's "
     "misjudgment; the opening node of the Chinese appeal workflow. 察查司 is "
     "this system's term, not a classical office: 魏征 appears in the underworld "
     "narrative of 《西游记》 ch. 10 as a living chancellor writing to 崔珏, not "
     "as a seated judge, and the popular four-registrar lists that do place him "
     "usually give him the 赏善司 instead"),
    ("崔府君", "崔府君", "Cui Fujun", "Cuifujun", ActorRole.JUDGE, "DY_COURT_05_YANLUO",
     "崔判官", "崔判官", "Cui the Registrar", "Cuifujun",
     "崔珏 - senior registrar and judge of the underworld courts; keeps the "
     "Ledger of Life and Death and assists the Ten Kings"),
    ("地藏王菩萨", "地藏王菩萨", "Ksitigarbha", "Dizang", ActorRole.OVERSEER, "DY_COURT_01_QINGUANG",
     "地藏王菩萨", "地藏王菩萨", "Ksitigarbha Bodhisattva", "Dizang",
     "Bodhisattva of the Great Vow - 地狱不空，誓不成佛. Delivers souls out of "
     "the hells; relief path for wrongful deaths and those in the torture chambers"),
]

# CHRISTIANITY HAS NO NAMED BENCH, AND THAT IS A FINDING, NOT A GAP.
#
# The other two civilizations in this file each supply a roster: ten kings for
# Diyu, forty-two assessors for the Hall of Two Truths. Europe has no such list
# and cannot be made to produce one. The last judgment in this theology has a
# single judge — Christ — with no jury, no division of labour and no assigned
# seats: John 5:22 ("the Father judgeth no man, but hath committed all judgment
# unto the Son"), the Nicene Creed's 「他将在荣耀中再来，审判活人死人」, and CCC
# 1021-1022 (particular judgment) and 1038-1041 (last judgment), which describe
# Christ coming in glory and separating the nations and introduce no second
# judging person. Angels appear at the judgment as gatherers and executors
# (Matt 13:41-42, 24:31, 25:31), never as adjudicators. The two passages that
# sound like a bench are not one: Matt 19:28 / Luke 22:30 seats the twelve
# apostles, but assigns them no dockets and no names, and 1 Cor 6:2-3 makes the
# subject "the saints" — everyone, not a closed list.
#
# So this slot is deliberately empty, and the emptiness is asserted by
# tests/test_seed_mythology.py::test_the_christian_side_seats_one_judge_and_no_bench
# rather than left to be noticed. That test is the point of this comment: an
# empty slot with nothing watching it is indistinguishable from an oversight,
# and the next person to notice the asymmetry will fill it.
#
# WHY IT MATTERS THAT NOBODY FILLS IT. This repo has already run the
# experiment. The forty-two assessors were, for a long time, thirty-five names
# that were not assessors — assembled because the template said a bench went
# there. Europe has been under the same pressure and answered it differently
# but not better: of eleven European actors seven are Greek and three of those
# were cast as judges, so Europe's bench was filled entirely by Greeks. Adding
# a Christian tribunal, or promoting Michael, or counting Minos as European, are
# all the same move. The correct answer to "who else judges" is that nobody
# does.
EUROPEAN_ACTORS = [
    ("God", "上帝", "God (YHWH)", "God", ActorRole.OVERSEER, "EU_HEAVEN",
     "全能者", "全能者", "The Almighty", "God",
     "Supreme deity. OVERSEER and not JUDGE: the row used to be cast as "
     "overseer while its own description called it the final judge of souls, "
     "and the judgment is committed to the Son (John 5:22). Whether the Trinity "
     "should be one row or three is a modelling question this seed does not "
     "answer; what it does answer is that the JUDGE slot points at Christ"),
    # THE JUDGE THE CREED NAMES WAS NOT IN THE DATABASE. Before this row,
    # `grep -i 'christ\|jesus\|基督\|耶稣'` matched nothing anywhere in the repo,
    # while John 5:22, Acts 10:42, Rom 14:10 / 2 Cor 5:10 (βῆμα τοῦ Χριστοῦ),
    # Matt 25:31-46, the Nicene Creed and CCC 1021-1041 all name Christ as the
    # one who judges the living and the dead. The European side had a judgment
    # system with its judge missing, and the JUDGE role handed instead to
    # Michael and to Satan, neither of whom judges anybody.
    ("Christ", "基督", "Christ", "Christos", ActorRole.JUDGE, "EU_HEAVEN",
     "审判活人死人者", "审判活人死人者", "Judge of the Living and the Dead", "Christos",
     "The judge of the last judgment, and the only one this theology has. "
     "John 5:22: the Father judges no one but has given all judgment to the "
     "Son. Nicene Creed: he will come again in glory to judge the living and "
     "the dead. CCC 1021-1022 makes even the particular judgment a referral of "
     "a life to Christ; CCC 1038-1041 has him separate the nations at the last. "
     "Catholic, Orthodox and Protestant readings agree on this point without "
     "reservation"),
    # Michael's role was JUDGE on the strength of "weighs souls at the heavenly
    # throne". Soul-weighing (psychostasis) is a medieval iconographic motif
    # that entered Christian art around the 4th century from Greek psychostasia,
    # itself from the Egyptian weighing of the heart that this same file seeds
    # on the Egyptian side — so the repo had Michael performing Anubis' job,
    # borrowed twice over. Neither scripture nor doctrine connects him to a
    # balance. What does have a text is leading: the Offertory of the Roman
    # Requiem, *sed signifer sanctus Michael repraesentet eas in lucem sanctam*
    # — "let the standard-bearer Saint Michael bring them into the holy light".
    # A standard-bearer who brings souls in is CONDUIT.
    ("Michael", "米迦勒", "Archangel Michael", "Mikael", ActorRole.CONDUIT, "EU_HEAVEN",
     "掌旗者圣米迦勒", "掌旗者圣米迦勒", "Michael the Standard-Bearer", "Mikael",
     "Leads souls into the light: *signifer sanctus Michael repraesentet eas in "
     "lucem sanctam*, Offertory of the Roman Requiem. Captain of the heavenly "
     "host (Rev 12:7; Dan 10:13, 12:1; Jude 9). He does NOT weigh souls — that "
     "image is medieval iconography borrowed from Egyptian psychostasia, not "
     "scripture and not doctrine, and it is why this row used to be a JUDGE"),
    ("Gabriel", "加百列", "Archangel Gabriel", "Gabrielle", ActorRole.CONDUIT, "EU_HEAVEN",
     "加百列", "加百列", "Archangel Gabriel", "Gabrielle",
     "Messenger angel - carries announcements to the living (Dan 8:16, 9:21; "
     "Luke 1:11-20, 1:26-38). CONDUIT in the sense of bearing word, not of "
     "escorting the dead: 'guides souls to judgment and heaven' was Michael's "
     "office (see above) written onto Gabriel, and the last-trumpet image "
     "attached to him is Islamic and later folk tradition, not biblical"),
    # Satan was cast as JUDGE, which neither tradition supports. In theology he
    # is the accuser — ὁ κατήγωρ, "the accuser of our brethren" (Rev 12:10), the
    # prosecuting figure of Job 1-2 — and he is himself judged (Rev 20:10). In
    # Dante he is not an agent at all: Inferno XXXIV has him frozen to the chest
    # in Cocytus chewing Judas, Brutus and Cassius, an instrument of punishment
    # rather than anyone who decides anything. EXECUTOR is the closest of the
    # five roles to both readings; ActorRole has no ACCUSER and adding one for a
    # single row would be a migration this correction does not need.
    ("Satan", "撒旦", "Satan", "Satan", ActorRole.EXECUTOR, "EU_HELL_9TH",
     "堕落者撒旦", "堕落者撒旦", "Satan - Adversary", "Satan",
     "The adversary. Accuser rather than judge in theology (Rev 12:10 ὁ "
     "κατήγωρ; Job 1-2), and himself the object of judgment (Rev 20:10). In "
     "Dante he is the punishment itself, frozen in Cocytus at the bottom of the "
     "ninth circle with three mouths (Inferno XXXIV) - he sentences nobody"),
    # Charon was in Purgatory, which is wrong in both traditions at once. The
    # Greek Charon works the entrance to the underworld; Dante's Charon works
    # Acheron at the gate of hell (Inferno III), and Dante's *purgatorial*
    # boatman is an angel (Purgatorio II), so there is no reading in which the
    # ferryman of the dead belongs on the mountain of penance. The title also
    # said Styx, which is the Roman poets' river and contradicts this repo's own
    # docs/04; Virgil, Aeneid 6.295-297 and Dante both put him on Acheron.
    ("Charon", "卡戎", "Charon", "Kharos", ActorRole.CONDUIT, "EU_ACHERON",
     "冥河渡神卡戎", "冥河渡神卡戎", "Charon - Ferryman of Acheron", "Kharos",
     "Ferryman of Acheron - takes the dead across at the threshold of the "
     "underworld (Virgil, Aeneid 6.295-297; Dante, Inferno III; Euripides, "
     "Alcestis 252-256 has the same crossing as a lake). Roman poets often "
     "write Styx for the river, which is where this row's old title came from"),
    # Minos was in the ninth circle with a description of second-circle work:
    # "judge in the ninth circle, assigns souls to their hell-circle". Assigning
    # the circle is exactly what Dante's Minos does, and he does it at the
    # entrance to the second, where the sinner confesses and he coils his tail
    # the number of times equal to the circle it belongs in (Inferno V.4-15). A
    # judge who allots circles cannot be sitting in the last one.
    ("Minos", "米诺斯", "Minos", "Mino", ActorRole.JUDGE, "EU_HELL_2ND",
     "米诺斯", "米诺斯", "Judge Minos", "Mino",
     "King Minos - stands at the entrance to the second circle, hears each "
     "soul's confession and allots it the circle it belongs to by the coils of "
     "his tail (Dante, Inferno V.4-15). THIS ROW IS DANTE'S MINOS. Plato's "
     "Minos, Gorgias 524a, is the final arbiter at the fork when the other two "
     "judges are in doubt, and Homer's, Odyssey 11.568-571, gives judgment "
     "sceptre in hand; those are different offices in different underworlds"),
    ("Cerberus", "刻耳柏洛斯", "Cerberus", "Kerberos", ActorRole.GUARDIAN, "EU_HELL_3RD",
     "冥界三头犬刻耳柏洛斯", "冥界三头犬刻耳柏洛斯", "Cerberus - Three-headed Hound", "Kerberos",
     "Three-headed hound - Dante sets him over the gluttons in the third "
     "circle, barking with his three gullets over the souls in the freezing "
     "rain (Inferno VI); in the Greek tradition he keeps the gate of the "
     "underworld itself (Apollodorus 2.5.12). He was seeded in the first "
     "circle, which is neither. Hesiod's earliest description gives him fifty "
     "heads (Theogony 311-312); the three are Apollodorus, Virgil and Dante"),
    # Greco-Roman side. `consolidate_eu_pantheon` audits exactly this cast —
    # Hades sole OVERSEER, Minos/Aeacus/Rhadamanthus JUDGE, Charon CONDUIT,
    # Cerberus GUARDIAN — so it has to be seeded, or that audit reports every
    # name MISSING on a fresh database.
    #
    # Hades, not Pluto: same god, and `consolidate_eu_pantheon` merges the pair
    # into Hades. Pluto is therefore deliberately NOT seeded — it only exists in
    # databases predating that command, which is exactly the case the merge step
    # is there to clean up. Seeding both would manufacture on every fresh
    # database the duplicate the merge exists to remove.
    #
    # The reason recorded for that merge used to be "Pluto is Hades' Roman
    # name", which is a simplification that gets the direction wrong. Πλούτων
    # (Plouton) is a GREEK cult title, absent from Homer and Hesiod and current
    # from the 5th century BCE through the Eleusinian mysteries, from πλοῦτος,
    # wealth — Plato, Cratylus 403a has people avoid the name Hades and say
    # Plouton instead, because wealth comes up out of the earth. Pluto is the
    # Latin transcription of that Greek title. Rome's own underworld gods are
    # Dis Pater and Orcus; Cicero equates Dis with Plouton. So the merge folds
    # two cult aspects of one Greek god, not a Greek name and a Roman one.
    #
    # WHERE HADES SITS IS AN ENGINEERING PLACEMENT AND IS LABELLED AS ONE. He
    # was in EU_HELL_1ST, Limbo, which has no basis at all — Dante has no
    # "Hades' level", and the Dis of the Commedia is the walled city of the
    # sixth circle and Lucifer himself. This system models no house of Hades, so
    # he is seated as overseer of the Greek judgment ground below, the only
    # Greek place here that is his. That is a compromise, exactly like the one
    # recorded above for 地藏王菩萨, and not a claim from a text.
    ("Hades", "哈迪斯", "Hades", "Aides", ActorRole.OVERSEER, "EU_PLATO_MEADOW",
     "冥王哈迪斯", "冥王哈迪斯", "Hades - Lord of the Underworld", "Aides",
     "Greek god of the underworld - sole overseer of the Greco-Roman infernal "
     "realm. Also Plouton (Πλούτων), a Greek cult title from πλοῦτος 'wealth' "
     "(Plato, Cratylus 403a), of which Latin Pluto is the transcription; Rome's "
     "native underworld gods are Dis Pater and Orcus. PLACEMENT IS AN "
     "ENGINEERING CHOICE: no house of Hades is modelled here, so he oversees "
     "the judgment ground rather than being given one of Dante's circles"),
    # AEACUS AND RHADAMANTHUS ARE NOT IN THE COMMEDIA, WHICH IS WHY THEY HAVE
    # THEIR OWN PLACE NOW. Both used to sit in EU_HELL_9TH — Dante's frozen
    # Cocytus, where this file also seeds Satan — and they are wrong there twice
    # over. Dante borrows one Greek judge, Minos, and neither of these two
    # appears in the poem at all; and Plato, who is where the three-judge
    # division of labour comes from, sets the judgment at a fork in a meadow
    # with one road to the Isles of the Blessed and one to Tartarus. That is a
    # sorting point *before* punishment. A ninth circle is not a place Plato's
    # cosmology contains — the layering is Dante's.
    #
    # The division of labour is Gorgias 524a (Rhadamanthus tries those from
    # Asia, Aeacus those from Europe, Minos decides when they are in doubt).
    # Note 524a, not 523e: 523e is Zeus announcing the reform, and the
    # assignment of the three is the passage after it.
    #
    # Their two destinations are still not modelled and are deliberately not
    # invented. EU_PLATO_MEADOW is the ground they judge on and nothing more.
    ("Aeacus", "艾亚哥斯", "Aeacus", "Aiakos", ActorRole.JUDGE, "EU_PLATO_MEADOW",
     "冥界判官艾亚哥斯", "冥界判官艾亚哥斯", "Judge Aeacus", "Aiakos",
     "One of the three judges of the dead - tries those who come from Europe "
     "(Plato, Gorgias 524a) and holds the keys of the underworld (Pindar, "
     "Isthmian 7.47; Apollodorus 3.12.6). Son of Zeus and the nymph Aegina, and "
     "grandfather of Achilles. He does not appear in Dante"),
    ("Rhadamanthus", "拉达曼提斯", "Rhadamanthus", "Rhadamanthys", ActorRole.JUDGE,
     "EU_PLATO_MEADOW",
     "冥界判官拉达曼提斯", "冥界判官拉达曼提斯", "Judge Rhadamanthus", "Rhadamanthys",
     "One of the three judges of the dead - tries those who come from Asia "
     "(Plato, Gorgias 524a). Homer instead has him living in Elysium rather "
     "than judging (Odyssey 4.563-565) and Virgil has him ruling and punishing "
     "in Tartarus (Aeneid 6.566); the brotherhood with Minos is usually cited "
     "to Iliad 14.321-322, which has not been checked line by line here. He "
     "does not appear in Dante"),
    # Lethe's realm is right and its description was not. EU_PURGATORY is
    # Dante's placement — Lethe runs through the Earthly Paradise at the summit
    # of Mount Purgatory, where Matelda explains that it washes away the memory
    # of sin while Eunoe restores the memory of good done (Purgatorio XXVIII).
    # The row described Virgil's Lethe instead, drunk before rebirth to forget a
    # past life (Aeneid 6.703ff), so realm and meaning came from different
    # poems. The realm was kept and the meaning corrected. Eunoe is absent,
    # which means only half of Dante's pair of rivers is modelled; that is a
    # known omission, not an oversight.
    ("Lethe", "忘川", "River Lethe", "Lethe", ActorRole.CONDUIT, "EU_PURGATORY",
     "忘川河神", "忘川河神", "Lethe - River of Forgetfulness", "Lethe",
     "Spirit of the river Lethe - at the summit of Mount Purgatory the souls "
     "who have finished their penance are drawn through it and lose the memory "
     "of their sins (Dante, Purgatorio XXVIII). Not Virgil's Lethe, drunk "
     "before rebirth to forget a whole past life (Aeneid 6.703ff): that one "
     "belongs to a cosmology with reincarnation in it. Dante pairs it with "
     "Eunoe, which this system does not model"),
]

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
     "at; see EG_DEVOURER above"),
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

# CLI label -> the assessor table seeded after that civilization's actors. Kept
# out of CIVILIZATION_DATA so the Chinese and European entries keep their shape.
CIVILIZATION_ASSESSORS = {
    "egyptian": EGYPTIAN_ASSESSORS,
}

# --------------------------------------------------------------------------
# Statutes — the articles a verdict can cite (apps.judgment.models.Statute)
#
# THREE CORPORA ARE SEEDED, AND THE LARGEST ONE IS NOT WRITTEN IN THIS FILE.
#
#   CHINESE   — here, below, as CHINESE_STATUTES: 《太微仙君功過格》 (1171),
#               73 transcribed articles under corpus GONGGUOGE. This is the
#               SECOND attempt at the Chinese side too, and it is a different
#               kind of document from the one that was withdrawn — not a penal
#               code but a ledger the living keep on themselves. Read the block
#               above CHINESE_STATUTES before touching it; the appropriation it
#               documents is the whole reason this corpus is allowed to exist
#               here at all.
#
#   EGYPTIAN  — NOT here. The 42 clauses are already in the database on the
#               assessors' `powers_json["negative_confession"]`, seeded above
#               with their edition recorded. `_seed_derived_statutes` builds a
#               citation row that POINTS AT each assessor; the text is read
#               back through `Statute.derived_text` at display time. Pasting
#               the 42 clauses into this file would make it the second author
#               of a text it does not own, and the two copies would disagree
#               the first time one was corrected — the "two hand-maintained
#               copies" failure this seeder was consolidated to end.
#
#   EUROPEAN  — here, below, as EUROPEAN_STATUTES. Seven articles, one per
#               terrace of Mount Purgatory. This is the SECOND attempt at this
#               corpus; the first was withdrawn, and the difference between
#               them is the whole point of the note that follows.
#
# WITHDRAWN: THE CHINESE (HELL_LAW) CORPUS.
# RE-ANCHORED: THE EUROPEAN (DEADLY_SIN) ONE.
#
# Commit 6017f04 seeded thirteen Chinese rows (CN-HL-O01..O06, CN-HL-M01..M07)
# and seven European ones (EU-DS-01..07) from this file. Both tables were
# removed in 8308204 after independent verification of their sources. Rows that
# already reached a database are soft-deleted by
# apps/judgment/migrations/0012_withdraw_fabricated_statutes.py — reversibly,
# and never over a row a judgment has actually cited.
#
# THE FRAME WAS FABRICATED, NOT MERELY THE DETAIL. This is the distinction
# that decides what may be done about it:
#
#   CHINESE — there is no codified 冥律. The primary text behind docs/11,
#     《玉历宝钞》, is a morality tract narrated hall by hall: it has no article
#     numbers, no sentence lengths in years, and nothing with the form of a
#     律. `article_number` and `min_punishment_years` were therefore a modern
#     statute-book shell fitted over a text that has no statutes, and the
#     citation codes CN-HL-* asserted an article numbering that no source
#     contains. docs/11 §1.2 additionally cites 《太上老君律》 — a book that
#     does not exist; the Daozang has no work under that title. The §4.1 list
#     was not "十恶 with four missing" either: 饮酒 is not one of Buddhism's
#     ten evils at all, so the list held five wrong absences plus one entry
#     that does not belong, and §4.2's seven had no correspondence to the
#     十善业道 whatsoever. See scratchpad/verify-cn-structure.md.
#
#   EUROPEAN — the Inferno is not stratified by the seven capital sins. Dante
#     layers hell on Aristotle's tripartite scheme (Inf. XI.79-84), and three
#     of the seven — pride, envy, sloth — have no circle at all. The structure
#     that IS ordered by the seven is the Purgatorio's seven terraces, which
#     this deployment did not model. The ordering was attributed to Gregory
#     the Great but does not match his: for Gregory pride is not one of the
#     seven, it is the root from which they grow. And EU-DS-07's punishment
#     ("被铁笼囚禁", caged in iron) appears in no part of the poem — it was
#     invented outright. See docs/lore-verification/verify-christian-structure.md.
#
# WHAT CHANGED FOR EUROPE, AND WHAT DID NOT. The seven sins themselves were
# never the finding: the names and the Latin (Superbia, Invidia, Ira, Acedia,
# Avaritia, Gula, Luxuria) were right the first time. What failed was the
# structure they hung on. The repair is therefore NOT a corrected mapping of
# sins onto circles — there is no such mapping to correct. It is a place:
# EU_PURGATORY_T1..T7 above are the seven terraces of Purgatorio X-XXVII, which
# is the one structure in the Commedia that the seven do order, and every
# article below cites its terrace instead of a circle.
#
# `dante_circle` IS RETIRED AND IS NOT COMING BACK. It was never a coordinate
# in Dante — it is a later popular chart laying two unrelated taxonomies over
# each other, and for pride, envy and sloth it named a circle the poem does not
# give them. No row below carries the key, and tests/test_purgatorio_terraces.py
# asserts that no seeded statute ever does. `purgatorio_terrace` replaces it and
# is a different kind of value: 1-7, checkable against the poem, and against the
# realm rows in this same file.
#
# THE CODES ARE NEW: EU-DS-T1..T7, not EU-DS-01..07. Reusing the old codes
# would have been worse than a collision. judgment/0012 deliberately did NOT
# retire any withdrawn article a judgment had cited, so a live EU-DS-07 may
# exist on a deployed database carrying the iron cage — and `_upsert` matches on
# `code`. Re-seeding under the same code would either be skipped as a
# soft-deleted row (silently seeding six of seven) or, with --update, rewrite
# the recorded grounds of a decided case into a different article. A new
# citation key leaves the tombstones legible as what they are.
#
# DO NOT "COMPLETE" THE CHINESE LIST. The obvious repair — supply the four
# missing 十恶, the three missing 十善 — is the one repair that must not be
# made. Nothing was missing. The list was pinned to a structure the sources do
# not have, and filling the holes only produces a more convincing forgery:
# correctly-numbered articles of a code that was never written. A corpus
# returns here only with a primary text that actually has the shape the model
# claims — which is exactly the test the European seven have now passed and
# had not before.
#
# WHERE THE CHINESE SIDE WENT. The workable anchor was not a law code but a
# merit ledger: 《太微仙君功過格》 (1171, in the Daozang), which really does
# enumerate items with signed point values — the shape `polarity` was built
# for, and one this system can cite honestly. It has been verified
# (docs/lore-verification/gongguoge.md: full text, two independent
# transcriptions collated, every point value in the document) and it is seeded
# below as CHINESE_STATUTES under a NEW corpus value, GONGGUOGE, not as a
# refill of HELL_LAW: a 功過格 is a moral account book kept by the living, not
# a penal code administered by hell, and filing one under the other would
# rebuild the framing that had to be withdrawn. The citation keys are new for
# the same reason as the terraces': CN-GGG-*, never CN-HL-*.
#
# HELL_LAW STAYS EMPTY, AND THAT IS STILL THE FINDING. The Chinese side having
# a real corpus does not make 冥律 a document. It is not one, and no amount of
# 功過格 material changes that. See the note on StatuteCorpus in
# apps/judgment/models.py.
#
# WHAT WAS NOT DONE WITH IT. 功過格 has no time decay of any kind — a monthly
# balance carries forward at face value — and no periodic settlement is
# implemented on top of the existing continuous decay, because that would score
# the same deeds twice. The decay in apps/ledger/services.py remains labelled a
# product choice, which is what its own comment already said and what the
# verification independently confirmed.
#
# EGYPTIAN IS UNAFFECTED. It was never transcribed here (see above), it is
# derived from assessor rows whose provenance was checked clause by clause
# against Budge's reading of the Nebseni papyrus and cross-checked 42/42
# against UCL's Maiherperi papyrus, and it stays.
# --------------------------------------------------------------------------

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

# --------------------------------------------------------------------------
# CHINESE — 《太微仙君功過格》 (corpus GONGGUOGE)
#
# The Chinese side comes back, and it comes back as something else. 冥律 is
# still not a document (see the withdrawal note above, which stands unamended);
# what exists is a merit ledger, and this is the earliest surviving one.
#
# WHAT THIS TEXT IS. 又玄子, 序署「西山會真堂無憂軒又玄子」, dates his preface
# to 大定辛卯 — 金世宗大定十一年, 1171 — and says he received the格 in a dream
# at 紫府 before 太微仙君. It is in the 正統道藏 at 洞真部戒律類雨字號, one
# fascicle, 「二篇同卷」: 功格三十六條 in four 門 and 過律三十九條 in four 門.
# Brokaw (1991) independently identifies it as the earliest extant 功過格, with
# 36 approved and 39 proscribed acts.
#
# WHAT IT IS NOT, AND WHY EVERY ROW SAYS SO. It is not a penal code and it does
# not judge the dead. Its sanctions run entirely in this life: 奪紀奪算 (a 紀
# is 300 days and an 算 3 days, per 抱朴子·微旨 — the later 「紀＝12年」 gloss
# has no source we could verify and is NOT used), the 三百善/一千三百善
# thresholds for 地仙/天仙 (太上感應篇), and 餘慶餘殃 landing on one's
# descendants (太微's preface opens by quoting 《易》 on exactly that). The word
# for any hell appears nowhere in the text. Using it as a basis for judging the
# dead is this system's APPROPRIATION, it is deliberate, and APPROPRIATION_NOTE
# below is carried by all 73 rows so it can never be quietly forgotten — which
# is precisely how the withdrawn HELL_LAW corpus began.
#
# There is one primary sentence that licenses the appropriation, and it is the
# text's own core religious claim rather than an apologetic we constructed: the
# preface says a self-kept tally and heaven's audit agree exactly —
# 「與上天真司考校之數，昭然相契，悉無異焉」.
#
# 73 ROWS, NOT 75, AND THE GAP IS NOT FILLED. 救濟門 is titled 十二條 and both
# independent digital transcriptions segment it into 11; 不軌門 is titled 六條
# and both give 5. So the transcribed total is 35 + 38 = 73 against a claimed
# 75. The verification report marks the two likeliest split points and marks
# them as CONJECTURE. They are recorded here in `source_notes` and in
# `payload["transcription_gap"]`, and NOT acted on. Inventing the two missing
# articles — or splitting a paragraph to make the arithmetic come out — is the
# identical move that produced the fabricated 冥律: a more convincing forgery.
#
# THE DECAY QUESTION IS ALREADY ANSWERED AND IS NOT REOPENED HERE. 功過格 has
# no decay of any kind; the monthly settlement carries the balance forward at
# face value (「折除之外者…當書總記訖，再書後月」). apps/ledger/services.py
# already says this in CIVILIZATION_DECAY_RATE and labels its decay a product
# choice. Nothing in this corpus is wired to that arithmetic, and no periodic
# settlement is implemented — running 一月一小比 as extra arithmetic on top of
# a continuous decay would count the same deeds twice.
# --------------------------------------------------------------------------

GONGGUOGE_SOURCE = (
    "《太微仙君功過格》，金大定十一年（1171）又玄子序，《正統道藏》洞真部戒律類雨字號，一卷。"
    "底本：維基文庫轉錄（標注 from=正統道藏）；異文校以中國哲學書電子化計劃 ctext.org "
    "chapter=199527。兩個轉錄本逐字比對後，實質性異文三處已按文義取捨並在 source_notes 標明。"
    "未核道藏影印本。條目與分值全部為原文，無一為本系統自定。"
    "docs/lore-verification/gongguoge.md §1-§4。"
)

#: Carried by all 73. The one note that must never fall off a row.
APPROPRIATION_NOTE = (
    "挪用聲明：《太微仙君功過格》是在世修道者每日自記的道德賬簿，不是冥府判案的法典。"
    "其原生賞罰為在世奪紀奪算（紀＝三百日、算＝三日，據《抱朴子·微旨》）、"
    "成仙閾值（三百善地仙／一千三百善天仙，據《太上感應篇》）與子孫餘慶餘殃；"
    "全文不出現任何地獄名，也沒有任何一條說分數會被冥官用來判入某殿某獄。"
    "本系統拿它作審判計分依據，是一次有意的挪用。其唯一一手文本依據是本書序文的主張——"
    "自記之數「與上天真司考校之數，昭然相契，悉無異焉」，即賬簿被視為天曹底賬的鏡像。"
    "清《十戒功過格》序進一步把功過格掛靠於「陰律」，但同樣未提供任何編號條文。"
)

#: Carried by all 73 as well: the fungibility class is only half sourced.
FUNGIBILITY_CLASS_NOTE = (
    "payload.fungibility_class 的兩個值 MONEY／LIFE 有明文依據——"
    "《文昌帝君功過格·凡例》：「功過有不可折者。如用財之百功，不可折致死人之百過。"
    "零積之十功不能折一次之十過也。」其餘的值（RITUAL／SPEECH／CONDUCT）是本系統自定的細分，"
    "太微與文昌都沒有給出這樣的分類。見 apps/ledger/fungibility.py。"
)

#: 救濟門 and 不軌門 only.
TRANSCRIPTION_GAP_NOTE = (
    "條數不符，且不予補齊：門題與兩個獨立轉錄本的分段數對不上，短一條。"
    "核實報告標出了最可能的切分點並註明那是推測而非原刻分段；本系統照原樣保留缺口，"
    "在 payload.transcription_gap 記明。需道藏影印本才能定讞。"
)

#: (code segment, polarity, 門, English gloss, titled count, unit, default class)
GONGGUOGE_GATES = {
    "JJ": ("F-JJ", "MERIT", "救濟門", "Relief and Rescue", "十二條", "功", "LIFE"),
    "JD": ("F-JD", "MERIT", "教典門", "Scripture and Ordination", "七條", "功", "RITUAL"),
    "FX": ("F-FX", "MERIT", "焚修門", "Offering and Cultivation", "五條", "功", "RITUAL"),
    "YS": ("F-YS", "MERIT", "用事門", "Conduct of Affairs", "十二條", "功", "CONDUCT"),
    "BR": ("G-BR", "OFFENCE", "不仁門", "Inhumanity", "十五條", "過", "LIFE"),
    "BS": ("G-BS", "OFFENCE", "不善門", "Unwholesomeness", "八條", "過", "RITUAL"),
    "BY": ("G-BY", "OFFENCE", "不義門", "Unrighteousness", "十條", "過", "MONEY"),
    "BG": ("G-BG", "OFFENCE", "不軌門", "Transgression of Discipline", "六條", "過", "RITUAL"),
}

#: 百錢為一功 — 太微's rate, and version-bound: 《十戒功過格》 uses 三十文為一功.
#: Carried per-article rather than as one constant, so a second recension does
#: not have to overwrite this one's.
RATE_100_CASH = {"per": 100, "currency_zh": "錢", "points": 1}
#: 一貫為一功 (用事門#4). Ten times dearer than 救濟門#7's 貫錢為十功, because
#: persuading somebody else to give is not the same act as giving.
RATE_1000_CASH = {"per": 1000, "currency_zh": "錢", "points": 1}

# The corpus. One tuple per transcribed segment:
#   (gate, ordinal-within-gate, title_zh, title_en, text_zh, clauses, extras)
#
# `clauses` is (condition_zh, points) pairs — the article's own conditional
# values, verbatim in number. 救濟門#4 alone carries twelve of them and 焚修門#1
# and 用事門#12 carry 0.5, which is why a single `merit_points` column was never
# going to hold this corpus. `extras` merges into payload_json.
#
# 〔 〕 marks the original's double-column interlinear notes, except at 不仁門#4
# where it marks an UNRESOLVED variant — the note on that row says which.
GONGGUOGE_ENTRIES = [
    # ---------------- 功格 · 救濟門 (11 transcribed of 十二條) -------------
    ("JJ", 1, "符法針藥救疾", "Healing the sick by talisman, needle or medicine",
     "以符法針藥救重疾一人為十功，小疾一人為五功，如受病家賄賂則無功，治邪一同。凡行治一度為一功，施藥一服為一功。",
     (("救重疾一人", 10), ("救小疾一人", 5), ("凡行治一度", 1), ("施藥一服", 1)),
     {"nullifiers": (("受病家賄賂", "no_merit"),)}),
    ("JJ", 2, "傳救人符法方術", "Transmitting a life-saving art",
     "傳一符一法一方一術、令人積行救人，每一術為十功，如受賄而傳，或令人受賄，則並無功。",
     (("每傳一術", 10),),
     {"nullifiers": (("受賄而傳", "no_merit"), ("令人受賄", "no_merit"))}),
    ("JJ", 3, "傳保益性命符法", "Transmitting an art that preserves life",
     "傳人保益性命符法藥術等，每一事為五功，如受賄而傳為一功。",
     (("每傳一事", 5), ("受賄而傳", 1)), {}),
    ("JJ", 4, "救免減刑", "Rescue, pardon and mitigation of punishment",
     "救一人刑死性命為百功，免死刑性命一人為百功，減死刑性命一人為五十功，"
     "救人徒刑為四十功，免人徒刑為三十功，減人徒刑為二十功，"
     "救人杖刑為十功，免人杖刑為八功，減人杖刑為六功，"
     "救人笞刑為五功，免人笞刑為四功，減人笞刑為三功。"
     "〔救謂非自己主事，得門竭力救之是也；免謂自己主事，特爽原免者是也。〕"
     "如依法定罪則無功，如私家減免婢僕之屬，同此論功。",
     (("救一人刑死性命", 100), ("免死刑性命一人", 100), ("減死刑性命一人", 50),
      ("救人徒刑", 40), ("免人徒刑", 30), ("減人徒刑", 20),
      ("救人杖刑", 10), ("免人杖刑", 8), ("減人杖刑", 6),
      ("救人笞刑", 5), ("免人笞刑", 4), ("減人笞刑", 3)),
     {"nullifiers": (("依法定罪", "no_merit"),),
      "notes": (
          "校勘：本條四處作「減」，維基文庫轉錄本作「滅」，此處從 ctext 本。"
          "理由是文義——救／免／減三級遞降（救為非自己主事而竭力救之、免為自己主事而特爽原免、"
          "減為減輕刑等）自洽，「滅」為形近訛字。這是文義校勘意見，不是版本學結論；未核影印本。",
      )}),
    ("JJ", 5, "救有力報人之畜", "Saving a beast that can repay",
     "救有力報人之畜一命為十功。〔謂駝、騾、牛、馬、驢畜等。〕",
     (("救有力報人之畜一命", 10),), {}),
    ("JJ", 6, "救無力報人之畜", "Saving a beast that cannot repay",
     "救無力報人之畜一命為八功，〔謂山野禽獸之屬〕蟲蟻飛蛾濕生之類一命為一功。",
     (("救無力報人之畜一命", 8), ("蟲蟻飛蛾濕生之類一命", 1)), {}),
    ("JJ", 7, "賑濟窮民", "Relieving the destitute",
     "賑濟鰥寡孤獨窮民百錢為一功，貫錢為十功，如一錢散施，積至百錢為一功，"
     "米麥幣帛衣物，以錢數論功，饒潤窮民債負，亦同此論。濟饑渴之民一飲一食皆為一功。",
     (("賑濟窮民百錢", 1), ("賑濟窮民貫錢", 10), ("濟饑渴之民一飲一食", 1)),
     {"fungibility_class": "MONEY", "money_rate": RATE_100_CASH,
      "transcription_gap": {
          "gate_titled": "十二條", "gate_transcribed": 11,
          "conjectured_split_here": True,
          "conjecture": "報告推測「賑濟鰥寡孤獨窮民…」與「濟饑渴之民一飲一食皆為一功」在道藏原刻中很可能是兩條，"
                        "但兩個轉錄本都作一段。未予拆分。",
      },
      "notes": (TRANSCRIPTION_GAP_NOTE,)}),
    ("JJ", 8, "濟寒凍之民", "Sheltering the freezing",
     "濟寒凍之民暖室一宵為一功。", (("暖室一宵", 1),),
     {"fungibility_class": "MONEY"}),
    ("JJ", 9, "救人畜疲困", "Relieving exhaustion in man or beast",
     "救接人畜筋力疲困之苦一時為一功。", (("救接一時", 1),), {}),
    ("JJ", 10, "葬無主之骨", "Burying the unclaimed dead",
     "葬無主之骨一人為五十功，施地與無土之家葬一人為三十功，若令出備租課則無功。"
     "埋藏自死者、走獸、飛禽、六畜等一命為一功，若埋藏禽獸、六畜骨殖及十六斤為一功。",
     (("葬無主之骨一人", 50), ("施地與無土之家葬一人", 30),
      ("埋藏自死禽畜一命", 1), ("埋藏禽獸六畜骨殖十六斤", 1)),
     {"nullifiers": (("令出備租課", "no_merit"),)}),
    ("JJ", 11, "平理道途造橋濟渡", "Mending roads, building ferries and bridges",
     "平理道途嶮阻及泥水陷沒之所一日一人之功為十功，"
     "若造船橋濟渡、不求賄賂者，所費百錢為一功，一日一人之功為十功。",
     (("平理道途一日一人之功", 10), ("造船橋濟渡所費百錢", 1), ("造船橋濟渡一日一人之功", 10)),
     {"fungibility_class": "MONEY", "money_rate": RATE_100_CASH,
      "nullifiers": (("求賄賂", "no_merit"),)}),

    # ---------------- 功格 · 教典門 (7 of 七條) ---------------------------
    ("JD", 1, "自受法籙經教", "Receiving register and scripture oneself",
     "自己受救人法籙經教一宗為二十功，受保護自身法籙經教一宗為十五功。",
     (("受救人法籙經教一宗", 20), ("受保護自身法籙經教一宗", 15)), {}),
    ("JD", 2, "於高士處求受", "Seeking transmission from an adept",
     "於高士處求救人法籙經教一宗為八功，求保護自身法籙經教一宗為四功。",
     (("求救人法籙經教一宗", 8), ("求保護自身法籙經教一宗", 4)), {}),
    ("JD", 3, "傳度弟子", "Ordaining disciples",
     "傳受行法官一人為百功，度籙生弟子一人為五十功，度受戒弟子一人為三十功。",
     (("傳受行法官一人", 100), ("度籙生弟子一人", 50), ("度受戒弟子一人", 30)), {}),
    ("JD", 4, "以經法付人", "Passing scripture to a friend",
     "以救眾經法付人為五功，保養性命經法付人為四功，演道經論付人為三功。〔為朋友間相受也。〕",
     (("救眾經法付人", 5), ("保養性命經法付人", 4), ("演道經論付人", 3)), {}),
    ("JD", 5, "注撰經法", "Composing scripture and commentary",
     "自己注撰救眾經法一宗為三十功，保養性命經法一宗為二十功，〔謂得功驗者〕"
     "讚道之文一篇為一功，〔謂詩詞歌頌等〕若詠無教化者則無功。",
     (("注撰救眾經法一宗", 30), ("注撰保養性命經法一宗", 20), ("讚道之文一篇", 1)),
     {"nullifiers": (("詠無教化者", "no_merit"),)}),
    ("JD", 6, "簡編經法", "Compiling scripture",
     "自己簡編救眾經法一宗為十功，保養性命經法一宗為五功，讚道之文一篇為一功。",
     (("簡編救眾經法一宗", 10), ("簡編保養性命經法一宗", 5), ("讚道之文一篇", 1)), {}),
    ("JD", 7, "雕造印施經教", "Cutting blocks and printing scripture",
     "雕造經教所費百錢為一功，貫錢為十功，印造散施與人小經一卷為十功，〔謂千字已下者〕"
     "大經一卷為二十功，〔謂千字已上者〕並謂上聖正典有教化者，非談論興亡勝敗之書及詠風月之文。",
     (("雕造經教所費百錢", 1), ("雕造經教所費貫錢", 10),
      ("印造散施小經一卷", 10), ("印造散施大經一卷", 20)),
     {"fungibility_class": "MONEY", "money_rate": RATE_100_CASH}),

    # ---------------- 功格 · 焚修門 (5 of 五條) ---------------------------
    ("FX", 1, "修置聖像壇宇供物", "Repairing images, altars and offerings",
     "修聖像、壇宇、幢蓋、幡花、器皿、床坐，及諸供養之物，費百錢為一功，貫錢為十功，"
     "如施與人錢物，修置百錢為半功，貫錢為五功，或以什物一件為一功。",
     (("自修費百錢", 1), ("自修費貫錢", 10),
      ("施與人錢物修置百錢", 0.5), ("施與人錢物修置貫錢", 5), ("以什物一件", 1)),
     {"fungibility_class": "MONEY", "money_rate": RATE_100_CASH,
      "notes": (
          "非整數分值：「修置百錢為半功」＝0.5 功。全書另一處半分值在用事門#12（素食中味為半功），"
          "過律側在不善門#1（半過）。原文如此，未取整。",
      )}),
    ("FX", 2, "旦夕朝禮", "Morning and evening observance",
     "旦夕朝禮，為國為眾，焚修一朝為二功，為己焚修一朝為一功。",
     (("為國為眾焚修一朝", 2), ("為己焚修一朝", 1)), {}),
    ("FX", 3, "章醮祈禳", "Petition and offering rites",
     "章醮，為國、為民、為祖先、為孤魂、為尊親，祈禳灾害，薦拔沉魂，一分為二功，"
     "為己一分為一功，為施主一分為一功，若受法信則無功。",
     (("為國為民為祖先為孤魂為尊親一分", 2), ("為己一分", 1), ("為施主一分", 1)),
     {"nullifiers": (("受法信", "no_merit"),)}),
    ("FX", 4, "拔亡符命", "Talismans for the delivery of the dead",
     "為無告孤魂告行拔亡符命一符為十功，祖先尊親一亡為十功，為平交親知及卑幼一亡為五功，"
     "為施主一亡為四功，若受法信則無功。",
     (("為無告孤魂一符", 10), ("為祖先尊親一亡", 10),
      ("為平交親知及卑幼一亡", 5), ("為施主一亡", 4)),
     {"nullifiers": (("受法信", "no_merit"),)}),
    ("FX", 5, "誦經聖號", "Recitation of scripture and holy names",
     "為國為民，或尊親先亡，或無主孤魂，誦大經一卷為六功，小經一卷為三功，聖號百遍為三功，"
     "為平交親知及卑幼誦大經為四功，小經聖號為二功，為施主誦大經一卷為三功，小經聖號為一功，"
     "若受法信則無功。為己禳謝，誦大經一卷為二功，小經聖號為一功。",
     (("為國為民尊親孤魂誦大經一卷", 6), ("小經一卷", 3), ("聖號百遍", 3),
      ("為平交親知及卑幼誦大經", 4), ("為平交卑幼小經聖號", 2),
      ("為施主誦大經一卷", 3), ("為施主小經聖號", 1),
      ("為己禳謝誦大經一卷", 2), ("為己小經聖號", 1)),
     {"nullifiers": (("受法信", "no_merit"),)}),

    # ---------------- 功格 · 用事門 (12 of 十二條) ------------------------
    ("YS", 1, "興諸善事", "Setting good works afoot",
     "興諸善事，利益一人為一功。", (("利益一人", 1),), {}),
    ("YS", 2, "講演化眾", "Preaching to an assembly",
     "講演經教及諸善言，化諭於眾，在席十人為一功，百人為十功，人數雖多，止五十功。",
     (("在席十人", 1), ("在席百人", 10)),
     {"fungibility_class": "SPEECH", "cap": 50,
      "notes": (
          "「人數雖多，止五十功」是全書唯一的顯式單次上限。若本系統要做單次行為封頂，"
          "這是唯一一處有原文依據的地方。",
      )}),
    ("YS", 3, "文章誡勸", "Admonition in writing",
     "以文章詩詞，誡勸於眾，一篇為一功。", (("一篇", 1),),
     {"fungibility_class": "SPEECH"}),
    ("YS", 4, "化人出財", "Moving others to give",
     "化人出財，修諸功德，一貫為一功。", (("化人出財一貫", 1),),
     {"fungibility_class": "MONEY", "money_rate": RATE_1000_CASH,
      "notes": (
          "換算率與救濟門#7 不同且不是筆誤：賑濟自出貫錢為十功，化人出財一貫僅一功——"
          "勸別人掏錢與自己掏錢不是同一件事。金錢換算率隨版本而變（《十戒功過格》作三十文為一功），"
          "故 money_rate 綁在條上而非全局常量。",
      )}),
    ("YS", 5, "勸免官刑", "Dissuading from litigation",
     "勸人官門鬪訟，免死刑為十功，免徒刑為五功，免杖刑為二功，免笞刑為一功。",
     (("免死刑", 10), ("免徒刑", 5), ("免杖刑", 2), ("免笞刑", 1)),
     {"fungibility_class": "LIFE"}),
    ("YS", 6, "勸諫鬪爭", "Talking men out of a quarrel",
     "勸諫人鬪爭，一人為一功。", (("一人", 1),),
     {"fungibility_class": "SPEECH",
      "notes": (
          "校勘：作「勸諫」，從 ctext 本；維基文庫轉錄本作「勸謙」。"
          "理由是詞彙——「勸諫」是詞，「勸謙」不是。同見用事門#10。",
      )}),
    ("YS", 7, "舉薦賢達", "Recommending the worthy",
     "舉薦高明賢達有德之士用事，一人為十功。", (("一人", 10),), {}),
    ("YS", 8, "讚揚人善", "Praising another's good",
     "讚揚人之善道，一事為一功。", (("一事", 1),), {"fungibility_class": "SPEECH"}),
    ("YS", 9, "掩遏人惡", "Covering another's fault",
     "掩遏人之惡業，一事為一功。", (("一事", 1),), {"fungibility_class": "SPEECH"}),
    ("YS", 10, "勸諫迴心", "Turning a man from wrongdoing",
     "勸諫人令不為非、不廉、不孝、不貞、不良、不善、不慈、不仁、不義，一人迴心為十功。",
     (("一人迴心", 10),),
     {"fungibility_class": "SPEECH",
      "notes": ("校勘：作「勸諫」，從 ctext 本；維基文庫轉錄本作「勸謙」。同見用事門#6。",)}),
    ("YS", 11, "衣服儉素", "Plain clothing",
     "自己著紙衣一件為二功，著布素麄衲之衣一件為一功，〔謂有而不著者是功〕著紈帛者無功。",
     (("著紙衣一件", 2), ("著布素麄衲之衣一件", 1)),
     {"nullifiers": (("著紈帛", "no_merit"),)}),
    ("YS", 12, "飲膳節制", "Abstinence at table",
     "自己飲膳，有而不食者為三功，晚而不食者為二功，素食下味為一功，素食中味為半功，"
     "素食上味為無功。〔謂有上味及素饌佳餚而故不食者…蓋有而故不食者為功。〕",
     (("有而不食", 3), ("晚而不食", 2), ("素食下味", 1), ("素食中味", 0.5)),
     {"nullifiers": (("素食上味", "no_merit"),),
      "notes": (
          "非整數分值：「素食中味為半功」＝0.5 功。另見焚修門#1。",
          "本條夾注在核實報告的轉錄中有省略（「…」處）；未補，需影印本。",
      )}),

    # ---------------- 過律 · 不仁門 (15 of 十五條) ------------------------
    ("BR", 1, "見疾不救", "Refusing to treat the sick",
     "凡有重疾告治，不為拯救者，一人為二過，小疾一人為一過，治不如法為一過，"
     "不愈而受賄百錢為一過，貫錢為十過。",
     (("重疾不救一人", -2), ("小疾不救一人", -1), ("治不如法", -1),
      ("不愈而受賄百錢", -1), ("不愈而受賄貫錢", -10)),
     {"money_rate": RATE_100_CASH}),
    ("BR", 2, "修合毒藥", "Compounding poison",
     "修合毒藥，欲害於人為十過，害人性命為百過，害人不死而病為五十過，"
     "害一切眾生禽畜性命為十過，害而不死為五過，舉意欲害為一過。",
     (("欲害於人", -10), ("害人性命", -100), ("害人不死而病", -50),
      ("害眾生禽畜性命", -10), ("害而不死", -5), ("舉意欲害", -1)),
     {"notes": ("「舉意欲害為一過」——起心動念即入賬，全書共有數處，見不仁門#5。",)}),
    ("BR", 3, "厭禱呪咀", "Malefic ritual",
     "學厭禱呪咀邪法，欲害於人為十過，害人性命為百過，害人不死而病為五十過，"
     "害人六畜一命為十過，令病為五過，舉意欲害為一過，"
     "厭禳人家，令見惟異，欲取財賄為十過，得財百錢為一過，貫錢為十過。",
     (("欲害於人", -10), ("害人性命", -100), ("害人不死而病", -50),
      ("害人六畜一命", -10), ("令病", -5), ("舉意欲害", -1),
      ("厭禳人家欲取財賄", -10), ("得財百錢", -1), ("得財貫錢", -10)),
     {"money_rate": RATE_100_CASH}),
    ("BR", 4, "謀人入罪", "Contriving another's punishment",
     "謀人死刑，成者為百過，不成為五十過，舉意不作為十過；"
     "謀人徒刑，成者為四十過，不成為二十過，舉意不作為八過；"
     "謀人杖刑為十過，不成為八過，舉意為五過；謀人笞刑為三過，不成為四過，舉意為三過。"
     "凡為官吏，入人罪者，同此論。為行法官，妄入〔鬼神〕罪者，亦同此論。",
     (("謀人死刑成", -100), ("謀人死刑不成", -50), ("謀人死刑舉意不作", -10),
      ("謀人徒刑成", -40), ("謀人徒刑不成", -20), ("謀人徒刑舉意不作", -8),
      ("謀人杖刑", -10), ("謀人杖刑不成", -8), ("謀人杖刑舉意", -5),
      ("謀人笞刑", -3), ("謀人笞刑不成", -4), ("謀人笞刑舉意", -3)),
     {"notes": (
         "存疑異文，未定讞：「妄入〔鬼神〕罪」——ctext 本作「妄入鬼神罪者」，"
         "維基文庫本作「妄入罪者」，多／少「鬼神」二字。若 ctext 本對，這是全文唯一一句涉及"
         "「對鬼神定罪」的條文（行法道士妄劾鬼神之罪亦照此論過）。此處〔 〕標的是未定異文，"
         "不是原文夾注。需影印本。",
         "笞刑三檔原文作「三過／四過／三過」，不隨死徒杖三檔遞降，疑為刻誤；照錄不改。",
     )}),
    ("BR", 5, "心中舉惡", "Harm intended in the heart",
     "心中暗舉惡事，欲殘害於人，一人為一過，事成殘害一人為十過，"
     "心意中邪婬雜想非理之事，一事為一過。",
     (("暗舉惡事欲殘害一人", -1), ("事成殘害一人", -10), ("邪婬雜想非理之事一事", -1)), {}),
    ("BR", 6, "惡言傷人", "Words meant to wound",
     "凡言舉惡事，欲殘言於人，一人為一過，事成為十過，惡語向師長、尊親為十過，"
     "向善人為八過，向平交為四過，向卑幼為一過，言約失信為一過，揚人惡事為一過，掩人善事為一過。",
     (("欲殘言於人一人", -1), ("事成", -10), ("惡語向師長尊親", -10),
      ("惡語向善人", -8), ("惡語向平交", -4), ("惡語向卑幼", -1),
      ("言約失信", -1), ("揚人惡事", -1), ("掩人善事", -1)),
     {"fungibility_class": "SPEECH"}),
    ("BR", 7, "殺人", "Killing",
     "故傷殺人性命為百過，誤傷殺性命為八十過，以言遽殺者，同使人殺者，為六十過。",
     (("故傷殺人性命", -100), ("誤傷殺性命", -80), ("以言遽殺／使人殺", -60)), {}),
    ("BR", 8, "殺畜", "Killing beasts",
     "故殺有力報人之畜，一命為十過，誤殺為五過；故殺無力報人之畜，飛禽走獸之類，"
     "一命為八過，誤殺為四過；故殺蟲蟻飛蛾濕生之屬，一命為二過，誤殺為一過；"
     "故殺傷人害物者、惡獸毒蟲為一過。〔謂虎、狼、蛇、蝎、毒蟲之屬〕使人殺者同上論。",
     (("故殺有力報人之畜一命", -10), ("誤殺有力報人之畜", -5),
      ("故殺無力報人之畜一命", -8), ("誤殺無力報人之畜", -4),
      ("故殺蟲蟻飛蛾濕生一命", -2), ("誤殺蟲蟻飛蛾濕生", -1),
      ("故殺傷人害物之惡獸毒蟲", -1)), {}),
    ("BR", 9, "見殺不救", "Standing by at a killing",
     "見殺不救，隨本人之過減半，無門可救，不生慈念為二過，助讚殺生為五過。",
     (("無門可救而不生慈念", -2), ("助讚殺生", -5)),
     {"derived": {"of": "actor_offence", "factor": 0.5,
                  "condition_zh": "見殺不救，隨本人之過減半"},
      "notes": (
          "「隨本人之過減半」是派生值，不是常數：旁觀者之過＝行為人之過÷2。"
          "本系統在 payload.derived 記下這條規則，但不計算它——"
          "SoulRecord 沒有把一條記錄關聯到另一條記錄的行為人的欄位。",
      )}),
    ("BR", 10, "救得而不救", "Able to save and not saving",
     "若救得而不救者為十過，無門可救，不生慈念者為一過。",
     (("救得而不救", -10), ("無門可救不生慈念", -1)), {}),
    ("BR", 11, "幸災", "Taking pleasure in another's trouble",
     "見人有憂，不行解釋而故暢快者為五過。", (("見人有憂而故暢快", -5),),
     {"fungibility_class": "CONDUCT"}),
    ("BR", 12, "見死不慈", "No pity at a death",
     "見人畜死，不起慈念者為一過。"
     "〔凡言慈念者，謂見苦不能得救，止以持念聖號經文，迴向以結善緣也。〕",
     (("見人畜死不起慈念", -1),), {}),
    ("BR", 13, "剛使役", "Driving man or beast past exhaustion",
     "役使人畜，至於疲乏力倦，不矜其苦而剛使役者，一時為十過，加之鞭笞者，一杖為一過。",
     (("剛使役一時", -10), ("加之鞭笞一杖", -1)), {}),
    ("BR", 14, "用水陷溺路徑", "Flooding a road",
     "用水陷溺路徑，使人畜出入行履艱難者，一時為十過。", (("一時", -10),), {}),
    ("BR", 15, "摧毀船橋", "Destroying a ferry or bridge",
     "摧毀船橋，使不通渡者，一時為十過。", (("一時", -10),), {}),

    # ---------------- 過律 · 不善門 (8 of 八條) ---------------------------
    ("BS", 1, "毀壞功德聖像", "Destroying sacred objects",
     "毀壞功德、聖像、壇宇…及諸獻供之物，百錢之直為一過，貫錢之直為十過，"
     "以巧言說人，毀壞百錢之直為半過，貫錢之直為五過，見而不觀為一過，讚助為五過。",
     (("毀壞百錢之直", -1), ("毀壞貫錢之直", -10),
      ("以巧言說人毀壞百錢之直", -0.5), ("以巧言說人毀壞貫錢之直", -5),
      ("見而不觀", -1), ("讚助", -5)),
     {"money_rate": RATE_100_CASH,
      "abridged": True,
      "notes": (
          "非整數分值：「以巧言說人，毀壞百錢之直為半過」＝-0.5 過。",
          "轉錄省略：本條原文在核實報告的轉錄中有「…」省略處，未補。需影印本補全。",
      )}),
    ("BS", 2, "指斥聖像經教", "Reviling images and scripture",
     "以言指斥，毀天尊聖像為二十過，真人為十五過，神君為十過，見毀滅不勸為一過，"
     "讚助毀滅為五過，毀滅經教，與此同論。",
     (("指斥天尊聖像", -20), ("指斥真人", -15), ("指斥神君", -10),
      ("見毀滅不勸", -1), ("讚助毀滅", -5)), {}),
    ("BS", 3, "齋日不朝真", "Missing observance on a fast day",
     "每遇齋日及諸節令吉辰，故不朝真為二過，因私務不及並非齋日為一過，因公務不及無過，"
     "為食酒肉葷辛及犯觸不朝真為五過，忌日誤朝真為一過。",
     (("故不朝真", -2), ("因私務不及並非齋日", -1),
      ("為食酒肉葷辛及犯觸不朝真", -5), ("忌日誤朝真", -1)),
     {"nullifiers": (("因公務不及", "no_demerit"),),
      "notes": (
          "「因公務不及無過」是豁免條款，不是計分條款——與功格側的「則無功」同一機制、方向相反，"
          "故同記在 payload.nullifiers，effect 作 no_demerit。",
      )}),
    ("BS", 4, "晚食", "Eating late",
     "遇節辰食晚食為二過，常日晚食為一過。",
     (("節辰食晚食", -2), ("常日晚食", -1)), {}),
    ("BS", 5, "齋醮不備", "Faults in the conduct of a rite",
     "齋醮供聖鎮信之物，一物不備為一過，章詞一字差錯為一過…三時朝真，一時有失為五過，"
     "供養進獻之物，一物不備為一過，一物不潔為一過，及不如法為一過。",
     (("一物不備", -1), ("章詞一字差錯", -1), ("三時朝真一時有失", -5),
      ("供養進獻一物不備", -1), ("一物不潔", -1), ("不如法", -1)),
     {"abridged": True,
      "notes": ("轉錄省略：本條原文在核實報告的轉錄中有「…」省略處，未補。需影印本補全。",)}),
    ("BS", 6, "妄用法信錢物", "Misusing a donor's offering",
     "應受施主法信錢物，非理使用，百錢為一過，貫錢為十過。",
     (("非理使用百錢", -1), ("非理使用貫錢", -10)),
     {"fungibility_class": "MONEY", "money_rate": RATE_100_CASH}),
    ("BS", 7, "符簡差錯", "Errors in a written talisman",
     "薦亡符簡文字等，一字差錯為一過，脫漏一字為一過，符文差錯脫漏為十過，修寫書篆不如法為五過。",
     (("一字差錯", -1), ("脫漏一字", -1), ("符文差錯脫漏", -10), ("修寫書篆不如法", -5)), {}),
    ("BS", 8, "誦經有失", "Faults in recitation",
     "誦念經典，漏一字為一過，漏一句為五過…心意不專為五過，邪婬雜想及思惡事為十過…"
     "念經發嗔怒為十過，凌辱他人為十過。"
     "〔凡言十過，其功全無，並是虛念。但一過去功一分，十過去功十分，所以不用也。〕",
     (("漏一字", -1), ("漏一句", -5), ("心意不專", -5),
      ("邪婬雜想及思惡事", -10), ("念經發嗔怒", -10), ("凌辱他人", -10)),
     {"abridged": True,
      "notes": (
          "本條夾注是全書唯一一處把功過相抵寫成算術的地方：「但一過去功一分，十過去功十分」"
          "——過直接抵銷功，一比一。這是 apps/ledger/readings.py 的中國側淨額讀數的原文依據；"
          "抵銷的類別限制另見《文昌帝君功過格·凡例》，記在 payload.fungibility_class。",
          "轉錄省略：本條原文在核實報告的轉錄中有兩處「…」省略，未補。需影印本補全。",
      )}),

    # ---------------- 過律 · 不義門 (10 of 十條) --------------------------
    ("BY", 1, "教唆鬪訟", "Inciting litigation",
     "教唆人官門鬪訟，死刑為三十過，徒刑為二十過，杖罪為十過；笞罪為八過。",
     (("致死刑", -30), ("致徒刑", -20), ("致杖罪", -10), ("致笞罪", -8)),
     {"fungibility_class": "LIFE"}),
    ("BY", 2, "教唆鬪爭", "Inciting a quarrel",
     "教唆人鬪爭，一人為一過。", (("一人", -1),), {"fungibility_class": "SPEECH"}),
    ("BY", 3, "教人為非", "Teaching another to do wrong",
     "教人為不廉、不孝、不義、不仁、不善、不慈，為非作過，一事為一過。",
     (("一事", -1),), {"fungibility_class": "SPEECH"}),
    ("BY", 4, "見賢不薦", "Passing over the worthy",
     "見賢不薦為一過，見賢不師為一過。",
     (("見賢不薦", -1), ("見賢不師", -1)), {"fungibility_class": "CONDUCT"}),
    ("BY", 5, "背師", "Failing or betraying a teacher",
     "見明師不參授典教為二過，不依師之教旨為十過，反叛師長為五十過，違師教公為三十過，"
     "尊長父母同此論。",
     (("見明師不參授典教", -2), ("不依師之教旨", -10),
      ("反叛師長", -50), ("違師教公", -30)),
     {"fungibility_class": "CONDUCT"}),
    ("BY", 6, "不交良友", "Refusing good company",
     "良朋勝友不交，設為一過。", (("不交", -1),), {"fungibility_class": "CONDUCT"}),
    ("BY", 7, "窮民不濟", "Refusing the destitute",
     "窮民不濟為一過，復加凌辱一人為三過。",
     (("窮民不濟", -1), ("復加凌辱一人", -3)), {}),
    ("BY", 8, "偷盜", "Theft",
     "偷盜人財物，或教人偷盜，百錢為一過，貫錢為十過；若見偷盜，不勸為一過，讚助偷盜為五過，"
     "米麥幣帛衣服，並論錢數定過。",
     (("偷盜百錢", -1), ("偷盜貫錢", -10), ("見偷盜不勸", -1), ("讚助偷盜", -5)),
     {"money_rate": RATE_100_CASH}),
    ("BY", 9, "不義取財", "Taking what is not rightfully one's own",
     "不義而取人財物，百錢為一過，貫錢為十過。",
     (("不義取財百錢", -1), ("不義取財貫錢", -10)), {"money_rate": RATE_100_CASH}),
    ("BY", 10, "欠財不還", "Withholding a debt",
     "欠人財物，抵諱不還，百錢為一過，貫錢為十過，因而謀害，其過加倍。",
     (("抵諱不還百錢", -1), ("抵諱不還貫錢", -10)),
     {"money_rate": RATE_100_CASH,
      "multipliers": (("因而謀害", 2),),
      "notes": (
          "「其過加倍」是全書唯一的倍率條款。《文昌帝君功過格·凡例》另有系統性的倍率規則"
          "（祖父母、繼母每功加倍等），太微沒有；不要把文昌的倍率搬到本語料上。",
      )}),

    # ---------------- 過律 · 不軌門 (5 transcribed of 六條) ---------------
    ("BG", 1, "傳法出偽、注撰煙粉", "False transmission; writing erotica",
     "傳教法，隱真出偽，欺罔弟子，一事為五過；如受法信，百錢為一過，得人不傳為一過，傳非其人為十過。"
     "注撰煙粉傳記、詩詞、歌行，一篇為二過，傳與一人為二過，簡編一篇為一過，傳與一人為一過，"
     "自己記念一篇為一過。",
     (("隱真出偽欺罔弟子一事", -5), ("受法信百錢", -1),
      ("得人不傳", -1), ("傳非其人", -10),
      ("注撰煙粉傳記詩詞歌行一篇", -2), ("傳與一人", -2),
      ("簡編一篇", -1), ("簡編傳與一人", -1), ("自己記念一篇", -1)),
     {"money_rate": RATE_100_CASH,
      "transcription_gap": {
          "gate_titled": "六條", "gate_transcribed": 5,
          "conjectured_split_here": True,
          "conjecture": "門題六條，兩個轉錄本都只有 5 段。報告推測本段實含兩個不相干主題"
                        "（「傳教法，隱真出偽…」與「注撰煙粉傳記…」）並在報告的表中拆成兩行，"
                        "但明確註明那是編輯判斷而非原刻分段。本系統照轉錄本作一條，不拆。",
      },
      "notes": (TRANSCRIPTION_GAP_NOTE,)}),
    ("BG", 2, "食肉", "Eating meat",
     "食肉，故殺性命食之為六過，買肉食之為三過，違禁肉故食為六過，誤食為三過，"
     "過齋日食之為十過，食後入壇念善為十過。",
     (("故殺性命食之", -6), ("買肉食之", -3), ("違禁肉故食", -6),
      ("違禁肉誤食", -3), ("過齋日食之", -10), ("食後入壇念善", -10)), {}),
    ("BG", 3, "飲酒", "Drinking",
     "飲酒為評議惡事，與人飲一升為六過，無故與不良人飲一升為二過，無故與常人飲一升為一過，"
     "助婬懽飲一升為十過；為和合事理，與友人飲，祭酒、待賓、服藥，皆不坐；"
     "過齋日飲致醉，或酒後入壇念善為五過。",
     (("為評議惡事與人飲一升", -6), ("無故與不良人飲一升", -2),
      ("無故與常人飲一升", -1), ("助婬懽飲一升", -10),
      ("過齋日飲致醉／酒後入壇念善", -5)),
     {"nullifiers": (("為和合事理與友人飲", "no_demerit"), ("祭酒", "no_demerit"),
                     ("待賓", "no_demerit"), ("服藥", "no_demerit")),
      "notes": (
          "撤回的 CN-HL-* 語料把「飲酒」列為十惡之一，那是錯的——飲酒不在佛教十惡中"
          "（見 docs/lore-verification/verify-cn-structure.md §4 錯誤 #1）。"
          "功過格是「飲酒」這一條在本系統中唯一站得住的出處，"
          "且必須連同豁免條款一起用：「為和合事理，與友人飲，祭酒、待賓、服藥，皆不坐」。",
      )}),
    ("BG", 4, "食五辛", "Eating the five pungent roots",
     "五辛無故食之，一食為一過，食後持念經一大卷為十過，一小經為五過，一聖號為一過，"
     "齋日食之為五過。",
     (("無故食之一食", -1), ("食後持念大經一卷", -10), ("食後持念小經", -5),
      ("食後持念聖號", -1), ("齋日食之", -5)), {}),
    ("BG", 5, "受觸", "Ritual defilement",
     "受觸極親為五十過，近親為三十過，遠親為二十過，良家為十五過，"
     "受觸之後，入壇念道、朝真、禮聖及齋日犯觸隨儀，每一過為五過。",
     (("受觸極親", -50), ("受觸近親", -30), ("受觸遠親", -20), ("受觸良家", -15),
      ("受觸後入壇念道朝真禮聖及齋日犯觸隨儀每一過", -5)), {}),
]


def _gongguoge_rows():
    """Expand GONGGUOGE_ENTRIES into the row shape `_seed_statutes` consumes.

    Built rather than written out, because the parts that repeat 73 times —
    the appropriation note, the gate metadata, the corpus-wide payload keys —
    are exactly the parts that must not be allowed to differ between rows. The
    parts that are per-article (the text, every point value, every caveat) are
    literal above and are never derived from anything.

    `ordinal` is continuous 1..73 in document order — 功格 then 過律 — and NOT
    the number within the 門, which is carried separately as
    `payload["gate_ordinal"]`. `Statute.Meta.ordering` sorts on `ordinal`, so a
    per-gate numbering would interleave 救濟門一 with 不仁門一 and read the
    corpus out of the order the document has.

    `text_en` is left empty on every row, on purpose. `get_localized_text`
    falls back to `text_zh`, so an English reader sees the 1171 Chinese rather
    than a translation this seeder would be the sole author of. Titles are
    glossed because a picker needs a label; the articles are not, because a
    loose English rendering of a scoring clause is a different scoring clause.
    """
    rows = []
    for ordinal, entry in enumerate(GONGGUOGE_ENTRIES, start=1):
        gate_key, gate_ordinal, title_zh, title_en, text_zh, clauses, extras = entry
        segment, polarity, gate_zh, gate_en, titled, unit, default_class = (
            GONGGUOGE_GATES[gate_key]
        )
        payload = {
            "gate": gate_zh,
            "gate_en": gate_en,
            "gate_ordinal": gate_ordinal,
            "gate_titled_count": titled,
            "unit": unit,
            "clauses": [
                {"condition_zh": condition, "points": points}
                for condition, points in clauses
            ],
            "nullifiers": [
                {"condition_zh": condition, "effect": effect}
                for condition, effect in extras.get("nullifiers", ())
            ],
            "multipliers": [
                {"condition_zh": condition, "factor": factor}
                for condition, factor in extras.get("multipliers", ())
            ],
            "cap": extras.get("cap"),
            "derived": extras.get("derived"),
            "money_rate": extras.get("money_rate"),
            "fungibility_class": extras.get("fungibility_class", default_class),
            # Every point value in this corpus is the document's own. The
            # withdrawn CN-HL-* rows are what happens when that is not tracked:
            # 「+100 孝养父母」 with nothing behind the number.
            "attestation": "PRIMARY",
            # Not the judgment basis the text itself claims — see
            # APPROPRIATION_NOTE. Kept as a queryable flag so a report can ask
            # "what in this database is used for something its source does not
            # say" without parsing prose.
            "appropriated_as_judgment_basis": True,
            "native_sanctions": ["奪紀奪算", "成仙閾值（三百善／一千三百善）", "子孫餘慶餘殃"],
            "names_any_hell": False,
        }
        if "transcription_gap" in extras:
            payload["transcription_gap"] = extras["transcription_gap"]
        if extras.get("abridged"):
            payload["text_abridged_in_transcription"] = True
        rows.append({
            "code": f"CN-GGG-{segment}-{gate_ordinal:02d}",
            "ordinal": ordinal,
            "polarity": polarity,
            "title_zh": f"{gate_zh}·{title_zh}",
            "title_en": title_en,
            "text_zh": text_zh,
            "text_en": "",
            "notes": [
                APPROPRIATION_NOTE,
                FUNGIBILITY_CLASS_NOTE,
                *extras.get("notes", ()),
            ],
            "payload": payload,
        })
    return rows


CHINESE_STATUTES = _gongguoge_rows()

# CLI label -> (corpus, source, rows) for a corpus TRANSCRIBED into this file.
# Egyptian is absent for the opposite reason to the other two — its corpus is
# derived rather than transcribed, see _seed_derived_statutes.
CIVILIZATION_STATUTES = {
    "chinese": ("GONGGUOGE", GONGGUOGE_SOURCE, CHINESE_STATUTES),
    "european": ("DEADLY_SIN", DEADLY_SIN_SOURCE, EUROPEAN_STATUTES),
}

# What the Egyptian derivation reads off each assessor, and where it files the
# result. `NEGATIVE_CONFESSION_FIELD` is stored on every derived row
# (`Statute.source_actor_field`) rather than hardcoded in the model, so the
# derivation is legible from the data itself.
NEGATIVE_CONFESSION_FIELD = "negative_confession"
NEGATIVE_CONFESSION_SOURCE = (
    "Derived from the assessor actor seeded by this same command — the clause "
    "lives on Actor.powers_json['negative_confession'] and is read from there, "
    "never copied. Edition and papyrus are recorded on that row."
)

# CLI label -> (Civilization, realms, actors). The CLI label is lowercase for
# typing convenience; the stored value is always the Civilization enum.
CIVILIZATION_DATA = {
    "chinese": (Civilization.CHINESE, CHINESE_REALMS, CHINESE_ACTORS),
    "european": (Civilization.EUROPEAN, EUROPEAN_REALMS, EUROPEAN_ACTORS),
    "egyptian": (Civilization.EGYPTIAN, EGYPTIAN_REALMS, EGYPTIAN_ACTORS),
}

REALM_FIELDS = (
    "name_local", "name_zh", "name_en", "name_egy", "realm_type", "tier",
    "description", "memory_reset_mechanism", "is_eternal", "cycle_limit",
)
ACTOR_FIELDS = (
    "name_zh", "name_en", "name_egy", "role", "realm",
    "title", "title_zh", "title_en", "title_egy", "description",
)
# Assessors carry the same columns plus the structured payload — an assessor
# whose assessor_index or citation drifted is a changed row, so `--update` has
# to see it.
ASSESSOR_FIELDS = (*ACTOR_FIELDS, "powers_json")
# `source` and `source_notes` are in the comparison set deliberately: an
# article whose provenance changed is a changed article, and provenance is the
# part of a statute this feature exists to keep honest.
STATUTE_FIELDS = (
    "civilization", "corpus", "ordinal", "polarity",
    "title_zh", "title_en", "title_egy", "text_zh", "text_en", "text_egy",
    "source", "source_notes", "payload_json",
    "source_actor", "source_actor_field",
)


class Stats:
    """Per-model tally, printed as the run summary."""

    def __init__(self, label):
        self.label = label
        self.created = 0
        self.updated = 0
        self.unchanged = 0
        self.skipped = 0

    def line(self):
        return (
            f"{self.label:<8} created={self.created:<4} updated={self.updated:<4} "
            f"unchanged={self.unchanged:<4} skipped={self.skipped}"
        )


class Command(BaseCommand):
    help = (
        "Seed the three civilizations' mythology reference data (tenants, realms, "
        "actors). Idempotent: re-running creates nothing new."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--civilization",
            choices=[*CIVILIZATION_DATA, "all"],
            default="all",
            help="Seed only one civilization. Default: all three.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would be created/updated and write nothing.",
        )
        parser.add_argument(
            "--update",
            action="store_true",
            help=(
                "Also refresh existing rows to the seed values. Off by default so "
                "this command does not undo fix_actor_civilization / "
                "consolidate_eu_pantheon."
            ),
        )

    def handle(self, *args, **options):
        selection = options["civilization"]
        dry_run = options["dry_run"]
        do_update = options["update"]

        labels = list(CIVILIZATION_DATA) if selection == "all" else [selection]
        mode = "DRY-RUN" if dry_run else "WRITE"
        self.stdout.write(self.style.WARNING(
            f"=== seed_mythology ({mode}, civilizations={','.join(labels)}, "
            f"update={'on' if do_update else 'off'}) ===\n"
        ))

        tenant_stats = Stats("tenants")
        realm_stats = Stats("realms")
        actor_stats = Stats("actors")
        statute_stats = Stats("statutes")

        with transaction.atomic():
            for label in labels:
                civilization, realms, actors = CIVILIZATION_DATA[label]
                self.stdout.write(self.style.MIGRATE_HEADING(f"[{label}] {civilization}"))

                tenant = self._seed_tenant(civilization, tenant_stats)
                self._seed_realms(civilization, tenant, realms, do_update, realm_stats)
                self._seed_actors(civilization, tenant, actors, do_update, actor_stats)
                assessors = CIVILIZATION_ASSESSORS.get(label)
                if assessors:
                    self._seed_assessors(
                        civilization, tenant, assessors, do_update, actor_stats
                    )
                # Statutes come last within a civilization: the Egyptian corpus
                # is derived from the assessor rows written immediately above,
                # and reads them back out of this same transaction.
                corpus = CIVILIZATION_STATUTES.get(label)
                if corpus is not None:
                    self._seed_statutes(
                        civilization, tenant, *corpus, do_update, statute_stats
                    )
                if assessors:
                    self._seed_derived_statutes(
                        civilization, tenant, do_update, statute_stats
                    )
                self.stdout.write("")

            if dry_run:
                transaction.set_rollback(True)

        self.stdout.write(self.style.MIGRATE_HEADING("Summary"))
        for stats in (tenant_stats, realm_stats, actor_stats, statute_stats):
            self.stdout.write(f"  {stats.line()}")

        if dry_run:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING(
                "Dry-run only — nothing was written. Re-run without --dry-run to apply."
            ))
        else:
            self.stdout.write(self.style.SUCCESS("\nSeed complete."))

    # ------------------------------------------------------------------
    # Tenants
    # ------------------------------------------------------------------
    def _seed_tenant(self, civilization, stats):
        code = CIVILIZATION_TENANT[civilization]
        tenant = Tenant.objects.filter(code=code).first()
        if tenant is not None:
            stats.unchanged += 1
            return tenant

        self.stdout.write(f"  + Tenant {code}")
        stats.created += 1
        # Written even in dry-run: the whole run is one transaction that gets
        # rolled back at the end, and writing means a dry-run against an empty
        # database resolves realm FKs and reports the same plan a real run
        # would take, rather than a cascade of "unknown realm" warnings.
        return Tenant.objects.create(
            code=code, display_name=TENANTS[code], dispatch_enabled=True
        )

    # ------------------------------------------------------------------
    # Realms
    # ------------------------------------------------------------------
    def _seed_realms(self, civilization, tenant, rows, do_update, stats):
        for row in rows:
            (realm_code, name_local, name_zh, name_en, name_egy, realm_type, tier,
             description, memory_reset, is_eternal, cycle_limit) = row
            values = {
                "civilization": civilization,
                "name_local": name_local,
                "name_zh": name_zh,
                "name_en": name_en,
                "name_egy": name_egy,
                "realm_type": realm_type,
                "tier": tier,
                "description": description,
                "memory_reset_mechanism": memory_reset,
                "is_eternal": is_eternal,
                "cycle_limit": cycle_limit,
            }
            self._upsert(
                model=Realm,
                lookup={"realm_code": realm_code},
                values=values,
                compare_fields=("civilization", *REALM_FIELDS),
                tenant=tenant,
                identity=f"Realm {realm_code}",
                do_update=do_update,
                stats=stats,
            )
        self._link_realm_parents(civilization, rows, do_update, stats)

    def _link_realm_parents(self, civilization, rows, do_update, stats):
        """Attach the realms in REALM_PARENTS to the realm they are part of.

        A second pass rather than a column in `values`: the parent has to exist
        before the child can point at it, and both are rows in the same table
        this loop is still writing. Running afterwards means the order of the
        seed table cannot decide whether the link resolves.

        Filling in a NULL parent happens regardless of `--update`, for the same
        reason `_upsert` fills in a NULL tenant regardless: an unset structural
        link is not somebody's decision being overwritten, it is a row that has
        not been told what it belongs to yet. Repointing a parent that is
        already set to something else IS a decision, and that needs --update.
        """
        codes = {row[0] for row in rows}
        by_code = {
            realm.realm_code: realm
            for realm in Realm.all_objects.filter(civilization=civilization)
        }
        for child_code, parent_code in REALM_PARENTS.items():
            if child_code not in codes:
                continue
            child = by_code.get(child_code)
            parent = by_code.get(parent_code)
            if child is None or parent is None:
                missing = child_code if child is None else parent_code
                self.stdout.write(self.style.ERROR(
                    f"  [warn] Realm {child_code} belongs under {parent_code} and "
                    f"{missing} is not in the database — left unlinked"
                ))
                continue
            if child.is_deleted:
                # Same rule as _upsert: a retired row is reported by that pass
                # and otherwise left exactly as it is.
                continue
            if child.parent_realm_id == parent.id:
                continue
            if child.parent_realm_id is None or do_update:
                self.stdout.write(f"  ~ Realm {child_code}: parent_realm -> {parent_code}")
                stats.updated += 1
                child.parent_realm = parent
                child.save()
                continue
            self.stdout.write(
                f"  = Realm {child_code}: sits under "
                f"{child.parent_realm.realm_code} rather than {parent_code} — "
                f"left as-is (pass --update to overwrite)"
            )

    # ------------------------------------------------------------------
    # Actors
    # ------------------------------------------------------------------
    def _seed_actors(self, civilization, tenant, rows, do_update, stats):
        # Realm FKs are resolved by code against whatever is in the DB now —
        # including the realms this same run just wrote inside this transaction.
        realm_by_code = {r.realm_code: r for r in Realm.all_objects.filter(civilization=civilization)}

        for row in rows:
            (name, name_zh, name_en, name_egy, role, realm_code,
             title, title_zh, title_en, title_egy, description) = row
            realm = realm_by_code.get(realm_code)
            if realm is None:
                self.stdout.write(self.style.ERROR(
                    f"  [warn] Actor {name!r} references unknown realm {realm_code!r} — "
                    f"seeding with realm=None"
                ))
            values = {
                "name_zh": name_zh,
                "name_en": name_en,
                "name_egy": name_egy,
                "role": role,
                "realm": realm,
                "title": title,
                "title_zh": title_zh,
                "title_en": title_en,
                "title_egy": title_egy,
                "description": description,
            }
            self._upsert(
                model=Actor,
                lookup={"name": name, "civilization": civilization},
                values=values,
                compare_fields=ACTOR_FIELDS,
                tenant=tenant,
                identity=f"Actor {name}",
                do_update=do_update,
                stats=stats,
            )

    # ------------------------------------------------------------------
    # The Forty-Two Assessors
    # ------------------------------------------------------------------
    def _seed_assessors(self, civilization, tenant, rows, do_update, stats):
        """Seed the bench of 42 through the same upsert as everything else.

        Separate from `_seed_actors` only because the rows carry three values
        Actor has no column for (position in the bench, home town, confession
        clause) and they go into `powers_json`. Idempotency, tenant assignment,
        soft-delete handling and dry-run all come from `_upsert` unchanged.
        """
        realm = Realm.all_objects.filter(
            civilization=civilization, realm_code=ASSESSOR_REALM_CODE
        ).first()
        if realm is None:
            self.stdout.write(self.style.ERROR(
                f"  [warn] The Forty-Two reference unknown realm "
                f"{ASSESSOR_REALM_CODE!r} — seeding with realm=None"
            ))

        for row in rows:
            index = row["index"]
            powers = {
                "assessor_index": index,
                "home_place": row["home_place"],
                "negative_confession": row["denies"],
                "source_edition": ASSESSOR_SOURCE_EDITION,
                "papyrus": ASSESSOR_PAPYRUS,
            }
            if row.get("notes"):
                # Verbatim source caveats. Present only where the source is
                # actually uncertain, so an empty key never reads as "checked".
                powers["source_notes"] = list(row["notes"])

            title = f"Assessor {index} of the Forty-Two"
            values = {
                # name_zh stays empty on purpose — see the table's header.
                "name_zh": "",
                "name_en": row["name"],
                "name_egy": row["name"],
                "role": ActorRole.JUDGE,
                "realm": realm,
                "title": title,
                "title_zh": f"四十二判官之第{index}位",
                "title_en": title,
                "title_egy": "",
                "description": self._assessor_description(row),
                "powers_json": powers,
            }
            self._upsert(
                model=Actor,
                lookup={"name": row["name"], "civilization": civilization},
                values=values,
                compare_fields=ASSESSOR_FIELDS,
                tenant=tenant,
                identity=f"Assessor {index:02d} {row['name']}",
                do_update=do_update,
                stats=stats,
            )

    # ------------------------------------------------------------------
    # Statutes
    # ------------------------------------------------------------------
    def _seed_statutes(self, civilization, tenant, corpus, source, rows, do_update, stats):
        """Seed one corpus transcribed from a document into CIVILIZATION_STATUTES.

        One corpus is transcribed today: the seven capital sins, one article per
        terrace of Purgatorio (EUROPEAN_STATUTES). This path was kept alive
        while CIVILIZATION_STATUTES was empty — the withdrawal removed two
        fabricated tables, not the ability to seed a real one — and
        tests/test_judgment_statutes.py still calls it directly with a throwaway
        row, which is what the next corpus (功過格, if it verifies) will arrive
        through.

        Matched on `code`, which is why real codes should be stable and
        mnemonic rather than generated: a citation recorded against an article
        has to survive a re-seed, and a re-numbering would silently repoint
        every judgment that cited it.

        `code` alone, not `(tenant, code)` — the same shape realms use with
        `realm_code`. The uniqueness constraint on the model is per-tenant, but
        every code here is civilization-prefixed and so globally unique in
        practice; matching on the pair would also collide with `_upsert`'s own
        `tenant=` argument. If two tenants ever did share a code, `_upsert`
        reports the ambiguity and skips rather than picking one.
        """
        for row in rows:
            values = {
                "civilization": civilization,
                "corpus": corpus,
                "ordinal": row["ordinal"],
                "polarity": row["polarity"],
                "title_zh": row["title_zh"],
                "title_en": row["title_en"],
                "title_egy": "",
                "text_zh": row["text_zh"],
                "text_en": row["text_en"],
                "text_egy": "",
                "source": source,
                "source_notes": list(row.get("notes", ())),
                "payload_json": dict(row.get("payload", {})),
                "source_actor": None,
                "source_actor_field": "",
            }
            self._upsert(
                model=Statute,
                lookup={"code": row["code"]},
                values=values,
                compare_fields=STATUTE_FIELDS,
                tenant=tenant,
                identity=f"Statute {row['code']}",
                do_update=do_update,
                stats=stats,
            )

    def _seed_derived_statutes(self, civilization, tenant, do_update, stats):
        """Give each of the Forty-Two a citable article — by reference, not by copy.

        The clause itself is never written here. Each row records WHICH actor
        it derives from and WHICH key of that actor's `powers_json` holds the
        text; `Statute.derived_text` reads it back. Correct an assessor's
        confession clause and every judgment that cited it reads the corrected
        text, because there is only ever one copy of it.

        The assessors are found by inspecting `powers_json` in Python rather
        than with a `powers_json__has_key` lookup. JSON key lookups are backend
        -specific and this command runs against SQLite locally and PostgreSQL
        in Docker/CI; fifty-odd Egyptian actors is not a query worth risking a
        backend disagreement over.
        """
        assessors = [
            actor
            for actor in Actor.all_objects.filter(civilization=civilization, is_deleted=False)
            if isinstance(actor.powers_json, dict)
            and actor.powers_json.get("assessor_index") is not None
        ]
        if not assessors:
            # Not silent: an empty derivation means the assessor seed did not
            # run or was skipped, and a corpus that quietly seeds zero articles
            # is exactly the vacuous-success this file's tests guard against.
            self.stdout.write(self.style.ERROR(
                "  [warn] No assessors carry an assessor_index — the Egyptian "
                "statute corpus derives from them and will be empty."
            ))
            return

        assessors.sort(key=lambda actor: actor.powers_json["assessor_index"])
        for actor in assessors:
            index = actor.powers_json["assessor_index"]
            clause = actor.powers_json.get(NEGATIVE_CONFESSION_FIELD) or ""
            if not clause:
                self.stdout.write(self.style.ERROR(
                    f"  [warn] Assessor {index} ({actor.name}) has no "
                    f"{NEGATIVE_CONFESSION_FIELD!r} — deriving an article with "
                    f"no text."
                ))
            values = {
                "civilization": civilization,
                "corpus": "NEGATIVE_CONFESSION",
                "ordinal": index,
                # A denial, not a prohibition. See StatutePolarity.
                "polarity": "DENIAL",
                # The title is the assessor before whom the denial is made; the
                # body is the denial, and the body is NOT stored.
                "title_zh": "",
                "title_en": actor.name,
                "title_egy": actor.name_egy or actor.name,
                "text_zh": "",
                "text_en": "",
                "text_egy": "",
                "source": NEGATIVE_CONFESSION_SOURCE,
                "source_notes": [],
                "payload_json": {"assessor_index": index},
                "source_actor": actor,
                "source_actor_field": NEGATIVE_CONFESSION_FIELD,
            }
            self._upsert(
                model=Statute,
                lookup={"code": f"EG-NC-{index:02d}"},
                values=values,
                compare_fields=STATUTE_FIELDS,
                tenant=tenant,
                identity=f"Statute EG-NC-{index:02d} ({actor.name})",
                do_update=do_update,
                stats=stats,
            )

    @staticmethod
    def _assessor_description(row):
        parts = [
            f"Assessor {row['index']} of the Forty-Two of Ma'at, "
            f"Book of the Dead chapter 125."
        ]
        if row["meaning"]:
            parts.append(f"Budge glosses the name as \"{row['meaning']}\".")
        if row["home_place"]:
            parts.append(f"Comes forth from {row['home_place']}.")
        else:
            parts.append("The text gives no home place for this one.")
        parts.append(f"Denies {row['denies']}.")
        parts.append(f"Papyrus of {ASSESSOR_PAPYRUS}. {ASSESSOR_SOURCE_EDITION}")
        for note in row.get("notes", ()):
            parts.append(f"Note: {note}")
        return " ".join(parts)

    # ------------------------------------------------------------------
    # Shared upsert
    # ------------------------------------------------------------------
    def _upsert(self, *, model, lookup, values, compare_fields, tenant, identity,
                do_update, stats):
        """Create-or-reconcile one row, keyed on `lookup`.

        `all_objects` rather than `objects`, so a soft-deleted row is *seen*
        (and deliberately left alone) instead of being invisible and then
        colliding with the unique constraint on insert.
        """
        existing = list(model.all_objects.filter(**lookup))
        alive = [obj for obj in existing if not obj.is_deleted]

        if len(alive) > 1:
            # Duplicate rows predate this command (see fix_actor_civilization).
            # Reconciling them is that command's job; say so and move on.
            self.stdout.write(self.style.ERROR(
                f"  [warn] {identity}: {len(alive)} live rows match {lookup} — "
                f"ambiguous, skipping. Run `manage.py fix_actor_civilization` to dedupe."
            ))
            stats.skipped += 1
            return

        if not alive:
            if existing:
                self.stdout.write(
                    f"  [skip] {identity}: only soft-deleted row(s) match — not resurrecting "
                    f"(reason: {existing[0].delete_reason or 'none recorded'})"
                )
                stats.skipped += 1
                return
            self.stdout.write(f"  + {identity}")
            stats.created += 1
            model.all_objects.create(**lookup, **values, tenant=tenant)
            return

        obj = alive[0]
        changed = [
            field for field in (*compare_fields, "tenant")
            if getattr(obj, field, None) != (tenant if field == "tenant" else values.get(field))
        ]
        # A row seeded before tenants were assigned has tenant=None; filling
        # that in is not an edit to the mythology, it is the row finally becoming
        # visible to the tenant that owns it, so it happens regardless of
        # --update.
        tenant_only = changed == ["tenant"]

        if not changed:
            stats.unchanged += 1
            return

        if do_update or tenant_only:
            what = "tenant" if tenant_only else ", ".join(changed)
            self.stdout.write(f"  ~ {identity}: {what}")
            stats.updated += 1
            if do_update:
                for field, value in values.items():
                    setattr(obj, field, value)
            obj.tenant = tenant
            obj.save()
            return

        self.stdout.write(
            f"  = {identity}: exists, differs on [{', '.join(changed)}] — "
            f"left as-is (pass --update to overwrite)"
        )
        stats.unchanged += 1
