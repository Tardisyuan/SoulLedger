"""案卷台 / queue-counts 的部分索引(be-scale 1.3、4.3)。`CREATE INDEX CONCURRENTLY`,不锁写。"""
from django.db import migrations, models

from apps.core.migration_ops import AddIndexConcurrently


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("judgment", "0052_european_corpus_corrections"),
    ]

    operations = [
        AddIndexConcurrently(
            model_name="judgment",
            index=models.Index(
                condition=models.Q(is_archived=False, is_deleted=False, is_final=False, verdict__isnull=True),
                fields=["tenant", "claimed_by", "created_at"],
                name="judgment_pending_idx",
            ),
        ),
    ]
