from django.db import migrations

#: 第五十七批(2026-10-28/29)新帮助条目的评测用例(每个条目两种语言各至少一条,tests/test_assist_rag.py 钉住)。
#: (side, screen, question, locale, expected_entries)
CASES = [
    ("soul", "life", "十三站是什么？我走到哪一站了？", "zh-Hans", ["diyu-stations"]),
    ("soul", "life", "Which of the thirteen stations am I at?", "en", ["diyu-stations"]),
    ("soul", "life", "怎么向城隍申诉冤情，提前出枉死城？", "zh-Hans", ["wangsi-grievance"]),
    ("soul", "life", "How do I file a grievance in the City of Wrongful Death?", "en", ["wangsi-grievance"]),
    ("officer", "judgment", "罪目决定送哪一殿吗？", "zh-Hans", ["officer-offences"]),
    ("officer", "judgment", "Does the offence decide which court a guilty soul goes to?", "en", ["officer-offences"]),
    ("officer", "judgment", "为什么枉死城的申诉判不了属实？", "zh-Hans", ["officer-wangsi"]),
    ("officer", "judgment", "Why can't I uphold a grievance and release the soul early?", "en", ["officer-wangsi"]),
    ("officer", "judgment", "勾魂牒怎么发？", "zh-Hans", ["officer-capture"]),
    ("officer", "souls", "Why can't I issue a capture warrant for this soul?", "en", ["officer-capture"]),
    ("officer", "death-sync", "怎么以土地公名义登记死亡？", "zh-Hans", ["officer-earth-gods"]),
    ("officer", "death-sync", "How do I create an earth god?", "en", ["officer-earth-gods"]),
    ("officer", "souls", "怎么给亡魂挪站？", "zh-Hans", ["officer-diyu-stations"]),
    ("officer", "souls", "How do I choose the next life's continent on rebirth?", "en", ["officer-diyu-stations"]),
    ("officer", "judgment", "欧洲的案子为什么判不了下地狱？", "zh-Hans", ["officer-european-sins"]),
    ("officer", "souls", "What is the vestibule of hell?", "en", ["officer-european-sins"]),
    ("officer", "judgment", "为什么希腊的审判不能认领？", "zh-Hans", ["officer-greek-ferry"]),
    ("officer", "judgment", "When can an unburied soul cross the river?", "en", ["officer-greek-ferry"]),
    ("officer", "judgment", "否定告白记为不实会怎样？", "zh-Hans", ["officer-negative-confession"]),
    ("officer", "judgment", "Why can't I give a Passed verdict on this Egyptian case?", "en", ["officer-negative-confession"]),
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

    dependencies = [("soul_assist", "0015_eval_cases_for_new_help_entries")]

    operations = [migrations.RunPython(add_cases, remove_cases)]
