"""回填审批编号。

一个全局序列(不分殿):全部存量行按 (created_at, id) 排,从计数表 `WF` 行当前的值往上编 ——
同一份数据每次跑出同一组号(确定性,round trip 测试钉住)。软删的也编号:号永不复用。
格式抄自 `apps.workflow.models.format_workflow_number`(迁移不 import 会变的模型代码);
计数表 `WF` 行的 `last` 设为发到的最大号。反向把列清空、删掉 `WF` 行(案号的行不动)。
"""
from django.db import migrations

KEY = "WF"


def forward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Workflow = apps.get_model("workflow", "ApprovalWorkflow")
    Counter = apps.get_model("judgment", "JudgmentCaseCounter")

    rows = Workflow._base_manager.using(alias).filter(number__isnull=True).values_list("pk", "created_at")
    counter, _ = Counter.objects.using(alias).get_or_create(key=KEY)
    seq = counter.last
    for _, _, pk in sorted((created_at, str(pk), pk) for pk, created_at in rows):
        seq += 1
        Workflow._base_manager.using(alias).filter(pk=pk).update(number=f"WF-{seq:04d}")
    counter.last = seq
    counter.save(using=alias, update_fields=["last"])


def reverse(apps, schema_editor):
    alias = schema_editor.connection.alias
    apps.get_model("workflow", "ApprovalWorkflow")._base_manager.using(alias).update(number=None)
    apps.get_model("judgment", "JudgmentCaseCounter").objects.using(alias).filter(key=KEY).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("workflow", "0023_b37_workflow_number"),
    ]

    operations = [migrations.RunPython(forward, reverse)]
