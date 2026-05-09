"""
Migration 0008: backfill tenant on SoulRecord + add composite indexes.

Running this migration on an existing database with pre-tenant SoulRecords
is safe — it first fills tenant_id from soul.tenant, then adds the index.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("souls", "0007_soul_indexes"),
    ]

    operations = [
        # 1. Backfill tenant_id for existing records that have no tenant set.
        #    We do this BEFORE adding the unique constraint, so orphan records
        #    (with soul.tenant=null) don't block the migration.
        migrations.RunSQL(
            sql="""
                UPDATE souls_soulrecord
                SET tenant_id = (
                    SELECT tenant_id FROM souls_soul WHERE souls_soul.id = souls_soulrecord.soul_id
                )
                WHERE tenant_id IS NULL;
            """,
            reverse_sql="""
                UPDATE souls_soulrecord SET tenant_id = NULL WHERE tenant_id IS NOT NULL;
            """,
        ),

        # 2. Make tenant required (no more null — every record belongs to a tenant)
        migrations.AlterField(
            model_name="soulrecord",
            name="tenant",
            field=models.ForeignKey(
                "tenants.Tenant",
                on_delete=models.CASCADE,
                related_name="soul_records",
            ),
            preserve_default=True,
        ),

        # 3. Add composite indexes for common query patterns
        migrations.AddIndex(
            model_name="soulrecord",
            index=models.Index(fields=["tenant", "soul"], name="idx_sr_tenant_soul"),
        ),
        migrations.AddIndex(
            model_name="soulrecord",
            index=models.Index(fields=["soul", "record_type"], name="idx_sr_soul_type"),
        ),
        migrations.AddIndex(
            model_name="soulrecord",
            index=models.Index(fields=["tenant", "recorded_at"], name="idx_sr_tenant_date"),
        ),
    ]
