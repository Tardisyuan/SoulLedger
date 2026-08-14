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
    ("DY_02_YANGLIU", "杨柳宫", "杨柳宫", "Yangliu Palace", "Yangliu", RealmType.BLISS, 2,
     "Souls awaiting reunion with loved ones", "MENGPO", False, None),
    ("DY_00_PURGATORY", "待审所", "待审所", "Purgatory Holding", "Daishensuo", RealmType.PURGATORY, 1,
     "Souls awaiting judgment - washed by Mengpo broth", "MENGPO", False, None),
    ("DY_COURT_01_QINGUANG", "第一殿", "第一殿秦广王", "First Court Qinguang", "Qinguang",
     RealmType.HELL, 1,
     "Intake court - the Ledger of Life and Death is read and the soul's case "
     "opened; no punishment is administered here", "MENGPO", False, None),
    ("DY_COURT_02_CHUJIANG", "第二殿", "第二殿楚江王", "Second Court Chujiang", "Chujiang",
     RealmType.HELL, 2,
     "活大地狱 - the mildest punishment court; thieves and those who wounded "
     "others in life", "MENGPO", False, 100),
    ("DY_COURT_03_SONGDI", "第三殿", "第三殿宋帝王", "Third Court Songdi", "Songdi",
     RealmType.HELL, 3,
     "黑绳大地狱 - evil tongue, false witness, oath-breaking", "MENGPO", False, 80),
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
    ("EU_PURGATORY", "炼狱", "涤罪所", "Purgatory", "Purgatory", RealmType.PURGATORY, 1,
     "Temporary purification - souls cleansed before heaven entry", "LETHE", False, None),
    ("EU_HELL_1ST", "第一层地狱", "幽冥边境", "First Circle - Limbo", "Limbo", RealmType.HELL, 1,
     "Limbo - virtuous pagans, unbaptized infants", "LETHE", True, None),
    ("EU_HELL_2ND", "第二层地狱", "贪食深渊", "Second Circle - Lust", "Lust", RealmType.HELL, 2,
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
]

EGYPTIAN_REALMS = [
    ("EG_DUAT_ENTRY", "杜阿特入口", "杜阿特之门", "Gate of Duat", "DuatEntry", RealmType.PURGATORY, 1,
     "Entry to the underworld Duat - soul begins the night journey", "SPELL", False, None),
    ("EG_HALL_TWO_TRUTHS", "真理殿堂", "两真之殿", "Hall of Two Truths", "HallTwoTruths", RealmType.PURGATORY, 2,
     "The weighing of the heart against Ma'at's feather", "SPELL", False, None),
    ("EG_AARU", "阿鲁之地", "芦苇之地", "Field of Reeds (Aaru)", "Aaru", RealmType.BLISS, 1,
     "Egyptian paradise - eternal life in the Field of Reeds beyond Duat", "NONE", True, None),
    ("EG_AM_TYAT", "阿姆·特亚特", "芦苇之地边境", "Path of Amtyat", "Amtyat", RealmType.NEUTRAL, 3,
     "Border realm before the final judgment", "SPELL", False, None),
    ("EG_DEVOURER", "吞噬者", "阿米特之地", "Devourer's Realm", "AmMit", RealmType.HELL, 10,
     "Ammit waits here - soul destroyed if heart fails weighing", "SPELL", True, None),
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
    ("楚江王", "楚江王", "Chujiang Wang", "Chujiang", ActorRole.JUDGE, "DY_COURT_02_CHUJIANG",
     "第二殿楚江王", "第二殿楚江王", "Second Court Chujiang", "Chujiang",
     "Second court judge - awards merit for good deeds"),
    ("宋帝王", "宋帝王", "Songdi Wang", "Songdi", ActorRole.JUDGE, "DY_COURT_03_SONGDI",
     "第三殿宋帝王", "第三殿宋帝王", "Third Court Songdi", "Songdi",
     "Third court judge - handles cases of evil tongue and false witness"),
    ("五官王", "五官王", "Wuguan Wang", "Wuguan", ActorRole.JUDGE, "DY_COURT_04_WUGUAN",
     "第四殿五官王", "第四殿五官王", "Fourth Court Wuguan", "Wuguan",
     "Fourth court judge - chief accountant of deeds"),
    ("卞城王", "卞城王", "Biancheng Wang", "Biancheng", ActorRole.JUDGE, "DY_COURT_06_BIANCHENG",
     "第六殿卞城王", "第六殿卞城王", "Sixth Court Biancheng", "Biancheng",
     "Sixth court judge - manages reincarnation scheduling"),
    ("泰山王", "泰山王", "Taishan Wang", "Taishan", ActorRole.JUDGE, "DY_COURT_07_TAISHAN",
     "第七殿泰山王", "第七殿泰山王", "Seventh Court Taishan", "Taishan",
     "Seventh court - linked to Mount Tai, judge of the mountains"),
    ("都市王", "都市王", "Dushi Wang", "Dushi", ActorRole.JUDGE, "DY_COURT_08_DUSHI",
     "第八殿都市王", "第八殿都市王", "Eighth Court Dushi", "Dushi",
     "Eighth court - judge of merchants and craftsmen"),
    ("平等王", "平等王", "Pingdeng Wang", "Pingdeng", ActorRole.JUDGE, "DY_COURT_09_PINGDENG",
     "第九殿平等王", "第九殿平等王", "Ninth Court Pingdeng", "Pingdeng",
     "Ninth court - embodies perfect impartial justice"),
    ("转轮王", "转轮王", "Zhuanlun Wang", "Zhuanlun", ActorRole.JUDGE, "DY_COURT_10_ZHUANLUN",
     "第十殿转轮王", "第十殿转轮王", "Tenth Court Zhuanlun", "Zhuanlun",
     "Tenth court - the wheel of rebirth; assigns fate for the next life"),
    ("孟婆", "孟婆", "Meng Po", "Mengpo", ActorRole.CONDUIT, "DY_00_PURGATORY",
     "孟婆", "孟婆", "Meng Po", "Mengpo",
     "The Meng Po - serves the soup of forgetting to departing souls"),
    ("牛头", "牛头", "Ox Head", "Niutou", ActorRole.GUARDIAN, "DY_00_PURGATORY",
     "牛头马面", "牛头马面", "Ox Head and Horse Face", "Niuma",
     "Ox Head - one of the two guardians who escort the dead"),
    ("马面", "马面", "Horse Face", "Mamian", ActorRole.GUARDIAN, "DY_00_PURGATORY",
     "马面", "马面", "Horse Face", "Mamian",
     "Horse Face - companion guardian of the underworld dead"),
    ("白无常", "白无常", "White Impermanence", "Bai Wuchang", ActorRole.CONDUIT, "DY_00_PURGATORY",
     "白无常", "白无常", "White Wuchang", "BaiWuchang",
     "White Impermanence - captures wandering souls, brings gentle death"),
    ("黑无常", "黑无常", "Black Impermanence", "Hei Wuchang", ActorRole.CONDUIT, "DY_00_PURGATORY",
     "黑无常", "黑无常", "Black Wuchang", "HeiWuchang",
     "Black Impermanence - captures wicked souls with chains of darkness"),
    ("判官", "判官", "Registrar", "Panguan", ActorRole.JUDGE, "DY_COURT_05_YANLUO",
     "判官", "判官", "Clerk-Registrar of the Dead", "Panguan",
     "Registrars who compile and verify the Book of Life and Death"),
    ("钟馗", "钟馗", "Zhong Kui", "Zhongkui", ActorRole.EXECUTOR, "DY_COURT_05_YANLUO",
     "钟馗", "钟馗", "Zhong Kui - Demon Queller", "Zhongkui",
     "Demon hunter and executor - assists in torture and evil spirit expulsion"),
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
     "misjudgment; the opening node of the Chinese appeal workflow"),
    ("崔府君", "崔府君", "Cui Fujun", "Cuifujun", ActorRole.JUDGE, "DY_COURT_05_YANLUO",
     "崔判官", "崔判官", "Cui the Registrar", "Cuifujun",
     "崔珏 - senior registrar and judge of the underworld courts; keeps the "
     "Ledger of Life and Death and assists the Ten Kings"),
    ("地藏王菩萨", "地藏王菩萨", "Ksitigarbha", "Dizang", ActorRole.OVERSEER, "DY_COURT_01_QINGUANG",
     "地藏王菩萨", "地藏王菩萨", "Ksitigarbha Bodhisattva", "Dizang",
     "Bodhisattva of the Great Vow - 地狱不空，誓不成佛. Delivers souls out of "
     "the hells; relief path for wrongful deaths and those in the torture chambers"),
]

EUROPEAN_ACTORS = [
    ("God", "上帝", "God (YHWH)", "God", ActorRole.OVERSEER, "EU_HEAVEN",
     "全能者", "全能者", "The Almighty", "God",
     "Supreme deity - final judge of souls in Christian tradition"),
    ("Michael", "米迦勒", "Archangel Michael", "Mikael", ActorRole.JUDGE, "EU_HEAVEN",
     "大天使长米迦勒", "大天使长米迦勒", "Archangel Michael", "Mikael",
     "Leader of the archangels - weighs souls at the heavenly throne"),
    ("Gabriel", "加百列", "Archangel Gabriel", "Gabrielle", ActorRole.CONDUIT, "EU_HEAVEN",
     "加百列", "加百列", "Archangel Gabriel", "Gabrielle",
     "Messenger angel - guides souls to judgment and heaven"),
    ("Satan", "撒旦", "Satan", "Satan", ActorRole.JUDGE, "EU_HELL_9TH",
     "堕落者撒旦", "堕落者撒旦", "Satan - Adversary", "Satan",
     "The adversary - ruler of the ninth circle of Hell, final tempter"),
    ("Charon", "卡戎", "Charon", "Kharos", ActorRole.CONDUIT, "EU_PURGATORY",
     "冥河渡神卡戎", "冥河渡神卡戎", "Charon - Ferryman of Styx", "Kharos",
     "Ferryman of the River Styx - transports souls across to the underworld"),
    ("Minos", "米诺斯", "Minos", "Mino", ActorRole.JUDGE, "EU_HELL_9TH",
     "米诺斯", "米诺斯", "Judge Minos", "Mino",
     "King Minos - judge in the ninth circle, assigns souls to their hell-circle"),
    ("Cerberus", "刻耳柏洛斯", "Cerberus", "Kerberos", ActorRole.GUARDIAN, "EU_HELL_1ST",
     "冥界三头犬刻耳柏洛斯", "冥界三头犬刻耳柏洛斯", "Cerberus - Three-headed Hound", "Kerberos",
     "Three-headed guardian of Hades - prevents living entry and dead exit"),
    # Greco-Roman side. `consolidate_eu_pantheon` audits exactly this cast —
    # Hades sole OVERSEER, Minos/Aeacus/Rhadamanthus JUDGE, Charon CONDUIT,
    # Cerberus GUARDIAN — so it has to be seeded, or that audit reports every
    # name MISSING on a fresh database.
    #
    # Hades, not Pluto: Pluto is the Roman name of the same god and
    # `consolidate_eu_pantheon` merges the pair into Hades. Pluto is therefore
    # deliberately NOT seeded — it only exists in databases predating that
    # command, which is exactly the case the merge step is there to clean up.
    # Seeding both would manufacture on every fresh database the duplicate the
    # merge exists to remove.
    ("Hades", "哈迪斯", "Hades", "Aides", ActorRole.OVERSEER, "EU_HELL_1ST",
     "冥王哈迪斯", "冥王哈迪斯", "Hades - Lord of the Underworld", "Aides",
     "Greek god of the underworld - sole overseer of the Greco-Roman infernal realm"),
    ("Aeacus", "艾亚哥斯", "Aeacus", "Aiakos", ActorRole.JUDGE, "EU_HELL_9TH",
     "冥界判官艾亚哥斯", "冥界判官艾亚哥斯", "Judge Aeacus", "Aiakos",
     "One of the three judges of the dead - holds the keys of the underworld, "
     "judges the souls of Europe"),
    ("Rhadamanthus", "拉达曼提斯", "Rhadamanthus", "Rhadamanthys", ActorRole.JUDGE, "EU_HELL_9TH",
     "冥界判官拉达曼提斯", "冥界判官拉达曼提斯", "Judge Rhadamanthus", "Rhadamanthys",
     "One of the three judges of the dead - brother of Minos, judges the souls of Asia"),
    ("Lethe", "忘川", "River Lethe", "Lethe", ActorRole.CONDUIT, "EU_PURGATORY",
     "忘川河神", "忘川河神", "Lethe - River of Forgetfulness", "Lethe",
     "Spirit of the river Lethe - souls drink to forget their past lives"),
]

EGYPTIAN_ACTORS = [
    ("Osiris", "奥西里斯", "Osiris", "Wsir", ActorRole.JUDGE, "EG_HALL_TWO_TRUTHS",
     "冥王奥西里斯", "冥王奥西里斯", "Osiris - Lord of the Duat", "Wsir",
     "God of the dead and resurrection - supreme judge in the Hall of Two Truths"),
    ("Anubis", "阿努比斯", "Anubis", "Inpw", ActorRole.JUDGE, "EG_HALL_TWO_TRUTHS",
     "亡灵守护神阿努比斯", "亡灵守护神阿努比斯", "Anubis - Guardian of the Dead", "Inpw",
     "Jackal-headed god - conducts the weighing of the heart ceremony"),
    ("Thoth", "托特", "Thoth", "Djehuty", ActorRole.JUDGE, "EG_HALL_TWO_TRUTHS",
     "智慧之神托特", "智慧之神托特", "Thoth - God of Wisdom and Writing", "Djehuty",
     "Ibis-headed god - records the verdict, advises Osiris during weighing"),
    ("Ma'at", "玛特", "Ma'at", "Maat", ActorRole.JUDGE, "EG_HALL_TWO_TRUTHS",
     "真理与正义女神玛特", "真理与正义女神玛特", "Ma'at - Goddess of Truth and Justice", "Maat",
     "Daughter of Ra - the feather of Ma'at is the standard for the weighing"),
    ("Ammit", "阿米特", "Ammit (The Devourer)", "Ammut", ActorRole.EXECUTOR, "EG_DEVOURER",
     "吞噬者阿米特", "吞噬者阿米特", "Ammit - The Devourer", "Ammut",
     "The Devourer - part lion, part hippopotamus, part crocodile - consumes unworthy hearts"),
    ("Horus", "荷鲁斯", "Horus", "Hor", ActorRole.GUARDIAN, "EG_DUAT_ENTRY",
     "天空之神荷鲁斯", "天空之神荷鲁斯", "Horus - God of the Sky", "Hor",
     "Falcon-headed god - protects the living and guides souls through the Duat"),
    ("Isis", "伊西斯", "Isis", "Aset", ActorRole.CONDUIT, "EG_AARU",
     "生命女神伊西斯", "生命女神伊西斯", "Isis - Goddess of Life and Magic", "Aset",
     "Great mother goddess - protects the dead, aids resurrection spells"),
    ("Nephthys", "奈芙蒂斯", "Nephthys", "NebetHet", ActorRole.CONDUIT, "EG_AARU",
     "丧葬女神奈芙蒂斯", "丧葬女神奈芙蒂斯", "Nephthys - Goddess of Mourning", "NebetHet",
     "Protects the dead - assists Anubis in funeral rites and judgment"),
    ("Ra", "拉", "Ra (Atum)", "Re", ActorRole.OVERSEER, "EG_AARU",
     "太阳神拉", "太阳神拉", "Ra - Sun God and Creator", "Re",
     "Supreme sun god - the ultimate authority over life and death in the Duat"),
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
                self.stdout.write("")

            if dry_run:
                transaction.set_rollback(True)

        self.stdout.write(self.style.MIGRATE_HEADING("Summary"))
        for stats in (tenant_stats, realm_stats, actor_stats):
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
