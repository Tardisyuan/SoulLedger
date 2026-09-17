"""转生申请保留首次驳回:first_rejection_reason / first_decided_at(2026-09-17)。

存量回填,只针对**已经申诉过**的申请(appeal_workflow 非空):
* `first_decided_at` **能恢复** —— 原工作流被驳回时 `ApprovalWorkflow.completed_at` 已写入
  (apps/workflow/models.py::complete_node 的驳回分支),取它。
* `first_rejection_reason` **不能恢复** —— 旧的 `appeal()` 直接把 `rejection_reason` 清空,
  而那段「给灵魂的理由」只写在这一列(`record_reason_for_soul` 用 `.update()`,不经审计、不发事件),
  库里没有第二份。保持空串;App / Web 对空串显示「未记录」即可。
未申诉的申请无需回填:它的首次驳回就是 `rejection_reason` / `decided_at` 本身,且在申诉那一刻才抄过来。
"""
from django.db import migrations, models


def backfill(apps, schema_editor):
    RebirthApplication = apps.get_model("soul_accounts", "RebirthApplication")
    rows = RebirthApplication.objects.filter(appeal_workflow__isnull=False, first_decided_at__isnull=True)
    for application in rows.select_related("workflow"):
        if application.workflow.completed_at is not None:
            application.first_decided_at = application.workflow.completed_at
            application.save(update_fields=["first_decided_at"])


class Migration(migrations.Migration):

    dependencies = [
        ('soul_accounts', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='rebirthapplication',
            name='first_decided_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='rebirthapplication',
            name='first_rejection_reason',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
