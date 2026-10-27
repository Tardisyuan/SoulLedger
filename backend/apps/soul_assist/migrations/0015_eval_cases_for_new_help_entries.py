from django.db import migrations

#: 新帮助条目的评测用例(每个条目两种语言各至少一条,tests/test_assist_rag.py 钉住)。
#: (side, screen, question, locale, expected_entries)
CASES = [
    ("soul", "settings", "怎么开启两步验证？", "zh-Hans", ["two-step"]),
    ("soul", "settings", "How do I turn on two-step verification?", "en", ["two-step"]),
    ("soul", "settings", "怎么导出我的资料？", "zh-Hans", ["data-export"]),
    ("soul", "settings", "How do I export my data?", "en", ["data-export"]),
    ("soul", "settings", "有不认识的设备登录了我的账号怎么办？", "zh-Hans", ["sign-in-history"]),
    ("soul", "settings", "How do I sign another device out?", "en", ["sign-in-history"]),
    ("soul", "life", "对审判结果不服怎么申诉？", "zh-Hans", ["judgment-appeal"]),
    ("soul", "life", "How do I appeal a judgment?", "en", ["judgment-appeal"]),
    ("soul", "life", "超度回向是什么？", "zh-Hans", ["dedication"]),
    ("soul", "life", "What is dedication of merit?", "en", ["dedication"]),
    ("officer", "profile", "官员怎么开启两步验证？", "zh-Hans", ["officer-mfa"]),
    ("officer", "profile", "What if I lose my two-step recovery codes?", "en", ["officer-mfa"]),
    ("officer", "judgment", "审判申诉在哪里复核？", "zh-Hans", ["officer-appeals"]),
    ("officer", "judgment", "How do I decide a judgment appeal?", "en", ["officer-appeals"]),
    ("officer", "tenants", "转世配额在哪里设置？", "zh-Hans", ["officer-rebirth-quota"]),
    ("officer", "tenants", "What happens when a hall's rebirth quota is full?", "en", ["officer-rebirth-quota"]),
    ("officer", "other", "官员 App 里的我的数是什么？", "zh-Hans", ["officer-app-stats-and-photos"]),
    ("officer", "other", "How do I photograph evidence in the officer app?", "en", ["officer-app-stats-and-photos"]),
]


def add_cases(apps, schema_editor):
    alias = schema_editor.connection.alias
    Case = apps.get_model("soul_assist", "AssistEvalCase")
    Case.objects.using(alias).bulk_create([
        Case(side=side, screen=screen, question=q, expected_tools=[], must_include=[], must_not_include=[],
             locale=locale, expected_entries=expected)
        for side, screen, q, locale, expected in CASES
    ])


def remove_cases(apps, schema_editor):
    alias = schema_editor.connection.alias
    Case = apps.get_model("soul_assist", "AssistEvalCase")
    for side, _, q, _, _ in CASES:
        Case.objects.using(alias).filter(side=side, question=q).delete()


class Migration(migrations.Migration):

    dependencies = [("soul_assist", "0014_halls_screen")]

    operations = [migrations.RunPython(add_cases, remove_cases)]
