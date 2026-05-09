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
        # Note: karmic_balance is a @property, not a DB field - cannot index it directly
        # Index on merit_score alone (part of karmic_balance computation)
        migrations.AddIndex(
            model_name="soul",
            index=models.Index(
                fields=["tenant", "merit_score"],
                name="idx_soul_tenant_merit",
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
