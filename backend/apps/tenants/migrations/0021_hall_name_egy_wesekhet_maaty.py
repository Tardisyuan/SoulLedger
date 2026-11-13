"""
Design batch 33 retired ``Weret Maaty``: the EG_DUAT hall's egy display name becomes ``Wesekhet Maaty``
(same change as ``realms/0035``).

Only a row still holding the old value is changed (``tenants/0012`` wrote it); a name an operator edited is
left alone. ``_base_manager`` as in ``tenants/0020``.
"""
from django.db import migrations

OLD, NEW = "Weret Maaty", "Wesekhet Maaty"


def _swap(apps, schema_editor, src, dst):
    Tenant = apps.get_model("tenants", "Tenant")
    Tenant._base_manager.using(schema_editor.connection.alias).filter(code="EG_DUAT", hall_name_egy=src).update(hall_name_egy=dst)


def forwards(apps, schema_editor):
    _swap(apps, schema_editor, OLD, NEW)


def backwards(apps, schema_editor):
    _swap(apps, schema_editor, NEW, OLD)


class Migration(migrations.Migration):
    dependencies = [("tenants", "0020_hall_names_follow_the_docs")]
    operations = [migrations.RunPython(forwards, backwards)]
