"""未读通知的部分索引(be-scale 4.5)。`CREATE INDEX CONCURRENTLY`,不锁写。"""
from django.db import migrations, models

from apps.core.migration_ops import AddIndexConcurrently


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("notifications", "0019_wangsi_grievance_filed"),
    ]

    operations = [
        AddIndexConcurrently(
            model_name="usernotification",
            index=models.Index(condition=models.Q(is_read=False), fields=["user", "created_at"], name="notif_unread_idx"),
        ),
    ]
