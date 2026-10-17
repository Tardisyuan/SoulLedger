"""滞留从 `notes` 里的一行字搬到 `stale_since` 一列(用户 2026-10-17 决定)。

此前定时任务 `judgment.auto_conclude_stale` 往 `notes` 末尾追加
`\\n[SYSTEM] Flagged as stale on <iso 时刻>`。这里对 `notes` 含这一行的判决:

* 未结案的(`verdict` 为空且 `is_final` 为假)把 `stale_since` 设成那一行里的时刻,
  读不出时刻就用迁移时刻;
* 所有带标记的行都删掉标记行(结案会覆盖 `notes`,所以已结案的通常已不带它)。

反向是 noop:列由 AddField 的反向删掉,标记行不写回 `notes` —— 已经没有代码读它。

不包 `except`:PostgreSQL 上失败的语句会中止事务(见 CLAUDE.md、perm/0017)。
"""
import re

from django.db import migrations, models
from django.utils import timezone
from django.utils.dateparse import parse_datetime

# 与 apps/judgment/tasks.py 的 STALE_MARKER 同一字面量;迁移不 import 应用代码。
MARKER = "[SYSTEM] Flagged as stale"
LINE = re.compile(r"\n?" + re.escape(MARKER) + r"(?: on (\S+))?[^\n]*")


def strip_marker(notes: str):
    """(去掉标记行之后的 notes, 第一行标记里读得出的时刻或 None)。"""
    stamps = [parse_datetime(m) for m in LINE.findall(notes) if m]
    return LINE.sub("", notes), next((s for s in stamps if s), None)


def forwards(apps, schema_editor):
    alias = schema_editor.connection.alias
    judgment_model = apps.get_model("judgment", "Judgment")
    manager = judgment_model._base_manager.using(alias)
    now = timezone.now()
    flagged = manager.filter(notes__contains=MARKER).only("pk", "notes", "verdict", "is_final")
    for judgment in flagged.iterator():
        notes, stamp = strip_marker(judgment.notes)
        values = {"notes": notes}
        if judgment.verdict is None and not judgment.is_final:
            values["stale_since"] = stamp or now
        manager.filter(pk=judgment.pk).update(**values)


class Migration(migrations.Migration):

    dependencies = [
        ("judgment", "0036_case_summary_reassign_request"),
    ]

    operations = [
        migrations.AddField(
            model_name="judgment",
            name="stale_since",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
