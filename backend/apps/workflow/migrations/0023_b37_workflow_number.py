"""审批编号(ApprovalWorkflow.number,`WF-0582`)—— 结构一步。

与案号(judgment/0031–0033)同样三步走:加可空列 → 0024 回填 → 0025 收紧成非空唯一。
不在同一个迁移里先 UPDATE 再 ALTER:PostgreSQL 上同一事务里有待触发的约束事件时
ALTER TABLE 会拒绝("pending trigger events"),SQLite 不会。
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("workflow", "0022_node_cosigners"),
        # 编号从案号的计数表(`JudgmentCaseCounter`)的 `WF` 行发。
        ("judgment", "0036_case_summary_reassign_request"),
    ]

    operations = [
        migrations.AddField(
            model_name="approvalworkflow",
            name="number",
            field=models.CharField(editable=False, max_length=32, null=True),
        ),
    ]
