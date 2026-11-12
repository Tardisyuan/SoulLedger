"""
Design batch 29 gave the Asphodel Meadow its egy name: GR_ASPHODEL_MEADOW -> Leimon Asphodelos.

``seed_mythology`` only creates rows and never updates them (see ``realms/0016``), so an existing
row keeps its blank ``name_egy`` until this runs. Only a still-blank row is filled: a name someone
set by hand is not overwritten. ``_base_manager`` for the same reason as ``realms/0021``.
"""
from django.db import migrations

CODE, NAME = "GR_ASPHODEL_MEADOW", "Leimon Asphodelos"


def forwards(apps, schema_editor):
    Realm = apps.get_model("realms", "Realm")
    Realm._base_manager.using(schema_editor.connection.alias).filter(realm_code=CODE, name_egy="").update(name_egy=NAME)


def backwards(apps, schema_editor):
    Realm = apps.get_model("realms", "Realm")
    Realm._base_manager.using(schema_editor.connection.alias).filter(realm_code=CODE, name_egy=NAME).update(name_egy="")


class Migration(migrations.Migration):
    dependencies = [("realms", "0033_greek_fork_middle_for_asphodel")]
    operations = [migrations.RunPython(forwards, backwards)]
