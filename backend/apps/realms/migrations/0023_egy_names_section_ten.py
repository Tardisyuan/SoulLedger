"""
egy 词表第十节「旧词审定」改了 29 个界域的 egy 名(语言包 `realms.names`,种子跟它走):

* 十殿:Qedi 换成 Wesekhet,写成「Wesekhet 序号 · 殿名」;
* 杨柳宫:Yanglju 是笔误(→ Yangliu),Anpu(阿努比斯)是误植,删掉;
* 欧洲地狱各圈:英文罪名改成与炼狱同一套拉丁写法,且同一罪名在地狱与炼狱各出现一次,
  所以名称带界域前缀(`Duat 2 · Luxuria` 与 `Ta Hesmen 7 · Luxuria`);
* EarthlyParadise → Paradiso Terrestre,Meadow → Leimon(英文残留)。

``seed_mythology`` 默认只建不改(见 ``realms/0016``),已有库里的行不会跟着种子变,
所以这里改。只动仍是旧值的行:有人手改过的名字不覆盖。
走 ``_base_manager``,理由同 ``realms/0016``(默认 manager 在迁移里不可用)。
"""

from django.db import migrations

RENAMES = {
    "DY_02_YANGLIU": ("Yanglju Anpu", "Yangliu"),
    "DY_COURT_01_QINGUANG": ("Qedi 1 - Qinguang", "Wesekhet 1 · Qinguang"),
    "DY_COURT_02_CHUJIANG": ("Qedi 2 - Chujiang", "Wesekhet 2 · Chujiang"),
    "DY_COURT_03_SONGDI": ("Qedi 3 - Songdi", "Wesekhet 3 · Songdi"),
    "DY_COURT_04_WUGUAN": ("Qedi 4 - Wuguan", "Wesekhet 4 · Wuguan"),
    "DY_COURT_05_YANLUO": ("Qedi 5 - Yanluo", "Wesekhet 5 · Yanluo"),
    "DY_COURT_06_BIANCHENG": ("Qedi 6 - Biancheng", "Wesekhet 6 · Biancheng"),
    "DY_COURT_07_TAISHAN": ("Qedi 7 - Taishan", "Wesekhet 7 · Taishan"),
    "DY_COURT_08_DUSHI": ("Qedi 8 - Dushi", "Wesekhet 8 · Dushi"),
    "DY_COURT_09_PINGDENG": ("Qedi 9 - Pingdeng", "Wesekhet 9 · Pingdeng"),
    "DY_COURT_10_ZHUANLUN": ("Qedi 10 - Zhuanlun", "Wesekhet 10 · Zhuanlun"),
    "EU_PURGATORY_T1_PRIDE": ("Superbia", "Ta Hesmen 1 · Superbia"),
    "EU_PURGATORY_T2_ENVY": ("Invidia", "Ta Hesmen 2 · Invidia"),
    "EU_PURGATORY_T3_WRATH": ("Ira", "Ta Hesmen 3 · Ira"),
    "EU_PURGATORY_T4_SLOTH": ("Acedia", "Ta Hesmen 4 · Acedia"),
    "EU_PURGATORY_T5_AVARICE": ("Avaritia", "Ta Hesmen 5 · Avaritia"),
    "EU_PURGATORY_T6_GLUTTONY": ("Gula", "Ta Hesmen 6 · Gula"),
    "EU_PURGATORY_T7_LUST": ("Luxuria", "Ta Hesmen 7 · Luxuria"),
    "EU_EARTHLY_PARADISE": ("EarthlyParadise", "Paradiso Terrestre"),
    "EU_HELL_1ST": ("Limbo", "Duat 1 · Limbo"),
    "EU_HELL_2ND": ("Lust", "Duat 2 · Luxuria"),
    "EU_HELL_3RD": ("Gluttony", "Duat 3 · Gula"),
    "EU_HELL_4TH": ("Greed", "Duat 4 · Avaritia"),
    "EU_HELL_5TH": ("Anger", "Duat 5 · Ira"),
    "EU_HELL_6TH": ("Heresy", "Duat 6 · Haeresis"),
    "EU_HELL_7TH": ("Violence", "Duat 7 · Violentia"),
    "EU_HELL_8TH": ("Malebolge", "Duat 8 · Malebolge"),
    "EU_HELL_9TH": ("Treachery", "Duat 9 · Proditio"),
    "EU_PLATO_MEADOW": ("Meadow", "Leimon"),
}


def forwards(apps, schema_editor):
    Realm = apps.get_model("realms", "Realm")
    for code, (old, new) in RENAMES.items():
        Realm._base_manager.filter(realm_code=code, name_egy=old).update(name_egy=new)


def backwards(apps, schema_editor):
    Realm = apps.get_model("realms", "Realm")
    for code, (old, new) in RENAMES.items():
        Realm._base_manager.filter(realm_code=code, name_egy=new).update(name_egy=old)


class Migration(migrations.Migration):
    dependencies = [("realms", "0022_duat_weighing_fork")]

    operations = [migrations.RunPython(forwards, backwards)]
