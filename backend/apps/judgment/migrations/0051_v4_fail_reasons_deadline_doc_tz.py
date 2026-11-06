"""v4(用户 2026-11-06):「不过」的理由(D6)、希腊的文书与可医标记(D8 / D7)、文书时区(D12)、审判期限的起点(D10)。

七列都是新增、可空或有默认值,存量行不变,只回填 `claimable_since`:期限从「可认领」起算,老案子的起点按
它们的列推 —— 开案时间、解送时间、`held_until` 那天 0 点(UTC;活代码按殿的时区,迁移里冻结成 UTC,差几个小时)
三者取最晚;还在城隍处(PENDING / RETURNED)或永远到不了审判殿(NAMELESS / IMPROPER_BURIAL)的留空,与
`apps/judgment/deadline.py::refresh_claimable_since` 同一规则。已结案的也回填,概览的「平均用时」读它。
分批 iterator + bulk_update,不走 save()。backward:RunPython 不做事,由前面的 RemoveField 删列。
"""
import datetime

from django.db import migrations, models

BATCH = 2000
AT_CITY_GOD = ("PENDING", "RETURNED")
DUAT_BARRED = ("NAMELESS", "IMPROPER_BURIAL")


def backfill(apps, schema_editor):
    alias = schema_editor.connection.alias
    Judgment = apps.get_model("judgment", "Judgment")
    rows = (
        Judgment._base_manager.using(alias)
        .filter(claimable_since__isnull=True)
        .exclude(city_god_status__in=AT_CITY_GOD)
        .exclude(duat_stage__in=DUAT_BARRED)
        .only("pk", "created_at", "sent_on_at", "held_until", "claimable_since")
        .order_by("pk")
    )
    batch, total = [], 0
    for judgment in rows.iterator(chunk_size=BATCH):
        starts = [judgment.created_at, judgment.sent_on_at]
        if judgment.held_until is not None:
            starts.append(datetime.datetime.combine(judgment.held_until, datetime.time.min, tzinfo=datetime.UTC))
        starts = [s for s in starts if s is not None]
        if not starts:
            continue
        judgment.claimable_since = max(starts)
        batch.append(judgment)
        if len(batch) >= BATCH:
            Judgment._base_manager.using(alias).bulk_update(batch, ["claimable_since"], batch_size=BATCH)
            total += len(batch)
            batch = []
    if batch:
        Judgment._base_manager.using(alias).bulk_update(batch, ["claimable_since"], batch_size=BATCH)
        total += len(batch)
    if total:
        print(f"\n  judgment/0051: 回填 claimable_since {total} 行", end="")


class Migration(migrations.Migration):

    dependencies = [
        ("judgment", "0050_backfill_judgment_owner_org"),
    ]

    operations = [
        migrations.AddField(
            model_name="judgment",
            name="fail_reasons",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="judgment",
            name="fail_reason_note",
            field=models.CharField(blank=True, default="", max_length=500),
        ),
        migrations.AddField(
            model_name="judgment",
            name="greek_account",
            field=models.CharField(
                blank=True, choices=[("GORGIAS", "《高尔吉亚》"), ("REPUBLIC", "《理想国》")], default="",
                max_length=10),
        ),
        migrations.AddField(
            model_name="judgment",
            name="greek_curability",
            field=models.CharField(
                blank=True, choices=[("CURABLE", "可医"), ("INCURABLE", "不可医")], default="", max_length=10),
        ),
        migrations.AddField(
            model_name="judgment",
            name="concluded_tz",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="judgment",
            name="claimable_since",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="judgment",
            name="deferred_total",
            field=models.DurationField(default=datetime.timedelta(0)),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
