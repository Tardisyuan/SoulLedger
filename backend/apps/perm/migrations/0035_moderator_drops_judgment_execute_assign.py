"""Data migration: 朋友圈巡察(MODERATOR)不再持有 `judgment.execute` / `judgment.assign`(用户 2026-11-07)。

`ROLE_PERMISSIONS` 同步去掉了这两项,这里收回已入库的授予:只删 MODERATOR 这个角色名下的两条
RolePermission,别的角色(含自建角色、兼任)不动。码名写死:迁移是冻结的快照。
没有 MODERATOR 角色行或没有这两条 Permission 行的库什么都不做。

可逆:backward 在 Permission 行存在时给 MODERATOR 补回两条授予(get_or_create,限定 is_deleted=False)。
"""
from django.db import migrations

ROLE = "MODERATOR"
CODENAMES = ["judgment.execute", "judgment.assign"]


def forward(apps, schema_editor):
    alias = schema_editor.connection.alias
    RolePermission = apps.get_model("perm", "RolePermission")
    RolePermission.all_objects.using(alias).filter(
        role__name=ROLE, permission__codename__in=CODENAMES
    ).delete()


def backward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Permission = apps.get_model("perm", "Permission")
    Role = apps.get_model("perm", "Role")
    RolePermission = apps.get_model("perm", "RolePermission")
    role = Role.all_objects.using(alias).filter(name=ROLE, is_deleted=False).first()
    if role is None:
        return
    for perm in Permission.all_objects.using(alias).filter(codename__in=CODENAMES, is_deleted=False):
        RolePermission.all_objects.using(alias).get_or_create(role=role, permission=perm, is_deleted=False)


class Migration(migrations.Migration):
    dependencies = [
        ("perm", "0034_workflow_terminate_permission"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
