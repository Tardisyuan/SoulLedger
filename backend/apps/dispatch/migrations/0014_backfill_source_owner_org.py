"""暂居中的调拨(EXECUTED)回填 `source_owner_org` = 原属殿根(数据范围 B1)。

执行时灵魂还在原属殿、不在暂居(`DispatchService.execute` 在行锁下检查),所以 `source_tenant` 就是原属殿。
当时的归属机构没有留存,取原属殿根;结束暂居时灵魂回到这里(`end_residence`)。
已回归 / 其它状态不填:不会再被读。backward 由 0013 删列。
"""
from django.db import migrations


def backfill(apps, schema_editor):
    alias = schema_editor.connection.alias
    DispatchRecord = apps.get_model("dispatch", "DispatchRecord")
    Organization = apps.get_model("org", "Organization")
    roots = (
        Organization.all_objects.using(alias)
        .filter(parent__isnull=True, is_deleted=False, tenant__isnull=False)
        .values_list("tenant_id", "pk")
    )
    total = 0
    for tenant_id, root in roots:
        total += DispatchRecord._base_manager.using(alias).filter(
            status="EXECUTED", source_tenant_id=tenant_id, source_owner_org__isnull=True,
        ).update(source_owner_org=root)
    if total:
        print(f"\n  dispatch/0014: 暂居调拨回填 source_owner_org {total} 行", end="")


class Migration(migrations.Migration):
    dependencies = [
        ("dispatch", "0013_dispatchrecord_source_owner_org"),
        ("souls", "0055_backfill_soul_owner_org"),
    ]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
