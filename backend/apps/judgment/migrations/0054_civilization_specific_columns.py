"""文明专属列的三条 CheckConstraint(be-domain 1.4 / 3.7,2026-11-14;规则写在 `Judgment.Meta.constraints`)。

预检:加约束之前先数存量里违反的行。有就**拒绝迁移**,点名每条规则的行数和前 10 个 id,一行都不改 ——
一件地府的案子带着 `duat_stage`,是数据错了还是 `civilization` 错了,要人看过才知道。
PostgreSQL 的 ADD CONSTRAINT 本来也会失败,但只说「被某些行违反」,不说是哪些。

反向:去掉三条约束;预检反向是 noop。
"""

from django.db import migrations, models

RULES = (
    ("judgment_duat_stage_only_egyptian", "duat_stage is set on a non-EGYPTIAN case",
     lambda q: q.exclude(duat_stage="").exclude(civilization="EGYPTIAN")),
    ("judgment_weighing_only_egyptian", "weighing_result / heart_weight set on a non-EGYPTIAN case",
     lambda q: q.exclude(weighing_result__isnull=True, heart_weight__isnull=True).exclude(civilization="EGYPTIAN")),
    ("judgment_untimely_only_chinese", "untimely is true on a non-CHINESE case",
     lambda q: q.filter(untimely=True).exclude(civilization="CHINESE")),
)


def violations(rows):
    """{约束名: (说明, 行数, 前 10 个 id)},只列有违反的。迁移测试也用它。"""
    found = {}
    for name, what, select in RULES:
        bad = select(rows)
        count = bad.count()
        if count:
            found[name] = (what, count, [str(pk) for pk in bad.order_by("pk").values_list("pk", flat=True)[:10]])
    return found


def precheck(apps, schema_editor):
    rows = apps.get_model("judgment", "Judgment")._base_manager.using(schema_editor.connection.alias)
    found = violations(rows)
    if found:
        lines = [f"  {name}: {count} row(s) — {what}; first ids: {', '.join(ids)}"
                 for name, (what, count, ids) in found.items()]
        raise RuntimeError(
            "judgment/0053: existing judgments violate the civilization-specific column rules. Nothing was changed; "
            "fix these rows (the column or the civilization) and migrate again:\n" + "\n".join(lines))


class Migration(migrations.Migration):

    dependencies = [
        ("judgment", "0053_judgment_pending_idx"),
    ]

    operations = [
        migrations.RunPython(precheck, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="judgment",
            constraint=models.CheckConstraint(
                condition=models.Q(duat_stage="") | models.Q(civilization="EGYPTIAN"),
                name="judgment_duat_stage_only_egyptian",
            ),
        ),
        migrations.AddConstraint(
            model_name="judgment",
            constraint=models.CheckConstraint(
                condition=models.Q(weighing_result__isnull=True, heart_weight__isnull=True)
                | models.Q(civilization="EGYPTIAN"),
                name="judgment_weighing_only_egyptian",
            ),
        ),
        migrations.AddConstraint(
            model_name="judgment",
            constraint=models.CheckConstraint(
                condition=models.Q(untimely=False) | models.Q(civilization="CHINESE"),
                name="judgment_untimely_only_chinese",
            ),
        ),
    ]
