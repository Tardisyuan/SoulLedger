"""
Django management command to seed Chinese Diyu reference data.
"""
import os
import sys
import django

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from apps.realms.models import Realm, RealmType, Civilization
from apps.actors.models import Actor, ActorRole


CHINESE_REALMS = [
    # Type, code, local_name, en_name, tier, parent, description, reset, eternal, limit
    ("BLISS", "DY_01_HEAVEN", "天堂", "First Level Heaven", 1, None, "Highest bliss realm — pure merit souls", "NONE", True, None),
    ("BLISS", "DY_02_YANGLIFE", "杨柳宫", "Yangliu Palace", 2, None, "Souls awaiting reunion", "MENGPO", False, None),
    ("PURGATORY", "DY_00_PURGATORY", "待审所", "Purgatory Holding", 1, None, "Souls awaiting judgment", "MENGPO", False, None),
    ("HELL", "DY_03_QISHI", "第七殿", "Seventh Court — Qishi", 3, None, "Light punishment realm", "MENGPO", False, 100),
    ("HELL", "DY_04_TAISHAN", "泰山府", "Mount Tai Court", 4, None, "Judging scholars and officials", "MENGPO", False, 100),
    ("HELL", "DY_05_CITY", "城池狱", "City Prison Hell", 5, None, "Punishment for violent criminals", "MENGPO", False, 50),
    ("HELL", "DY_06_ZHUAN", "转轮狱", "Wheel of Rebirth Hell", 6, None, "Forced reincarnation cycle", "MENGPO", False, 33),
    ("HELL", "DY_07_JIAN", "剑树狱", "Sword Tree Hell", 7, None, "Thieves and murderers", "MENGPO", False, 30),
    ("HELL", "DY_08_HAN", "寒冰狱", "Ice Prison Hell", 8, None, "Heartless oath-breakers", "MENGPO", False, 20),
    ("HELL", "DY_09_YANG", "烊铜狱", "Molten Copper Hell", 9, None, "Greedy officials", "MENGPO", False, 10),
    ("HELL", "DY_10_YAMA", "第十殿", "Tenth Court — Yama", 10, None, "Final judgment — all sins assessed", "MENGPO", False, None),
]

CHINESE_ACTORS = [
    # name, role, realm_code, title, description
    ("阎罗王", ActorRole.JUDGE, "DY_10_YAMA", "十殿阎王", "Supreme judge of the Tenth Court, final arbiter of all souls"),
    ("秦广王", ActorRole.JUDGE, "DY_03_QISHI", "第一殿秦广王", "First court judge — evaluates life and death ledgers"),
    ("楚江王", ActorRole.JUDGE, "DY_03_QISHI", "第二殿楚江王", "Second court judge — awards good deeds"),
    ("宋帝王", ActorRole.JUDGE, "DY_04_TAISHAN", "第三殿宋帝王", "Third court judge — handles evil tongue cases"),
    ("五官王", ActorRole.JUDGE, "DY_05_CITY", "第四殿五官王", "Fourth court judge — accountants of deeds"),
    ("阎罗王", ActorRole.JUDGE, "DY_10_YAMA", "第五殿阎罗王", "Fifth court — the famous Yama himself"),
    ("卞城王", ActorRole.JUDGE, "DY_06_ZHUAN", "第六殿卞城王", "Sixth court — handles reincarnation scheduling"),
    ("泰山王", ActorRole.JUDGE, "DY_04_TAISHAN", "第七殿泰山王", "Seventh court — Mount Tai connection"),
    ("都市王", ActorRole.JUDGE, "DY_05_CITY", "第八殿都市王", "Eighth court — urban merchants and traders"),
    ("转轮王", ActorRole.JUDGE, "DY_06_ZHUAN", "第九殿转轮王", "Ninth court — fate assignment for next life"),
    ("平等王", ActorRole.JUDGE, "DY_10_YAMA", "第十殿平等王", "Tenth court — perfect justice"),
    ("孟婆", ActorRole.CONDUIT, "DY_00_PURGATORY", "孟婆", "The Meng Po — serves forgetting soup to departing souls"),
    ("牛头", ActorRole.GUARDIAN, "DY_00_PURGATORY", "牛头马面", "Ox Head — guides souls from body to underworld"),
    ("马面", ActorRole.GUARDIAN, "DY_00_PURGATORY", "牛头马面", "Horse Face — companion guide of the dead"),
    ("黑白无常", ActorRole.CONDUIT, "DY_00_PURGATORY", "黑白无常", "Black and White Impermanence — capture wandering souls"),
    ("判官", ActorRole.JUDGE, "DY_10_YAMA", "判官", "Registrars who compile the Book of Life and Death"),
    ("钟馗", ActorRole.EXECUTOR, "DY_09_YANG, DY_10_YAMA", "钟馗", "Demon hunter, assists in torture executions"),
]


def seed_realms():
    created = 0
    for rtype, code, local, en, tier, parent, desc, reset, eternal, limit in CHINESE_REALMS:
        parent_obj = Realm.objects.filter(realm_code=parent).first() if parent else None
        obj, created_flag = Realm.objects.update_or_create(
            realm_code=code,
            defaults={
                "civilization": Civilization.CHINESE,
                "name_local": local,
                "name_en": en,
                "realm_type": rtype,
                "tier": tier,
                "parent_realm": parent_obj,
                "description": desc,
                "memory_reset_mechanism": reset,
                "is_eternal": eternal,
                "cycle_limit": limit,
            }
        )
        if created_flag:
            created += 1
    print(f"[Realms] Created {created} new Chinese realms")


def seed_actors():
    created = 0
    for name, role, realm_codes, title, desc in CHINESE_ACTORS:
        realm_code = realm_codes.split(",")[0].strip()
        realm = Realm.objects.filter(realm_code=realm_code).first()
        obj, created_flag = Actor.objects.update_or_create(
            name=name,
            civilization=Civilization.CHINESE,
            defaults={
                "role": role,
                "realm": realm,
                "title": title,
                "description": desc,
            }
        )
        if created_flag:
            created += 1
    print(f"[Actors] Created {created} new Chinese actors")


if __name__ == "__main__":
    seed_realms()
    seed_actors()
    print("Done seeding Chinese Diyu data.")
