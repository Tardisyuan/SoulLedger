"""Remove the unused MIDDLE value from `Realm.fork`'s choices (2026-09-25).

Choices live in Python, not in the column, so the AlterField below changes
nothing in the database. What it cannot see is a row that already holds
"MIDDLE": no seed row does (apps/actors/mythology/realms.py REALM_TOPOLOGY sets
LEFT and RIGHT only, and tests/test_realm_path_fields.py asserts no row takes
MIDDLE after `seed_mythology`), but `fork` is writable through the realms API,
so a deployed database could hold one that nobody here could query. The check
below only reads: it stops the migration and names the rows instead of leaving
them holding a value the model no longer accepts.
"""
from django.db import migrations, models


def refuse_if_any_row_takes_middle(apps, schema_editor):
    Realm = apps.get_model("realms", "Realm")
    codes = list(Realm._base_manager.filter(fork="MIDDLE").values_list("realm_code", flat=True))
    if codes:
        raise RuntimeError(
            f"Realm.fork = 'MIDDLE' on {codes}; decide LEFT / RIGHT / NULL for them before removing the value."
        )


class Migration(migrations.Migration):

    dependencies = [
        ("realms", "0019_realm_topology_and_soul_path"),
    ]

    operations = [
        migrations.RunPython(refuse_if_any_row_takes_middle, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="realm",
            name="fork",
            field=models.CharField(
                blank=True,
                choices=[("LEFT", "左(塔尔塔罗斯)"), ("RIGHT", "右(至福岛)")],
                help_text="Greek only: which road out of the judgment place",
                max_length=6,
                null=True,
            ),
        ),
    ]
