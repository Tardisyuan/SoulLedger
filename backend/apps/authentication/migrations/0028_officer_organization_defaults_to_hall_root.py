"""有殿的非管理员必须有机构且同殿:机构为空或在别殿的 → 本殿根机构(数据范围 B1,根由 org/0010 建)。

管理员(ADMIN)与灵魂账号(SOUL)不动:前者跳过数据范围,后者不是官员(机构删除检查同样不数 SOUL)。
打印改动清单。backward 不还原:原值没有留存;回滚 org/0010 时根被删,这些账号的机构随 `SET_NULL` 变空
—— 对原来为空的账号就是原值,原来挂错殿的账号回到空。
"""
from django.db import migrations


def default_to_root(apps, schema_editor):
    alias = schema_editor.connection.alias
    User = apps.get_model("authentication", "User")
    Organization = apps.get_model("org", "Organization")
    roots = dict(
        Organization.all_objects.using(alias)
        .filter(parent__isnull=True, is_deleted=False, tenant__isnull=False)
        .values_list("tenant_id", "pk")
    )
    officers = (
        User._base_manager.using(alias)
        .filter(tenant__isnull=False).exclude(role__in=("ADMIN", "SOUL"))
        .select_related("organization").order_by("pk")
    )
    changed = []
    for user in officers:
        org = user.organization
        if org is not None and org.tenant_id == user.tenant_id and not org.is_deleted:
            continue
        root = roots.get(user.tenant_id)
        if root is None:
            continue
        changed.append((user.username, user.organization_id, root))
        user.organization_id = root
        user.save(using=alias, update_fields=["organization"])
    for username, before, after in changed:
        print(f"\n  authentication/0028: {username} 机构 {before} → {after}", end="")


class Migration(migrations.Migration):
    dependencies = [
        ("authentication", "0027_signinsession_ip_address"),
        ("org", "0011_one_live_root_per_tenant"),
    ]
    operations = [migrations.RunPython(default_to_root, migrations.RunPython.noop)]
