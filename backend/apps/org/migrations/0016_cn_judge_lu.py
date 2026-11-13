"""第四位判官的组织行「陆之道 / Lu Zhidao」→「陆判 / Judge Lu」(2026-11-13 四文明核对 CN-25)。

《聊斋志异·陆判》原文只作「陆判」「陆公」,「陆之道」是后起的名字(``docs/02_地府人物详解.md`` §四);
演员种子早已用「陆判」,组织种子没跟。``init_organizations`` 只建不改,所以已有库在这里改。
只动仍是旧值的列:手改过的不覆盖。走 ``_base_manager``(默认 manager 在迁移里不可用)。
"""
from django.db import migrations

CODE = "DIYU_PAN_GUAN_04"
#: field -> (old, new)
RENAMES = {"name": ("陆之道", "陆判"), "name_en": ("Lu Zhidao", "Judge Lu")}


def _apply(apps, schema_editor, forward):
    Organization = apps.get_model("org", "Organization")
    rows = Organization._base_manager.using(schema_editor.connection.alias).filter(code=CODE)
    for field, (old, new) in RENAMES.items():
        src, dst = (old, new) if forward else (new, old)
        rows.filter(**{field: src}).update(**{field: dst})


def forwards(apps, schema_editor):
    _apply(apps, schema_editor, True)


def backwards(apps, schema_editor):
    _apply(apps, schema_editor, False)


class Migration(migrations.Migration):
    dependencies = [("org", "0015_egypt_org_names_follow_the_docs")]
    operations = [migrations.RunPython(forwards, backwards)]
