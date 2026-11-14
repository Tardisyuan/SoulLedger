from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("reincarnation", "0017_backfill_from_to_tenant"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="reincarnation",
            constraint=models.UniqueConstraint(fields=("soul", "cycle_count"), name="reincarnation_one_per_soul_cycle"),
        ),
    ]
