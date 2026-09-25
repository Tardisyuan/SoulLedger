"""杜阿特的行程形状从「十二时之河」改成「称心二岔」(2026-09-26)。

种子里六个站出自《亡灵书》,不是《阿姆杜阿特》:没有公认的「站 → 夜之时」对照,
编一个就是捏造。新形状(apps/actors/mythology/realms.py REALM_TOPOLOGY 的 EGYPTIAN 一段):

    主干  EG_DUAT_ENTRY 1 → EG_SEVEN_ARRWT 2 → EG_HALL_TWO_TRUTHS 3(称心)
    过    EG_TWENTYONE_SEBKHET 4 → EG_AARU 5            fork = PASS
    不过  EG_ANNIHILATION 4(第二次死亡,不是地方)        fork = FAIL

`tier` 跟着改:七道通路排到真理大厅之前(2 / 3),二十一道门户只在「过」那条路上(4)。

``seed_mythology`` 默认只建不改(见 ``realms/0016``),`tier` 不会跟着种子变,所以这里改;
`order` / `fork` 虽然会被种子的 fill-if-null 补上,也一并在这里写,让迁移本身就是完整的。
逐行逐列只动**仍是旧值**的:有人手改过的不覆盖。走 ``_base_manager``,理由同 ``realms/0016``。

`fork` 的选项集加了 PASS / FAIL(RealmFork 的说明写了为什么不复用 LEFT / RIGHT)。
选项在 Python 里不在列上,AlterField 不改库;倒回去时旧选项集里没有 PASS / FAIL,
所以 backwards 先还原本迁移写的行,再照 ``realms/0020`` 的做法只读地检查:
还有别的行取 PASS / FAIL(`fork` 可经界域接口写)就停下并点名,不留一个模型不认的值。
"""
from django.db import migrations, models

# code -> {field: (old, new)}
CHANGES = {
    "EG_DUAT_ENTRY": {"order": (None, 1)},
    "EG_SEVEN_ARRWT": {"order": (None, 2), "tier": (3, 2)},
    "EG_HALL_TWO_TRUTHS": {"order": (None, 3), "tier": (2, 3)},
    "EG_TWENTYONE_SEBKHET": {"order": (None, 4), "fork": (None, "PASS"), "tier": (3, 4)},
    "EG_AARU": {"order": (None, 5), "fork": (None, "PASS")},
    "EG_ANNIHILATION": {"order": (None, 4), "fork": (None, "FAIL")},
}


def _apply(apps, frm, to):
    Realm = apps.get_model("realms", "Realm")
    changed = set()
    for code, fields in CHANGES.items():
        for field, pair in fields.items():
            if Realm._base_manager.filter(realm_code=code, **{field: pair[frm]}).update(**{field: pair[to]}):
                changed.add(code)
    return changed


def forwards(apps, schema_editor):
    _apply(apps, 0, 1)


def backwards(apps, schema_editor):
    _apply(apps, 1, 0)
    refuse_if_any_row_takes_pass_or_fail(apps, schema_editor)


def refuse_if_any_row_takes_pass_or_fail(apps, schema_editor):
    Realm = apps.get_model("realms", "Realm")
    codes = list(Realm._base_manager.filter(fork__in=["PASS", "FAIL"]).values_list("realm_code", flat=True))
    if codes:
        raise RuntimeError(
            f"Realm.fork = PASS/FAIL on {codes}; decide LEFT / RIGHT / NULL for them before removing the values."
        )


class Migration(migrations.Migration):
    dependencies = [("realms", "0021_egy_names_section_nine")]

    operations = [
        migrations.AlterField(
            model_name="realm",
            name="fork",
            field=models.CharField(
                blank=True,
                choices=[
                    ("LEFT", "左(塔尔塔罗斯)"),
                    ("RIGHT", "右(至福岛)"),
                    ("PASS", "过(称心通过)"),
                    ("FAIL", "不过(第二次死亡)"),
                ],
                help_text="Greek (LEFT/RIGHT) and Egyptian (PASS/FAIL): which road out of the judgment place",
                max_length=6,
                null=True,
            ),
        ),
        migrations.RunPython(forwards, backwards),
    ]
