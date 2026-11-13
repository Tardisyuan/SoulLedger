"""EG_DUAT 的描述去掉「Lake of Fire」(civ-audit-2026-11-13 EG-25)。

火之湖不是种下的界域(``mythology/realms.py`` 埃及六行里没有它),docs/02 §5.2 里它只是阿米特位置的一个变体见证。
``seed_tenants`` 用 ``get_or_create``,已有的行不会跟着改。只动仍是旧值的行;走 ``_base_manager``。
"""
from django.db import migrations

OLD = "Egyptian Duat — Field of Reeds (Aaru), Hall of Two Truths, Lake of Fire"
NEW = "Egyptian Duat — Hall of Two Truths, Field of Reeds (Aaru)"


def _apply(apps, schema_editor, was, now):
    Tenant = apps.get_model("tenants", "Tenant")
    Tenant._base_manager.using(schema_editor.connection.alias).filter(code="EG_DUAT", description=was).update(description=now)


def forwards(apps, schema_editor):
    _apply(apps, schema_editor, OLD, NEW)


def backwards(apps, schema_editor):
    _apply(apps, schema_editor, NEW, OLD)


class Migration(migrations.Migration):
    dependencies = [("tenants", "0021_hall_name_egy_wesekhet_maaty")]
    operations = [migrations.RunPython(forwards, backwards)]
