"""Greek fork gets its middle road back: 阿斯福得草原(2026-11-11 用户定，docs/04 §三 三分)。

0020 删掉过 MIDDLE(当时没有任何行取它)。这里加回，种子把 `GR_ASPHODEL_MEADOW` 放在这条路上
(`apps/actors/mythology/realms.py` REALM_TOPOLOGY)。往回退时先把取 MIDDLE 的行清成 NULL,
再收窄 choices —— 不留一个 choices 里没有的值。
"""
from django.db import migrations, models


def clear_middle(apps, schema_editor):
    Realm = apps.get_model("realms", "Realm")
    Realm._base_manager.using(schema_editor.connection.alias).filter(fork="MIDDLE").update(fork=None)


class Migration(migrations.Migration):
    dependencies = [("realms", "0032_greek_meadow_code")]

    operations = [
        migrations.AlterField(
            model_name="realm",
            name="fork",
            field=models.CharField(
                blank=True,
                choices=[
                    ("LEFT", "左(塔尔塔罗斯)"),
                    ("MIDDLE", "中(阿斯福得草原)"),
                    ("RIGHT", "右(至福岛)"),
                    ("PASS", "过(称心通过)"),
                    ("FAIL", "不过(第二次死亡)"),
                ],
                help_text="Greek (LEFT/RIGHT) and Egyptian (PASS/FAIL): which road out of the judgment place",
                max_length=6,
                null=True,
            ),
        ),
        migrations.RunPython(migrations.RunPython.noop, clear_middle),
    ]
