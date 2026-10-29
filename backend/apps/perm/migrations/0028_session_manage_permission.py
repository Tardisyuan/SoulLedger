"""Data migration: 播种 `session.manage`(管理员看在线会话、强退)并授予 ADMIN。写法同 0021。

只授 ADMIN(2026-10-29 用户决定)。落 Permission 行是为了矩阵里看得见、能单独授给别的角色。
幂等:全部 get_or_create,限定 is_deleted=False。可逆:backward 删掉这条 Permission(RolePermission 级联)。
"""
from django.db import migrations

PERMISSIONS = [
    ("session.manage", "管理在线会话", "session"),
]
GRANTED_TO = ["ADMIN"]


def forward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Permission = apps.get_model("perm", "Permission")
    Role = apps.get_model("perm", "Role")
    RolePermission = apps.get_model("perm", "RolePermission")

    for codename, name, category in PERMISSIONS:
        perm, _ = Permission.all_objects.using(alias).get_or_create(
            codename=codename, is_deleted=False, defaults={"name": name, "category": category}
        )
        for role_name in GRANTED_TO:
            role = Role.all_objects.using(alias).filter(name=role_name, is_deleted=False).first()
            if role is None:
                continue
            RolePermission.all_objects.using(alias).get_or_create(role=role, permission=perm, is_deleted=False)


def backward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Permission = apps.get_model("perm", "Permission")
    Permission.all_objects.using(alias).filter(codename__in=[c for c, _, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("perm", "0027_souls_mfa_reset_permission"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
