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

* **Create-only by default.** Three sibling commands deliberately edit these
  same rows after seeding — ``fix_actor_civilization`` (civilization repairs +
  dedupe, Ma'at/Maat spelling merge), ``consolidate_eu_pantheon`` (Pluto/Hades
  merge, opt-in Norse purge),
  ``populate_chinese_actors`` (extra judicial personnel). If seeding overwrote
  existing rows every run, the seeder and those commands would take turns
  undoing each other. So the default is get_or_create semantics; pass
  ``--update`` when you explicitly want the seed values to win.

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
CHINESE_REALMS = [
    ("DY_01_HEAVEN", "天堂", "第一层天界", "First Heaven", "TLITLITLI", RealmType.BLISS, 1,
     "Pure merit souls - highest bliss, no reincarnation", "NONE", True, None),
    ("DY_02_YANGLIU", "杨柳宫", "杨柳宫", "Yangliu Palace", "Yangliu", RealmType.BLISS, 2,
     "Souls awaiting reunion with loved ones", "MENGPO", False, None),
    ("DY_00_PURGATORY", "待审所", "待审所", "Purgatory Holding", "Daishensuo", RealmType.PURGATORY, 1,
     "Souls awaiting judgment - washed by Mengpo broth", "MENGPO", False, None),
    ("DY_03_QISHI", "第七殿", "齐世寺", "Seventh Court Qishi", "Qishi", RealmType.HELL, 3,
     "Light punishment - minor sins", "MENGPO", False, 100),
    ("DY_04_TAISHAN", "泰山府", "泰山府", "Mount Tai Court", "Taishan", RealmType.HELL, 4,
     "Judging scholars, officials, oath-breakers", "MENGPO", False, 100),
    ("DY_05_CITY", "城池狱", "城池监狱", "City Prison Hell", "Chengchi", RealmType.HELL, 5,
     "Punishment for violent criminals", "MENGPO", False, 50),
    ("DY_06_ZHUAN", "转轮狱", "转轮寺", "Wheel of Rebirth Hell", "Zhuanlun", RealmType.HELL, 6,
     "Forced reincarnation cycles for stubborn souls", "MENGPO", False, 33),
    ("DY_07_JIAN", "剑树狱", "剑树森林", "Sword Tree Hell", "Jianshu", RealmType.HELL, 7,
     "Thieves, murderers - pierced by sword trees", "MENGPO", False, 30),
    ("DY_08_HAN", "寒冰狱", "寒冰洞窟", "Ice Prison Hell", "Hanbing", RealmType.HELL, 8,
     "Heartless oath-breakers frozen in ice", "MENGPO", False, 20),
    ("DY_09_YANG", "烊铜狱", "烊铜山口", "Molten Copper Hell", "Yangtong", RealmType.HELL, 9,
     "Greedy officials - bathed in molten copper", "MENGPO", False, 10),
    ("DY_10_YAMA", "第十殿", "阎罗殿", "Tenth Court Yama", "Yanluo", RealmType.HELL, 10,
     "Final judgment - all sins assessed by Yama himself", "MENGPO", False, None),
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
# Three other places in this repo already spell it that way — apps/org's
# init_organizations (DIYU_05=阎罗王, DIYU_09=平等王, DIYU_10=转轮王),
# apps/workflow/services.py's 十殿审判流程 template, and the "corrections" at
# the bottom of populate_chinese_actors. This file and seed_chinese_data.py
# were the two that disagreed (阎罗王 as 十殿阎王, 转轮王 as 第九殿, 平等王 as
# 第十殿); they now match. tests/test_seed_mythology.py::test_ten_kings_carry_
# their_canonical_court_number locks the mapping so it cannot drift again.
#
# Note the realm a king is attached to is a *separate* axis: DY_10_YAMA is
# 阎罗殿 as a place, and several kings share a realm because there are fewer
# seeded realms than courts. The court number lives in the title only.
# --------------------------------------------------------------------------
CHINESE_ACTORS = [
    ("阎罗王", "阎罗王", "Yama King", "Yanluo", ActorRole.JUDGE, "DY_10_YAMA",
     "第五殿阎罗王", "第五殿阎罗王", "Fifth Court Yama", "Yanluo",
     "Fifth court judge - the best-known of the ten kings, tries the gravest sins"),
    ("秦广王", "秦广王", "Qinguang Wang", "Qinguang", ActorRole.JUDGE, "DY_03_QISHI",
     "第一殿秦广王", "第一殿秦广王", "First Court Qinguang", "Qinguang",
     "First court judge - evaluates the Ledger of Life and Death"),
    ("楚江王", "楚江王", "Chujiang Wang", "Chujiang", ActorRole.JUDGE, "DY_03_QISHI",
     "第二殿楚江王", "第二殿楚江王", "Second Court Chujiang", "Chujiang",
     "Second court judge - awards merit for good deeds"),
    ("宋帝王", "宋帝王", "Songdi Wang", "Songdi", ActorRole.JUDGE, "DY_04_TAISHAN",
     "第三殿宋帝王", "第三殿宋帝王", "Third Court Songdi", "Songdi",
     "Third court judge - handles cases of evil tongue and false witness"),
    ("五官王", "五官王", "Wuguan Wang", "Wuguan", ActorRole.JUDGE, "DY_05_CITY",
     "第四殿五官王", "第四殿五官王", "Fourth Court Wuguan", "Wuguan",
     "Fourth court judge - chief accountant of deeds"),
    ("卞城王", "卞城王", "Biancheng Wang", "Biancheng", ActorRole.JUDGE, "DY_06_ZHUAN",
     "第六殿卞城王", "第六殿卞城王", "Sixth Court Biancheng", "Biancheng",
     "Sixth court judge - manages reincarnation scheduling"),
    ("泰山王", "泰山王", "Taishan Wang", "Taishan", ActorRole.JUDGE, "DY_04_TAISHAN",
     "第七殿泰山王", "第七殿泰山王", "Seventh Court Taishan", "Taishan",
     "Seventh court - linked to Mount Tai, judge of the mountains"),
    ("都市王", "都市王", "Dushi Wang", "Dushi", ActorRole.JUDGE, "DY_05_CITY",
     "第八殿都市王", "第八殿都市王", "Eighth Court Dushi", "Dushi",
     "Eighth court - judge of merchants and craftsmen"),
    ("平等王", "平等王", "Pingdeng Wang", "Pingdeng", ActorRole.JUDGE, "DY_10_YAMA",
     "第九殿平等王", "第九殿平等王", "Ninth Court Pingdeng", "Pingdeng",
     "Ninth court - embodies perfect impartial justice"),
    ("转轮王", "转轮王", "Zhuanlun Wang", "Zhuanlun", ActorRole.JUDGE, "DY_06_ZHUAN",
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
    ("判官", "判官", "Registrar", "Panguan", ActorRole.JUDGE, "DY_10_YAMA",
     "判官", "判官", "Clerk-Registrar of the Dead", "Panguan",
     "Registrars who compile and verify the Book of Life and Death"),
    ("钟馗", "钟馗", "Zhong Kui", "Zhongkui", ActorRole.EXECUTOR, "DY_09_YANG",
     "钟馗", "钟馗", "Zhong Kui - Demon Queller", "Zhongkui",
     "Demon hunter and executor - assists in torture and evil spirit expulsion"),
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
                "consolidate_eu_pantheon / populate_chinese_actors."
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
