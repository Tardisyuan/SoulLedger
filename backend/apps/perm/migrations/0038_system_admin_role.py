"""Data migration: SYSTEM_ADMIN 角色行 + `system.cross_civilization`(2026-11-15,§7.5)。

SYSTEM_ADMIN = ADMIN 的全部授予(此刻库里 ADMIN 持有的那些 RolePermission,照抄),加一个新码
`system.cross_civilization`。checker 对两者都短路,授予行只是让权限矩阵显示的持有者与实际一致;
那个新码在 `GLOBAL_ONLY_CODENAMES` 里,只有 `is_tenant_exempt`(= SYSTEM_ADMIN)答真,授给谁都没用。
内置角色的保护(不改名、不进回收站、矩阵不收回)跟着 `UserRole.SYSTEM_ADMIN` 与 `ADMIN_ROLE_NAMES` 走。

码名写死:迁移是冻结的快照。幂等:get_or_create,限定 is_deleted=False。
可逆:backward 删 SYSTEM_ADMIN 的授予与这条 Permission,角色行软删(真删会沿 Role 的反向外键级联,
迁移里的历史模型跨 app 对不上;软删的行不占「活行名唯一」约束,再次正向会另建一行)。
"""
from django.db import migrations

from apps.core.migration_ops import placed_here

ROLE, DISPLAY = "SYSTEM_ADMIN", "System Administrator"
PERMISSION = ("system.cross_civilization", "跨文明管理", "system")


def forward(apps, schema_editor):
    if not placed_here(schema_editor, apps, "perm.Permission", "perm.Role", "perm.RolePermission"):
        return
    alias = schema_editor.connection.alias
    Permission = apps.get_model("perm", "Permission")
    Role = apps.get_model("perm", "Role")
    RolePermission = apps.get_model("perm", "RolePermission")

    codename, name, category = PERMISSION
    cross, _ = Permission.all_objects.using(alias).get_or_create(
        codename=codename, is_deleted=False, defaults={"name": name, "category": category}
    )
    role, _ = Role.all_objects.using(alias).get_or_create(name=ROLE, is_deleted=False, defaults={"display_name": DISPLAY})
    admin = Role.all_objects.using(alias).filter(name="ADMIN", is_deleted=False).first()
    granted = [cross]
    if admin is not None:
        granted += [
            rp.permission
            for rp in RolePermission.all_objects.using(alias)
            .filter(role=admin, is_deleted=False, permission__is_deleted=False)
            .select_related("permission")
        ]
    for perm in granted:
        RolePermission.all_objects.using(alias).get_or_create(role=role, permission=perm, is_deleted=False)


def backward(apps, schema_editor):
    if not placed_here(schema_editor, apps, "perm.Permission", "perm.Role", "perm.RolePermission"):
        return
    alias = schema_editor.connection.alias
    Permission = apps.get_model("perm", "Permission")
    Role = apps.get_model("perm", "Role")
    RolePermission = apps.get_model("perm", "RolePermission")
    RolePermission.all_objects.using(alias).filter(role__name=ROLE).delete()
    Role.all_objects.using(alias).filter(name=ROLE, is_deleted=False).update(is_deleted=True)
    Permission.all_objects.using(alias).filter(codename=PERMISSION[0]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("perm", "0037_moderator_display_name"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
