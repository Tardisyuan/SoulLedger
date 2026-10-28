"""RealmType gains ANNIHILATION; the Egyptian second death moves onto it (user 2026-10-28).

docs/01_埃及冥界整体架构.md §2.2 and docs/02_奥西里斯审判详解.md §5.2: the second death is an outcome, not a place.
`EG_ANNIHILATION` was HELL only because no member meant "ceased to exist". `seed_mythology` is create-only, so this
moves rows already seeded: EGYPTIAN rows coded EG_ANNIHILATION still on HELL. The reverse puts back only rows still
on ANNIHILATION. Row access through ``_base_manager`` on the migrated alias (see realms/0015).
"""
from django.db import migrations, models


def forward(apps, schema_editor):
    Realm = apps.get_model("realms", "Realm")
    Realm._base_manager.using(schema_editor.connection.alias).filter(
        civilization="EGYPTIAN", realm_code="EG_ANNIHILATION", realm_type="HELL",
    ).update(realm_type="ANNIHILATION")


def backward(apps, schema_editor):
    Realm = apps.get_model("realms", "Realm")
    Realm._base_manager.using(schema_editor.connection.alias).filter(
        civilization="EGYPTIAN", realm_code="EG_ANNIHILATION", realm_type="ANNIHILATION",
    ).update(realm_type="HELL")


class Migration(migrations.Migration):

    dependencies = [
        ("realms", "0024_realm_code_unique_per_hall"),
    ]

    operations = [
        migrations.AlterField(
            model_name="realm",
            name="realm_type",
            field=models.CharField(
                choices=[
                    ("HELL", "Hell / Punishment"),
                    ("PURGATORY", "Purgatory / Intermediate"),
                    ("BLISS", "Heaven / Bliss"),
                    ("NEUTRAL", "Neutral / Between"),
                    ("ANNIHILATION", "Annihilation / Ceased to exist"),
                ],
                max_length=20,
            ),
        ),
        migrations.RunPython(forward, backward),
    ]
