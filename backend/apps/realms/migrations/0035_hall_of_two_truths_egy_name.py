"""
Design batch 33 retired the egy phrase ``Weret Maaty`` (no attested root) for the Hall of Two Truths:
EG_HALL_TWO_TRUTHS -> ``Wesekhet Maaty`` (the court of the two truths).

``seed_mythology`` only creates rows and never updates them (see ``realms/0016``), so an existing row keeps
the old value until this runs. Only a row still holding the old value is changed: a name someone set by
hand is not overwritten. ``_base_manager`` for the same reason as ``realms/0021``.
"""
from django.db import migrations

CODE, OLD, NEW = "EG_HALL_TWO_TRUTHS", "Weret Maaty", "Wesekhet Maaty"


def _swap(apps, schema_editor, src, dst):
    Realm = apps.get_model("realms", "Realm")
    Realm._base_manager.using(schema_editor.connection.alias).filter(realm_code=CODE, name_egy=src).update(name_egy=dst)


def forwards(apps, schema_editor):
    _swap(apps, schema_editor, OLD, NEW)


def backwards(apps, schema_editor):
    _swap(apps, schema_editor, NEW, OLD)


class Migration(migrations.Migration):
    dependencies = [("realms", "0034_asphodel_meadow_egy_name")]
    operations = [migrations.RunPython(forwards, backwards)]
