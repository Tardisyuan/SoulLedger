# Reincarnation composite indexes per SPEC §8.1
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("reincarnation", "0002_reincarnation_tenant"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="reincarnation",
            index=models.Index(
                fields=["tenant", "cycle_count"],
                name="idx_reinc_tenant_cycle",
            ),
        ),
        migrations.AddIndex(
            model_name="reincarnation",
            index=models.Index(
                fields=["soul", "reincarnated_at"],
                name="idx_reinc_soul_reincarnated",
            ),
        ),
    ]
