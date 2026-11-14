"""事件页「类型 + 日期区间」的复合索引(be-scale 4.5)。`CREATE INDEX CONCURRENTLY`,不锁写。"""
from django.db import migrations, models

from apps.core.migration_ops import AddIndexConcurrently


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("events", "0033_soulevent_soul_protect"),
    ]

    operations = [
        AddIndexConcurrently(
            model_name="soulevent",
            index=models.Index(fields=["tenant", "event_type", "create_time"], name="soulevent_tenant_type_time_idx"),
        ),
    ]
