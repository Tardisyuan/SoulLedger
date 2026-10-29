"""回填 `Judgment.owner_org`(数据范围 B1):court 匹配本殿机构名前缀 > 创建人的机构(同殿、未删)> 本殿根机构。

规则与 `apps/org/ownership.py::default_owner_org` 一致;冻结在这里,不 import 活代码。tenant 为空保持空。
前缀匹配取 (level, sort, pk) 最前的一个,与活代码同序。
分批:iterator(chunk_size=2000) + bulk_update,不走 save()。backward 由 0049 删列。
"""
from django.db import migrations

BATCH = 2000


def backfill(apps, schema_editor):
    alias = schema_editor.connection.alias
    Judgment = apps.get_model("judgment", "Judgment")
    Organization = apps.get_model("org", "Organization")
    User = apps.get_model("authentication", "User")
    live = Organization.all_objects.using(alias).filter(is_deleted=False, tenant__isnull=False)
    roots = dict(live.filter(parent__isnull=True).values_list("tenant_id", "pk"))
    names = {}
    for tenant_id, pk, name in live.order_by("level", "sort", "pk").values_list("tenant_id", "pk", "name"):
        names.setdefault(tenant_id, []).append((name, pk))
    user_org = {
        pk: (org, org_tenant)
        for pk, org, org_tenant in User._base_manager.using(alias)
        .filter(organization__isnull=False, organization__is_deleted=False)
        .values_list("pk", "organization_id", "organization__tenant_id")
    }
    court_hit = {}

    def by_court(tenant_id, court):
        key = (tenant_id, court)
        if key not in court_hit:
            court_hit[key] = next((pk for name, pk in names.get(tenant_id, []) if name.startswith(court)), None)
        return court_hit[key]

    rows = (
        Judgment._base_manager.using(alias)
        .filter(owner_org__isnull=True, tenant__isnull=False)
        .only("pk", "tenant_id", "create_user_id", "court", "owner_org_id")
        .order_by("pk")
    )
    batch, total = [], 0
    for judgment in rows.iterator(chunk_size=BATCH):
        owner = by_court(judgment.tenant_id, judgment.court) if judgment.court else None
        if owner is None:
            org, org_tenant = user_org.get(judgment.create_user_id, (None, None))
            owner = org if org is not None and org_tenant == judgment.tenant_id else roots.get(judgment.tenant_id)
        if owner is None:
            continue
        judgment.owner_org_id = owner
        batch.append(judgment)
        if len(batch) >= BATCH:
            Judgment._base_manager.using(alias).bulk_update(batch, ["owner_org"], batch_size=BATCH)
            total += len(batch)
            batch = []
    if batch:
        Judgment._base_manager.using(alias).bulk_update(batch, ["owner_org"], batch_size=BATCH)
        total += len(batch)
    if total:
        print(f"\n  judgment/0050: 回填 owner_org {total} 行", end="")


class Migration(migrations.Migration):
    dependencies = [
        ("judgment", "0049_judgment_owner_org"),
        ("authentication", "0028_officer_organization_defaults_to_hall_root"),
    ]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
