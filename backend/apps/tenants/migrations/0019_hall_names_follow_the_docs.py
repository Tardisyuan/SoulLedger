"""EG_DUAT 与 GR_HADES 殿司的展示名跟着 realms/0030 按 docs 改(2026-11-07 措辞审查 EG-11、GR-12)。

* EG_DUAT「真理殿堂」→「两真之殿」(用户定两真之殿为规范名,docs/02 §二);
* GR_HADES「岔路草原 / The Meadow at the Parting of the Ways」→「岔路口的草地 / The Meadow at the Crossroads」
  (docs/01:42、docs/02:180;草原在 docs/04:167 指的是 Asphodel)。

``tenants/0012`` 只填空着的列;这里只动仍是 0012 那个默认值的行:运维改过的不覆盖,倒回去还原。
egy 名(Weret Maaty、Wat Wedja)不变。
"""
from django.db import migrations

#: code -> {field: (old, new)}
RENAMES = {
    "EG_DUAT": {"hall_name": ("真理殿堂", "两真之殿")},
    "GR_HADES": {
        "hall_name": ("岔路草原", "岔路口的草地"),
        "hall_name_en": ("The Meadow at the Parting of the Ways", "The Meadow at the Crossroads"),
    },
}


def _apply(apps, schema_editor, forward):
    alias = schema_editor.connection.alias
    Tenant = apps.get_model("tenants", "Tenant")
    for code, fields in RENAMES.items():
        for field, (old, new) in fields.items():
            src, dst = (old, new) if forward else (new, old)
            Tenant._base_manager.using(alias).filter(code=code, **{field: src}).update(**{field: dst})


def forwards(apps, schema_editor):
    _apply(apps, schema_editor, True)


def backwards(apps, schema_editor):
    _apply(apps, schema_editor, False)


class Migration(migrations.Migration):
    dependencies = [("tenants", "0018_backfill_english")]
    operations = [migrations.RunPython(forwards, backwards)]
