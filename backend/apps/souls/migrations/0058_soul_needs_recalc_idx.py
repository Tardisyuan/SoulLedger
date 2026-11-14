"""待重算灵魂的部分索引(be-scale 4.5)。`CREATE INDEX CONCURRENTLY`,不锁写。"""
from django.db import migrations, models

from apps.core.migration_ops import AddIndexConcurrently


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("souls", "0057_soul_death_location"),
    ]

    operations = [
        AddIndexConcurrently(
            model_name="soul",
            index=models.Index(
                condition=models.Q(needs_ledger_recalculation=True), fields=["tenant"], name="soul_needs_recalc_idx",
            ),
        ),
    ]
