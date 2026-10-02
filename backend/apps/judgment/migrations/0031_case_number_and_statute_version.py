"""案号(Judgment.case_number)与律条版本(Statute.revision / effective_from)—— 结构一步。

三步走,一步一个文件:加可空列 → 0032 回填 → 0033 收紧成非空(案号再加唯一)。
不在同一个迁移里先 UPDATE 再 ALTER:PostgreSQL 上同一事务里有待触发的约束事件时
ALTER TABLE 会拒绝("pending trigger events"),而 SQLite 不会 —— 只在一个引擎上
红的写法,本地全绿也证明不了什么(CLAUDE.md)。
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("judgment", "0030_judgment_dispatch_draft"),
    ]

    operations = [
        migrations.CreateModel(
            name="JudgmentCaseCounter",
            fields=[
                ("key", models.CharField(help_text="<prefix>-<year>", max_length=20, primary_key=True, serialize=False)),
                ("last", models.PositiveIntegerField(default=0)),
            ],
        ),
        migrations.AddField(
            model_name="judgment",
            name="case_number",
            field=models.CharField(editable=False, max_length=32, null=True),
        ),
        migrations.AddField(
            model_name="statute",
            name="revision",
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.AddField(
            model_name="statute",
            name="effective_from",
            field=models.DateField(null=True),
        ),
    ]
