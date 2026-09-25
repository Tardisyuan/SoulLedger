"""Data migration: 已结案子的引用补录快照,标 BACKFILLED。

0028 之前结的案子没有「结案时文本」可取 —— 那一刻的文字已经不在了。补录用的是
**迁移那天**的渲染(apps/judgment/snapshot.py,与结案同一条路径,哈希可比),并标
`BACKFILLED`,让审判台写「补录」而不是「结案时文本」:冒充结案时的文字就是在记录上
编一句当时没说的话。

全部走 `_base_manager`(与 0012 同理:`objects` 是租户 + 软删过滤的)。

可逆:backward 只清掉 BACKFILLED 的快照列,结案时拍下的(CONCLUDED)不动。
"""
from django.db import migrations
from django.utils import timezone

from apps.judgment import snapshot


def forward(apps, schema_editor):
    JudgmentCitation = apps.get_model("judgment", "JudgmentCitation")
    at = timezone.now()
    rows = list(
        JudgmentCitation._base_manager.filter(
            is_deleted=False, snapshot_at__isnull=True, judgment__is_final=True,
        ).select_related("statute", "statute__source_actor")
    )
    for c in rows:
        snapshot.fill(c, c.statute, "BACKFILLED", at)
    JudgmentCitation._base_manager.bulk_update(rows, snapshot.SNAPSHOT_FIELDS, batch_size=500)


def backward(apps, schema_editor):
    JudgmentCitation = apps.get_model("judgment", "JudgmentCitation")
    JudgmentCitation._base_manager.filter(snapshot_kind="BACKFILLED").update(
        snapshot_title=None, snapshot_text=None, snapshot_source="",
        snapshot_hash="", snapshot_at=None, snapshot_kind="",
    )


class Migration(migrations.Migration):
    dependencies = [
        ("judgment", "0028_citation_statute_snapshot"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
