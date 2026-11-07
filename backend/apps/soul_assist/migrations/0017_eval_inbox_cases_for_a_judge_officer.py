"""Data migration: 评测官员换成判官(JUDGE,用户 2026-11-07)后,两条收件箱计数评测的正确答法是「无权」。

此前评测官员是 MODERATOR(殿主,持 soul_inbox.read),期望它调 `inbox_counts`。MODERATOR 改为只管朋友圈审核后,
评测官员换成 JUDGE —— 判官不持 soul_inbox.read,`inbox_counts` 根本不会提供给它(`officer_tools._permitted`),
答对就是说明没有这个权限。所以期望改成:不调工具,回答里提到权限。

只改仍是原期望(`expected_tools == ["inbox_counts"]`、`must_include == []`)的那两条;管理员在页面上改过的不动。
可逆:backward 把这两条改回原期望(同样只改仍是本迁移写下的样子的)。
"""
from django.db import migrations

CASES = {
    "收件箱里有几封信待回复？": ["权限"],
    "How many letters await a reply?": ["permission"],
}
OLD_TOOLS = ["inbox_counts"]


def _cases(apps, schema_editor, question):
    Case = apps.get_model("soul_assist", "AssistEvalCase")
    return Case.objects.using(schema_editor.connection.alias).filter(side="officer", question=question)


def forward(apps, schema_editor):
    for question, include in CASES.items():
        for case in _cases(apps, schema_editor, question):
            if case.expected_tools == OLD_TOOLS and not case.must_include:
                case.expected_tools, case.must_include = [], include
                case.save(update_fields=["expected_tools", "must_include"])


def backward(apps, schema_editor):
    for question, include in CASES.items():
        for case in _cases(apps, schema_editor, question):
            if case.expected_tools == [] and case.must_include == include:
                case.expected_tools, case.must_include = OLD_TOOLS, []
                case.save(update_fields=["expected_tools", "must_include"])


class Migration(migrations.Migration):
    dependencies = [("soul_assist", "0016_eval_cases_for_batch57_help_entries")]

    operations = [migrations.RunPython(forward, backward)]
