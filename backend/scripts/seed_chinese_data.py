"""
Django management command to seed afterlife reference data.
Covers: Chinese Diyu, European Heaven/Hell, Egyptian Duat

HISTORICAL ENTRY POINT — superseded by `python manage.py seed_mythology`
(apps/actors/management/commands/seed_mythology.py), which carries every realm
and actor defined below, is idempotent, supports --civilization / --dry-run /
--update, assigns the tenant this script computes but never applies, and is
covered by backend/tests/test_seed_mythology.py. Kept here for reference; new
work should use the command, and changes made here will not reach CI or a
fresh clone.
"""
import os
import sys

import django

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from apps.actors.models import Actor, ActorRole
from apps.realms.models import Civilization, Realm, RealmType
from apps.souls.models import CIVILIZATION_TENANT
from apps.tenants.models import Tenant


def _get_or_create_tenants():
    """Ensure the three tenant records exist and return them keyed by code."""
    tenants = {}
    for code, display_name in [
        ("CN_DIYU", "Chinese Afterlife"),
        ("EU_HEAVEN_HELL", "European Afterlife"),
        ("EG_DUAT", "Egyptian Afterlife"),
    ]:
        tenant, _ = Tenant.objects.get_or_create(
            code=code,
            defaults={"display_name": display_name, "dispatch_enabled": True},
        )
        tenants[code] = tenant
    return tenants


def _infer_tenant(civ_code):
    """Map civilization code to tenant code. Raises on an unknown civilization.

    The mapping is apps.souls.models.CIVILIZATION_TENANT rather than a fourth
    hand-written copy of the same three pairs.

    It raises where it used to fall back to "CN_DIYU" — the same fail-open that
    Soul.civilization was just fixed for, pointing the other way. An
    unrecognised civilization does not mean Chinese; it means nobody has said
    which tenant owns this cosmology, and answering "the Chinese one" files
    rows under a tenant that has no claim on them. Wrongly-tenanted rows are
    invisible to the people who would notice (tenant isolation hides them from
    the tenant that should have them) and have to be found by hand afterwards.
    A seed script that stops is a five-minute problem; a seed script that
    guesses is an archaeology problem.
    """
    try:
        return CIVILIZATION_TENANT[civ_code]
    except KeyError:
        raise ValueError(
            f"No tenant is configured for civilization {civ_code!r}. "
            f"Known: {sorted(str(c) for c in CIVILIZATION_TENANT)}. Add it to "
            f"TENANT_CIVILIZATION in apps/souls/models.py before seeding."
        ) from None


# =============================================================================
# CHINESE REALMS
# =============================================================================
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

# =============================================================================
# EUROPEAN REALMS
# =============================================================================
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

# =============================================================================
# EGYPTIAN REALMS
# =============================================================================
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

# =============================================================================
# CHINESE ACTORS
# =============================================================================
CHINESE_ACTORS = [
    # Court numbers follow the standard 十殿阎罗 ordering (阎罗王=5, 平等王=9,
    # 转轮王=10). See the COURT NUMBERING note in
    # apps/actors/management/commands/seed_mythology.py — that command is the
    # source of truth; this copy is kept in step with it.
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
]

# =============================================================================
# EUROPEAN ACTORS
# =============================================================================
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
    # Historical row. `seed_mythology` seeds Hades instead (and does not seed
    # Pluto at all) — Pluto is the same god under his Roman name, and
    # `manage.py consolidate_eu_pantheon` merges the pair into Hades. Running
    # this script against a seeded database re-creates exactly the duplicate
    # that command exists to remove. Kept only so the historical record of what
    # this script wrote stays accurate; use the command.
    ("Pluto", "普鲁托", "Pluto", "Ploutos", ActorRole.OVERSEER, "EU_HELL_1ST",
     "冥王普鲁托", "冥王普鲁托", "Pluto - God of the Underworld", "Ploutos",
     "Roman god of the underworld - ruler of the infernal realm"),
    ("Lethe", "忘川", "River Lethe", "Lethe", ActorRole.CONDUIT, "EU_PURGATORY",
     "忘川河神", "忘川河神", "Lethe - River of Forgetfulness", "Lethe",
     "Spirit of the river Lethe - souls drink to forget their past lives"),
]

# =============================================================================
# EGYPTIAN ACTORS
# =============================================================================
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


def seed_realms():
    all_realms = CHINESE_REALMS + EUROPEAN_REALMS + EGYPTIAN_REALMS
    created = 0
    for item in all_realms:
        code, name_local, name_zh, name_en, name_egy, rtype, tier, desc, reset, eternal, limit = item
        defaults = {
            "civilization": _infer_civilization(code),
            "name_local": name_local,
            "name_zh": name_zh,
            "name_en": name_en,
            "name_egy": name_egy,
            "realm_type": rtype,
            "tier": tier,
            "description": desc,
            "memory_reset_mechanism": reset,
            "is_eternal": eternal,
            "cycle_limit": limit,
        }
        obj, created_flag = Realm.objects.update_or_create(realm_code=code, defaults=defaults)
        if created_flag:
            created += 1
    print(f"[Realms] Created {created} new realms (updated all)")


def seed_actors():
    all_actors = CHINESE_ACTORS + EUROPEAN_ACTORS + EGYPTIAN_ACTORS
    created = 0
    for item in all_actors:
        name, name_zh, name_en, name_egy, role, realm_code, title, title_zh, title_en, title_egy, desc = item
        realm = Realm.objects.filter(realm_code=realm_code).first()
        # Infer civilization from the realm_code (which carries an explicit
        # EG_/EU_ prefix — see EGYPTIAN_REALMS/EUROPEAN_REALMS above), not from
        # the actor's bare name. Name-based guessing silently defaults any
        # unmatched name to CHINESE, which mis-tagged actors like Ma'at, Pluto
        # and Lethe and duplicated actors seeded elsewhere under the correct
        # civilization. Fall back to name-based inference only for the (today
        # nonexistent) case of an actor with no realm_code.
        civilization = _infer_civilization(realm_code or name)
        defaults = {
            "civilization": civilization,
            "name_zh": name_zh,
            "name_en": name_en,
            "name_egy": name_egy,
            "title_zh": title_zh,
            "title_en": title_en,
            "title_egy": title_egy,
            "role": role,
            "realm": realm,
            "description": desc,
        }
        obj, created_flag = Actor.objects.update_or_create(
            name=name,
            civilization=civilization,
            defaults=defaults,
        )
        if created_flag:
            created += 1
    print(f"[Actors] Created {created} new actors (updated all)")


def _infer_civilization(text):
    text = str(text)
    if text.startswith("EG_"):
        return Civilization.EGYPTIAN
    if text.startswith("EU_"):
        return Civilization.EUROPEAN
    if "埃及" in text or "Osiris" in text or "Anubis" in text or "Thoth" in text:
        return Civilization.EGYPTIAN
    if "天堂" in text or "炼狱" in text or "God" in text or "Satan" in text or "EU_" in text:
        return Civilization.EUROPEAN
    return Civilization.CHINESE


if __name__ == "__main__":
    seed_realms()
    seed_actors()
    print("Done seeding all afterlife data.")
