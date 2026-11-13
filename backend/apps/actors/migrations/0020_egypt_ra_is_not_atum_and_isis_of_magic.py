"""埃及两位神的显示名按 docs 改(civ-audit-2026-11-13 EG-17、EG-18)。

* 拉的 ``name_en``「Ra (Atum)」→「Ra」:docs/01 §1.3 把阿图姆与拉列成两位,docs/02 §2.1 上排十二神里
  Harmachis 与 Tmu(Atum) 是两个座位;``actors_egyptian.py`` 的别名说明自己也写「记成别名等于断言二者同一」。
* 伊西斯的 ``title`` / ``title_zh``「生命女神伊西斯」→「魔法女神伊西斯」:docs/01 §1.3 作「魔法女神」。
  英文头衔 "Goddess of Life and Magic" 不动。

``seed_mythology`` 只建不改,已有的行要在这里改。只动仍是旧值的字段;走 ``_base_manager``(迁移里没有租户上下文)。
"""
from django.db import migrations

#: (actor name, field, old, new)
RENAMES = (
    ("Ra", "name_en", "Ra (Atum)", "Ra"),
    ("Isis", "title", "生命女神伊西斯", "魔法女神伊西斯"),
    ("Isis", "title_zh", "生命女神伊西斯", "魔法女神伊西斯"),
)


def _apply(apps, schema_editor, forward):
    Actor = apps.get_model("actors", "Actor")
    rows = Actor._base_manager.using(schema_editor.connection.alias).filter(civilization="EGYPTIAN")
    for name, field, old, new in RENAMES:
        was, now = (old, new) if forward else (new, old)
        rows.filter(name=name, **{field: was}).update(**{field: now})


def forwards(apps, schema_editor):
    _apply(apps, schema_editor, True)


def backwards(apps, schema_editor):
    _apply(apps, schema_editor, False)


class Migration(migrations.Migration):
    dependencies = [("actors", "0019_dantes_rivers_and_the_acheron_ferryman")]
    operations = [migrations.RunPython(forwards, backwards)]
