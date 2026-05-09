# Generated migration for SoulLedger indexes per SPEC §8.1
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("souls", "0006_remove_soul_idx_soul_tenant_state_and_more"),
    ]

    operations = [
        # Soul: composite indexes for common query patterns
        migrations.AddIndex(
            model_name="soul",
            index=models.Index(
                fields=["tenant", "current_state"],
                name="idx_soul_tenant_state",
            ),
        ),
        migrations.AddIndex(
            model_name="soul",
            index=models.Index(
                fields=["tenant", "created_at"],
                name="idx_soul_tenant_created",
            ),
        ),
        migrations.AddIndex(
            model_name="soul",
            index=models.Index(
                fields=["tenant", "karmic_balance"],
                name="idx_soul_tenant_karma",
            ),
        ),
        # SoulRecord: indexes for karmic queries
        migrations.AddIndex(
            model_name="soulrecord",
            index=models.Index(
                fields=["soul", "recorded_at"],
                name="idx_soulrec_soul_recorded",
            ),
        ),
        migrations.AddIndex(
            model_name="soulrecord",
            index=models.Index(
                fields=["tenant", "record_type"],
                name="idx_soulrec_tenant_type",
            ),
        ),
    ]
