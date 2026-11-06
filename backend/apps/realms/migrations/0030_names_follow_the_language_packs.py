"""The seeded realm names, brought to what `realms.py` now says (wording review 2026-11-06, CN and EU sections).

Europe: every `name_zh` / `name_local` is the language pack's `realms.names` / `realms.codes` word for word, so the
judgment desk, the disposition list and the realms page name a place the same way. Hell counts in 圈 and Purgatory in
层 (docs/03), the first circle is 林勃 (docs/03), the crossing is the Acheron's, not the Styx's, and heaven is 天国.
Diyu: the first heaven's short name is 天界, not 天堂, and the holding pen's English does not borrow Purgatory.
Courts 2 and 4: the offences are the ones 《玉历》 files there (docs/11 §2.2).

A value changes only where it still reads the old way, so a name somebody edited stays. Reverse is the same the other
way.
"""
from django.db import migrations

#: (realm_code, field, old, new)
NAMES = (
    ("DY_00_PURGATORY", "name_en", "Purgatory Holding", "Holding Hall"),
    ("DY_01_HEAVEN", "name_local", "天堂", "天界"),
    ("EU_ACHERON", "name_local", "阿刻戎渡口", "阿刻戎河渡口"),
    ("EU_ACHERON", "name_zh", "冥河渡口", "阿刻戎河渡口"),
    ("EU_HEAVEN", "name_local", "天堂", "天国"),
    ("EU_HEAVEN", "name_zh", "上帝之国", "天国"),
    ("EU_HELL_1ST", "name_local", "第一层地狱", "地狱第一圈"),
    ("EU_HELL_1ST", "name_zh", "幽冥边境", "第一圈 - 林勃"),
    ("EU_HELL_2ND", "name_local", "第二层地狱", "地狱第二圈"),
    ("EU_HELL_2ND", "name_zh", "色欲之风", "第二圈 - 淫欲"),
    ("EU_HELL_3RD", "name_local", "第三层地狱", "地狱第三圈"),
    ("EU_HELL_3RD", "name_zh", "饕餮泥沼", "第三圈 - 暴食"),
    ("EU_HELL_4TH", "name_en", "Fourth Circle - Greed", "Fourth Circle - Avarice and Prodigality"),
    ("EU_HELL_4TH", "name_local", "第四层地狱", "地狱第四圈"),
    ("EU_HELL_4TH", "name_zh", "贪婪深渊", "第四圈 - 贪婪与挥霍"),
    ("EU_HELL_5TH", "name_en", "Fifth Circle - Anger", "Fifth Circle - Wrath"),
    ("EU_HELL_5TH", "name_local", "第五层地狱", "地狱第五圈"),
    ("EU_HELL_5TH", "name_zh", "愤怒沼泽", "第五圈 - 愤怒"),
    ("EU_HELL_6TH", "name_local", "第六层地狱", "地狱第六圈"),
    ("EU_HELL_6TH", "name_zh", "异端荒原", "第六圈 - 异端"),
    ("EU_HELL_7TH", "name_local", "第七层地狱", "地狱第七圈"),
    ("EU_HELL_7TH", "name_zh", "暴力之渊", "第七圈 - 暴力"),
    ("EU_HELL_8TH", "name_en", "Eighth Circle - Malebolge", "Eighth Circle - Fraud"),
    ("EU_HELL_8TH", "name_local", "第八层地狱", "地狱第八圈"),
    ("EU_HELL_8TH", "name_zh", "欺诈深渊", "第八圈 - 欺诈"),
    ("EU_HELL_9TH", "name_local", "第九层地狱", "地狱第九圈"),
    ("EU_HELL_9TH", "name_zh", "叛徒冰湖", "第九圈 - 背叛"),
    ("EU_PURGATORY", "name_zh", "涤罪所", "炼狱"),
    ("EU_PURGATORY_T1_PRIDE", "name_zh", "傲慢之台", "第一层 - 傲慢"),
    ("EU_PURGATORY_T2_ENVY", "name_zh", "嫉妒之台", "第二层 - 嫉妒"),
    ("EU_PURGATORY_T3_WRATH", "name_zh", "愤怒之台", "第三层 - 愤怒"),
    ("EU_PURGATORY_T4_SLOTH", "name_zh", "懒惰之台", "第四层 - 懒惰"),
    ("EU_PURGATORY_T5_AVARICE", "name_zh", "贪婪之台", "第五层 - 贪婪"),
    ("EU_PURGATORY_T6_GLUTTONY", "name_zh", "暴食之台", "第六层 - 暴食"),
    ("EU_PURGATORY_T7_LUST", "name_zh", "淫欲之台", "第七层 - 淫欲"),
    ("DY_COURT_02_CHUJIANG", "description",
     "活大地狱 - the mildest punishment court; thieves and those who wounded others in life",
     "活大地狱 - the mildest punishment court; abducting the young, seizing others' property, "
     "maiming others' eyes, ears, hands or feet"),
    ("DY_COURT_02_CHUJIANG", "description_en",
     "Great Reviving Hell - the mildest punishment court; thieves and those who wounded others in life",
     "Great Reviving Hell - the mildest punishment court; abducting the young, seizing others' property, "
     "maiming others' eyes, ears, hands or feet"),
    ("DY_COURT_04_WUGUAN", "description",
     "合大地狱 - fraud, withheld dues, falsified accounts",
     "合大地狱 - refusing grain tax and rent, fraud in trade"),
    ("DY_COURT_04_WUGUAN", "description_en",
     "Great Crushing Hell - fraud, withheld dues, falsified accounts",
     "Great Crushing Hell - refusing grain tax and rent, fraud in trade"),
)


def _apply(apps, schema_editor, rows):
    db = schema_editor.connection.alias
    Realm = apps.get_model("realms", "Realm")
    for code, field, old, new in rows:
        Realm._base_manager.using(db).filter(realm_code=code, **{field: old}).update(**{field: new})


def forwards(apps, schema_editor):
    _apply(apps, schema_editor, NAMES)


def backwards(apps, schema_editor):
    _apply(apps, schema_editor, tuple((code, field, new, old) for code, field, old, new in NAMES))


class Migration(migrations.Migration):
    dependencies = [("realms", "0029_english_names_follow_their_sources")]
    operations = [migrations.RunPython(forwards, backwards)]
