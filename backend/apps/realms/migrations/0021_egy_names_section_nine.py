"""
egy 词表第九节把两个界域的 egy 名从英文残留改成定稿写法:

    EU_HEAVEN                 Heaven          -> Pet
    GR_ISLES_OF_THE_BLESSED   IslesOfTheBlest -> Ta Nefer

``seed_mythology`` 默认只建不改(见 ``realms/0016``),已有库里的行不会跟着种子变,
所以这里改。只动仍是旧值的行:有人手改过的名字不覆盖。
走 ``_base_manager``,理由同 ``realms/0016``(默认 manager 在迁移里不可用)。
"""

from django.db import migrations

RENAMES = {
    "EU_HEAVEN": ("Heaven", "Pet"),
    "GR_ISLES_OF_THE_BLESSED": ("IslesOfTheBlest", "Ta Nefer"),
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
    dependencies = [("realms", "0020_remove_greek_fork_middle")]

    operations = [migrations.RunPython(forwards, backwards)]
