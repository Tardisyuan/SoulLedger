"""`judgment_pending_idx` 的条件去掉 `is_archived=False`(审计 2026-11-20 §4 #3)。

归档只收有裁决的案子(`JudgmentViewSet.archive`;admin 里裁决与归档列只读),所以「未结」不再连带看归档,
队列的 `views.PENDING` 也不写它。计划器只在查询条件蕴含索引条件时用部分索引:条件里还留着 `is_archived` 的话,
`PENDING` 就用不上它。同名先删后建,都是 CONCURRENTLY,不锁写。
"""
from django.db import migrations, models

from apps.core.migration_ops import AddIndexConcurrently, RemoveIndexConcurrently


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("judgment", "0058_explicit_through_bare_ids"),
    ]

    operations = [
        RemoveIndexConcurrently(model_name="judgment", name="judgment_pending_idx"),
        AddIndexConcurrently(
            model_name="judgment",
            index=models.Index(
                condition=models.Q(is_deleted=False, is_final=False, verdict__isnull=True),
                fields=["tenant", "claimed_by", "created_at"],
                name="judgment_pending_idx",
            ),
        ),
    ]
