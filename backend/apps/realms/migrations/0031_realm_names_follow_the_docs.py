"""界域名按 docs 统一(2026-11-07 措辞审查 EG-10 / EG-11 / EG-15 / EG-17、GR-12 / GR-13;用户:代码与文档不符按文档)。

* EG_HALL_TWO_TRUTHS 短名「真理殿堂」→「两真之殿」(docs/02 §二、§1.1,用户定两真之殿为规范名);
* EG_ANNIHILATION 短名「第二次死亡」→「湮灭」(去处名用湮灭,第二次死亡只作解释);
  egy「Ammit - Mut Sen」→「Mut Sen」:阿米特没有领地,湮灭是结果不是地方(docs/01:157-165);
* EG_DUAT_ENTRY「杜阿特之门 / Gate of Duat / Sebkhet Duat」→「杜阿特入口 / Entrance to the Duat / Duat Aq」:
  Sebkhet 是二十一道门户的词(docs/01:24-25);
* EU_PLATO_MEADOW「岔路草原 / 审判岔路 / The Meadow at the Parting of the Ways」→
  「岔路口草地 / 岔路口的草地 / The Meadow at the Crossroads」(docs/01:42、docs/02:180;草原在 docs/04:167 指的是 Asphodel);
* GR_ACHERON 全名「冥河渡口」→「阿刻戎渡口」:中文的冥河指斯堤克斯,希腊作者的渡口在阿刻戎(docs/01:78)。

``seed_mythology`` 默认只建不改,已有库里的行不会跟着种子变,所以这里改。只动仍是旧值的列:
手改过的不覆盖。反向同样只还原本迁移写下的值。走 ``_base_manager``,理由同 ``realms/0023``。
"""
from django.db import migrations

#: code -> {field: (old, new)}
RENAMES = {
    "EG_HALL_TWO_TRUTHS": {"name_local": ("真理殿堂", "两真之殿")},
    "EG_ANNIHILATION": {"name_local": ("第二次死亡", "湮灭"), "name_egy": ("Ammit - Mut Sen", "Mut Sen")},
    "EG_DUAT_ENTRY": {
        "name_zh": ("杜阿特之门", "杜阿特入口"),
        "name_en": ("Gate of Duat", "Entrance to the Duat"),
        "name_egy": ("Sebkhet Duat", "Duat Aq"),
    },
    "EU_PLATO_MEADOW": {
        "name_local": ("岔路草原", "岔路口草地"),
        "name_zh": ("审判岔路", "岔路口的草地"),
        "name_en": ("The Meadow at the Parting of the Ways", "The Meadow at the Crossroads"),
    },
    "GR_ACHERON": {"name_zh": ("冥河渡口", "阿刻戎渡口")},
}


def _apply(apps, schema_editor, forward):
    alias = schema_editor.connection.alias
    Realm = apps.get_model("realms", "Realm")
    for code, fields in RENAMES.items():
        for field, (old, new) in fields.items():
            src, dst = (old, new) if forward else (new, old)
            Realm._base_manager.using(alias).filter(realm_code=code, **{field: src}).update(**{field: dst})


def forwards(apps, schema_editor):
    _apply(apps, schema_editor, True)


def backwards(apps, schema_editor):
    _apply(apps, schema_editor, False)


class Migration(migrations.Migration):
    dependencies = [("realms", "0030_names_follow_the_language_packs")]
    operations = [migrations.RunPython(forwards, backwards)]
