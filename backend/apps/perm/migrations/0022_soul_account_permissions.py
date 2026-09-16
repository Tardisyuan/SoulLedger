"""Data migration: 播种 `soul_account.read` / `soul_account.manage`,授予 ADMIN 与 MODERATOR。

与 0021 同一写法与同一理由:落了 Permission 行,矩阵才能授予 / 收回;授给 ADMIN
只是让矩阵显示的持有者与实际一致(checker 对 ADMIN 短路)。MODERATOR 的授予与
`ROLE_PERMISSIONS` 一致(apps/perm/test_codename_coverage.py 钉住两者)。

幂等:get_or_create,限定 is_deleted=False。可逆:backward 删掉这两条 Permission。
"""
from django.db import migrations

PERMISSIONS = [
    ("soul_account.read", "查看灵魂账号", "soul_account"),
    ("soul_account.manage", "管理灵魂账号", "soul_account"),
]
GRANTED_TO = ["ADMIN", "MODERATOR"]


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
        ("perm", "0021_scheduler_permissions"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
