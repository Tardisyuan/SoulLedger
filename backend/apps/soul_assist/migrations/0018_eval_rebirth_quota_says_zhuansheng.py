"""Data migration: 0015 写下的评测问句「转世配额在哪里设置？」改成「转生配额」(用户 2026-11-07 CN-17:动作叫转生)。

帮助条目 `officer-rebirth-quota.md` 的同义问法同一轮改了;只改仍是 0015 原样的那条,管理员在页面上改过的不动。
可逆:backward 改回原句,0015 的 backward 才删得到它。
"""
from django.db import migrations

OLD, NEW = "转世配额在哪里设置？", "转生配额在哪里设置？"


def _rename(apps, schema_editor, before, after):
    Case = apps.get_model("soul_assist", "AssistEvalCase")
    Case.objects.using(schema_editor.connection.alias).filter(side="officer", question=before).update(question=after)


def forward(apps, schema_editor):
    _rename(apps, schema_editor, OLD, NEW)


def backward(apps, schema_editor):
    _rename(apps, schema_editor, NEW, OLD)


class Migration(migrations.Migration):
    dependencies = [("soul_assist", "0017_eval_inbox_cases_for_a_judge_officer")]

    operations = [migrations.RunPython(forward, backward)]
