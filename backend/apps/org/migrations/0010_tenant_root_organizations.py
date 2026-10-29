"""每殿建一个根机构 `ROOT_<殿码>`(名称用殿名),现有顶层挂其下并重算层级(数据范围 B1)。

数据范围的「本殿全部 / 本机构及下级」都按树算,而此前一殿可以有好几棵树(欧洲殿的 HEAVEN 与 HELL
都是顶层)。约束「每殿一个活根」在 0011。tenant 为空的机构不动(没有殿可挂),只打印清单。

层级自上而下重算,与 0009 同一写法(不按父行存着的 level 逐行 save)。
backward:根的子机构放回顶层、硬删根、再重算 —— 根是本迁移建的,没有别人引用它
(owner_org 的回填迁移先于这里回滚;用户机构由 authentication/0028 改成根的,`SET_NULL` 置空)。
"""
from django.db import migrations

# 冻结在这里:数据迁移不跟着模型漂移(org/0004 同一理由)。新建的殿读 `declared_civilization`。
_TENANT_CIVILIZATION = {
    "CN_DIYU": "CHINESE", "EU_HEAVEN_HELL": "EUROPEAN", "EG_DUAT": "EGYPTIAN", "GR_HADES": "GREEK",
}
_CIVILIZATIONS = {"CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"}


def _root_code(tenant):
    return f"ROOT_{tenant.code}"[:50]


def _recompute_levels(org_model, alias):
    rows = list(org_model.all_objects.using(alias).all())
    children = {}
    for org in rows:
        children.setdefault(org.parent_id, []).append(org)
    frontier = [(org, 0) for org in children.get(None, [])]
    while frontier:
        org, depth = frontier.pop()
        if org.level != depth:
            org_model.all_objects.using(alias).filter(pk=org.pk).update(level=depth)
        frontier.extend((child, depth + 1) for child in children.get(org.pk, []))


def create_roots(apps, schema_editor):
    alias = schema_editor.connection.alias
    Organization = apps.get_model("org", "Organization")
    Tenant = apps.get_model("tenants", "Tenant")
    orgs = Organization.all_objects.using(alias)

    for tenant in Tenant.all_objects.using(alias).order_by("pk"):
        code = _root_code(tenant)
        root = orgs.filter(code=code).first()
        tops = list(orgs.filter(tenant=tenant, parent__isnull=True).exclude(code=code).order_by("sort", "pk"))
        if root is None:
            civ = _TENANT_CIVILIZATION.get(tenant.code) or (
                tenant.declared_civilization if tenant.declared_civilization in _CIVILIZATIONS else ""
            ) or (tops[0].category if tops else "")
            root = orgs.create(
                name=(tenant.hall_name or tenant.display_name or tenant.code)[:100],
                code=code, category=civ, tenant=tenant, parent=None, level=0, sort=0,
            )
        elif root.parent_id is not None or root.is_deleted or root.tenant_id != tenant.pk:
            orgs.filter(pk=root.pk).update(parent=None, is_deleted=False, deleted_at=None, tenant=tenant)
        moved = orgs.filter(pk__in=[o.pk for o in tops]).update(parent=root)
        print(f"\n  org/0010: {tenant.code} → {code},挂入 {moved} 个顶层机构", end="")

    orphans = list(orgs.filter(tenant__isnull=True).values_list("code", flat=True).order_by("code"))
    if orphans:
        print(f"\n  org/0010: 无殿机构 {len(orphans)} 个未动:{', '.join(orphans)}", end="")
    _recompute_levels(Organization, alias)


def drop_roots(apps, schema_editor):
    alias = schema_editor.connection.alias
    Organization = apps.get_model("org", "Organization")
    Tenant = apps.get_model("tenants", "Tenant")
    orgs = Organization.all_objects.using(alias)
    codes = [_root_code(t) for t in Tenant.all_objects.using(alias).all()]
    root_ids = list(orgs.filter(code__in=codes, parent__isnull=True).values_list("pk", flat=True))
    orgs.filter(parent_id__in=root_ids).update(parent=None)
    Organization.all_objects.using(alias).filter(pk__in=root_ids).delete()
    _recompute_levels(Organization, alias)


class Migration(migrations.Migration):
    dependencies = [
        ("org", "0009_recompute_organization_levels"),
        ("tenants", "0016_tenant_declared_civilization"),
    ]
    operations = [migrations.RunPython(create_roots, drop_roots)]
