"""
Constrain Realm.memory_reset_mechanism to MemoryResetMechanism.

The column was a bare CharField with no `choices=`. Its values happened to
match apps.disposition.models.MemoryResetMechanism, but nothing enforced that,
so the "LETIES" misspelling propagated into realm reference data with no check
that could report it. The row rewrite itself lives in
disposition/0009_lethe_storage_value (both tables in one reversible step);
this migration only records the new field definition, and depends on 0009 so
the constraint is declared after the rows already satisfy it.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("realms", "0010_realm_delete_cascade_id"),
        ("disposition", "0009_lethe_storage_value"),
    ]

    operations = [
        migrations.AlterField(
            model_name="realm",
            name="memory_reset_mechanism",
            field=models.CharField(
                blank=True,
                choices=[
                    ("MENGPO", "孟婆汤 (Mengpo Soup)"),
                    ("LETHE", "忘川 (Lethe)"),
                    ("SPELL", "Spell Recitation"),
                    ("NONE", "No Reset"),
                ],
                max_length=100,
            ),
        ),
    ]
