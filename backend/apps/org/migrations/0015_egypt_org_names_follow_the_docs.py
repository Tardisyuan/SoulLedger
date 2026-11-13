"""埃及组织树两个节点的名字按 docs 改(civ-audit-2026-11-13 EG-21、EG-26)。

* ``DUAT_HALL``「真理大厅 / Hall of Ma'at」→「两真之殿 / Hall of Two Truths」:用户定两真之殿为规范名
  (docs/02 §二;界域种子与语言包早已是它,realms/0031、tenants/0020)。
* ``DUAT_APEP``「阴间之书阿佩普领域 / Realm of Apep, Book of the Underworld」→「阿姆杜阿特 · 阿佩普领域 /
  Realm of Apep, Amduat」:docs/03 §1.1 这部书叫《阿姆杜阿特》。

``init_organizations`` 用 ``get_or_create``,已有的行不会跟着改。只动仍是旧值的字段;走 ``_base_manager``。
"""
from django.db import migrations

#: code -> {field: (old, new)}
RENAMES = {
    "DUAT_HALL": {"name": ("真理大厅", "两真之殿"), "name_en": ("Hall of Ma'at", "Hall of Two Truths")},
    "DUAT_APEP": {
        "name": ("阴间之书阿佩普领域", "阿姆杜阿特 · 阿佩普领域"),
        "name_en": ("Realm of Apep, Book of the Underworld", "Realm of Apep, Amduat"),
    },
}


def _apply(apps, schema_editor, forward):
    rows = apps.get_model("org", "Organization")._base_manager.using(schema_editor.connection.alias)
    for code, fields in RENAMES.items():
        for field, (old, new) in fields.items():
            was, now = (old, new) if forward else (new, old)
            rows.filter(code=code, **{field: was}).update(**{field: now})


def forwards(apps, schema_editor):
    _apply(apps, schema_editor, True)


def backwards(apps, schema_editor):
    _apply(apps, schema_editor, False)


class Migration(migrations.Migration):
    dependencies = [("org", "0014_alter_organization_category")]
    operations = [migrations.RunPython(forwards, backwards)]
