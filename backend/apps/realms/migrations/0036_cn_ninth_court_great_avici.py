"""第九殿界域描述补「大」字:「阿鼻地狱」→「阿鼻大地狱」(2026-11-13 四文明核对 CN-22)。

``docs/01_地府整体架构.md`` 十殿表与同殿的平等王一行都作「阿鼻大地狱」;考据第 29 条要补的三个「大」字,
七、八殿补了,九殿漏了。英文列不变(仍是 Avici Hell)。

``seed_mythology`` 默认只建不改,已有库里的行不会跟着种子变,所以这里改。只动仍是旧值的行:手改过的不覆盖。
走 ``_base_manager``,理由同 ``realms/0016``。
"""
from django.db import migrations

CODE = "DY_COURT_09_PINGDENG"
OLD = "阿鼻地狱 - the deepest hell; murder, arson, the crimes with no remedy"
NEW = "阿鼻大地狱 - the deepest hell; murder, arson, the crimes with no remedy"


def _apply(apps, schema_editor, src, dst):
    Realm = apps.get_model("realms", "Realm")
    rows = Realm._base_manager.using(schema_editor.connection.alias)
    rows.filter(realm_code=CODE, description=src).update(description=dst)


def forwards(apps, schema_editor):
    _apply(apps, schema_editor, OLD, NEW)


def backwards(apps, schema_editor):
    _apply(apps, schema_editor, NEW, OLD)


class Migration(migrations.Migration):
    dependencies = [("realms", "0035_european_acheron_and_seventh_terrace_descriptions")]
    operations = [migrations.RunPython(forwards, backwards)]
