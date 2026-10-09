"""回填案号与律条施行日。

案号:按 (前缀, 年) 分组,组内按 (created_at, id) 排,从 1 起编号 —— 同一份数据
每次跑出同一组号(确定性,round trip 测试钉住)。软删的案子也编号:号永不复用。
前缀与格式抄自 `apps.judgment.models.case_number_prefix` / `format_case_number`
(迁移不 import 会变的模型代码);计数表的 `last` 设为每组发到的最大号。

律条:`revision` 由 0031 的默认值定为 1;`effective_from` = 入库那天(`create_time`)。
这是能说的真话:在这之前没有版本记录,条文从入库起就是现在这个样子 ——
除非有人 `--update` 改过,而那次改动没有留下日期。
"""
from collections import defaultdict

from django.db import migrations
from django.utils import timezone


def _prefix(tenant_code):
    if tenant_code is None:
        return "SL"
    head = "".join(ch for ch in tenant_code.split("_")[0].upper() if ch.isalnum())
    return head[:8] or "SL"


def forward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Judgment = apps.get_model("judgment", "Judgment")
    Counter = apps.get_model("judgment", "JudgmentCaseCounter")
    Statute = apps.get_model("judgment", "Statute")

    groups = defaultdict(list)
    rows = Judgment._base_manager.using(alias).filter(case_number__isnull=True).values_list(
        "pk", "created_at", "tenant__code"
    )
    for pk, created_at, code in rows:
        groups[(_prefix(code), timezone.localtime(created_at).year)].append((created_at, str(pk), pk))

    for (prefix, year), members in sorted(groups.items()):
        counter, _ = Counter.objects.using(alias).get_or_create(key=f"{prefix}-{year}")
        seq = counter.last
        for _, _, pk in sorted(members):
            seq += 1
            Judgment._base_manager.using(alias).filter(pk=pk).update(case_number=f"{prefix}-{year}-{seq:04d}")
        counter.last = seq
        counter.save(using=alias, update_fields=["last"])

    for pk, created in Statute._base_manager.using(alias).filter(effective_from__isnull=True).values_list("pk", "create_time"):
        Statute._base_manager.using(alias).filter(pk=pk).update(effective_from=timezone.localdate(created))


def reverse(apps, schema_editor):
    alias = schema_editor.connection.alias
    apps.get_model("judgment", "Judgment")._base_manager.using(alias).update(case_number=None)
    apps.get_model("judgment", "JudgmentCaseCounter").objects.using(alias).all().delete()
    apps.get_model("judgment", "Statute")._base_manager.using(alias).update(effective_from=None)


class Migration(migrations.Migration):

    dependencies = [
        ("judgment", "0031_case_number_and_statute_version"),
    ]

    operations = [migrations.RunPython(forward, reverse)]
