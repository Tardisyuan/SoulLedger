"""Data migration: 播种 `realms.manage`,只授予 ADMIN。

与 0023 同一写法与同一理由:落了 Permission 行,权限矩阵才能授予 / 收回;授给 ADMIN
只是让矩阵显示的持有者与实际一致(checker 对 ADMIN 短路)。与 `ROLE_PERMISSIONS`
一致(apps/perm/test_codename_coverage.py 钉住两者)。它只管 `PATCH /realms/{id}/`
的 `capacity` 一列(apps/realms/views.py)。

码名写死在这里,不读 `DEFAULT_PERMISSIONS`:迁移是冻结的快照(见 sync_permissions)。

幂等:get_or_create,限定 is_deleted=False。可逆:backward 删掉这一条 Permission。
"""
from django.db import migrations

PERMISSIONS = [("realms.manage", "管理领域容量", "realms")]
GRANTED_TO = ["ADMIN"]


def forward(apps, schema_editor):
    Permission = apps.get_model("perm", "Permission")
    Role = apps.get_model("perm", "Role")
    RolePermission = apps.get_model("perm", "RolePermission")

    for codename, name, category in PERMISSIONS:
        perm, _ = Permission.all_objects.get_or_create(
            codename=codename, is_deleted=False, defaults={"name": name, "category": category}
        )
        for role_name in GRANTED_TO:
            role = Role.all_objects.filter(name=role_name, is_deleted=False).first()
            if role is None:
                continue
            RolePermission.all_objects.get_or_create(role=role, permission=perm, is_deleted=False)


def backward(apps, schema_editor):
    Permission = apps.get_model("perm", "Permission")
    Permission.all_objects.filter(codename__in=[c for c, _, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("perm", "0025_role_description"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
