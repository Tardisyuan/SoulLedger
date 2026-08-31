"""把 `SoulRecord.civilization` 回填成它一直声称自己是的东西。

这一列的 help_text 从加上的那天起就写着「Derived from soul's tenant」,而
**没有任何代码派生它**:`save()` 只补 `tenant`,`default=Civilization.CHINESE`
把每一条记录都盖成中国 —— 包括希腊、埃及、欧洲租户下的灵魂。唯一写它的地方是
序列化器的一个可写字段,也就是说这一列的值来自客户端,而不是来自灵魂。
`idx_soulrecord_civ` 索引的就是这个答案。

`save()` 现在派生它;这里把已经写进去的行对齐。按 `soul.tenant.code` 映射,
与 `apps/souls/models.py::TENANT_CIVILIZATION` 同一张表 —— 迁移里不能 import
运行时常量而不把历史钉死在当下,所以这张表在这里重抄了一遍,并由
`tests/test_soulrecord_civilization_is_derived.py` 钉住两边一致。

没有 soul 的记录(`soul_id` 为空)不动:没有可派生的来源,把它改成任何值都是
在编。反向不可逆(原值就是错的,没有可恢复的信息),所以 backward 是 no-op 而
不是假装能还原。
"""
from django.db import migrations

TENANT_CIVILIZATION = {
    "CN_DIYU": "CHINESE",
    "EU_HEAVEN_HELL": "EUROPEAN",
    "EG_DUAT": "EGYPTIAN",
    "GR_HADES": "GREEK",
}


def backfill(apps, schema_editor):
    SoulRecord = apps.get_model("souls", "SoulRecord")
    for code, civ in TENANT_CIVILIZATION.items():
        SoulRecord.objects.filter(soul__tenant__code=code).exclude(
            civilization=civ
        ).update(civilization=civ)


class Migration(migrations.Migration):
    dependencies = [("souls", "0030_soul_record_weight_bounds")]
    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
