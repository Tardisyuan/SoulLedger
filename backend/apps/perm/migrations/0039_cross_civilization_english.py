"""Data migration: English name for `system.cross_civilization` (0038 seeded it without one).

A new migration rather than an edit to 0038, which may already have run on a database. The text is frozen
here (migrations are snapshots); the live table is `apps/perm/english.py`. Fills a blank only, like 0033.
"""
from django.db import migrations

from apps.core.migration_ops import placed_here

CODENAME, ENGLISH = "system.cross_civilization", "Manage across civilizations"


def forwards(apps, schema_editor):
    if not placed_here(schema_editor, apps, "perm.Permission"):
        return
    Permission = apps.get_model("perm", "Permission")
    Permission._base_manager.using(schema_editor.connection.alias).filter(
        codename=CODENAME, name_en="").update(name_en=ENGLISH)


class Migration(migrations.Migration):
    dependencies = [("perm", "0038_system_admin_role")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
