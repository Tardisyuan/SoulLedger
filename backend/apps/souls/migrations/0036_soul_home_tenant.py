"""Soul.home_tenant:原属租户(跨文明调拨改为暂居,2026-09-17)。

回填为当前 tenant。**这对曾经被单程调拨过的存量灵魂是一个判断**:旧代码执行调拨时
直接改了 tenant、没有留下原属,回填后它们被当作目标文明的本土灵魂。另一种读法是
取它最早一条 EXECUTED 调拨记录的 source_tenant 当原属 —— 那会让它们立刻进入「暂居」
并在下一次处置执行时被送回。选前者是因为它不改变任何灵魂当前的管辖与可见性;
要按后者重算,是一次单独的数据修正(见分支报告「待用户确认」)。
"""
from django.db import migrations, models
from django.db.models import F


def backfill(apps, schema_editor):
    Soul = apps.get_model("souls", "Soul")
    Soul._base_manager.filter(home_tenant__isnull=True).update(home_tenant=F("tenant"))


class Migration(migrations.Migration):
    dependencies = [
        ("souls", "0035_soul_code_and_contacts"),
        ("tenants", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="soul",
            name="home_tenant",
            field=models.ForeignKey(
                editable=False,
                help_text="原属租户:调拨暂居期间不变;转生资格按它的文明计算。",
                null=True,
                on_delete=models.deletion.CASCADE,
                related_name="home_souls",
                to="tenants.tenant",
            ),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
