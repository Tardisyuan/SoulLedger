"""回填 `Soul.owner_org`(数据范围 B1):创建人的机构(同殿、未删)> 本殿根机构(org/0010)。tenant 为空保持空。

规则与 `apps/org/ownership.py::default_owner_org` 一致(灵魂没有 court);冻结在这里,不 import 活代码。
暂居中的灵魂按当前(暂居)殿算 —— 创建人在原属殿,于是落到暂居殿的根,与调拨执行时的写法一致;
原属归属记在 `DispatchRecord.source_owner_org`(dispatch/0014)。
分批:iterator(chunk_size=2000) + bulk_update,不走 save()(不发事件、不改 version)。backward 由 0054 删列。
"""
from django.db import migrations

BATCH = 2000


def backfill(apps, schema_editor):
    alias = schema_editor.connection.alias
    Soul = apps.get_model("souls", "Soul")
    Organization = apps.get_model("org", "Organization")
    User = apps.get_model("authentication", "User")
    roots = dict(
        Organization.all_objects.using(alias)
        .filter(parent__isnull=True, is_deleted=False, tenant__isnull=False)
        .values_list("tenant_id", "pk")
    )
    user_org = {
        pk: (org, org_tenant)
        for pk, org, org_tenant in User._base_manager.using(alias)
        .filter(organization__isnull=False, organization__is_deleted=False)
        .values_list("pk", "organization_id", "organization__tenant_id")
    }
    rows = (
        Soul._base_manager.using(alias)
        .filter(owner_org__isnull=True, tenant__isnull=False)
        .only("pk", "tenant_id", "create_user_id", "owner_org_id")
        .order_by("pk")
    )
    batch, total = [], 0
    for soul in rows.iterator(chunk_size=BATCH):
        org, org_tenant = user_org.get(soul.create_user_id, (None, None))
        soul.owner_org_id = org if org is not None and org_tenant == soul.tenant_id else roots.get(soul.tenant_id)
        if soul.owner_org_id is None:
            continue
        batch.append(soul)
        if len(batch) >= BATCH:
            Soul._base_manager.using(alias).bulk_update(batch, ["owner_org"], batch_size=BATCH)
            total += len(batch)
            batch = []
    if batch:
        Soul._base_manager.using(alias).bulk_update(batch, ["owner_org"], batch_size=BATCH)
        total += len(batch)
    if total:
        print(f"\n  souls/0055: 回填 owner_org {total} 行", end="")


class Migration(migrations.Migration):
    dependencies = [
        ("souls", "0054_soul_owner_org"),
        ("authentication", "0028_officer_organization_defaults_to_hall_root"),
    ]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
