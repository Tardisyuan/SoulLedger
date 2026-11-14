# 来源殿 / 目标殿(be-domain 1.6,2026-11-14)。回填在 0017,唯一约束在 0018:
# PostgreSQL 上同一事务里先改外键列、再 ALTER TABLE 加约束会报 pending trigger events,所以分成三步。

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("reincarnation", "0015_reincarnation_quota_index"),
        ("tenants", "0022_egypt_description_names_seeded_stations"),
    ]

    operations = [
        migrations.AddField(
            model_name="reincarnation",
            name="from_tenant",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to="tenants.tenant",
            ),
        ),
        migrations.AddField(
            model_name="reincarnation",
            name="to_tenant",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to="tenants.tenant",
            ),
        ),
    ]
