"""Data migration: 播种 `scheduler.read` / `scheduler.manage` 两条 Permission 行,并授予 ADMIN。

为什么必须落 Permission 表(而不是只写在 DEFAULT_PERMISSIONS 里):
- 简报要求「默认只 ADMIN 持有,可在权限矩阵授予」。矩阵授权就是建 RolePermission 行,
  而 RolePermission 的 FK 指向 Permission —— 没有行就无处可授。
- ADMIN 在 checker 里短路为 True,授予对判定没有影响;授给 ADMIN 是为了让矩阵页面
  显示的持有者与实际一致,与 0017 对已播种 codename 的处理相同。

对其他角色**不授**:落了 Permission 行之后这两条 codename 由数据库作答,JUDGE 等
角色没有 RolePermission 行即被拒 —— 与 ROLE_PERMISSIONS 字典里只有 ADMIN 持有
的声明一致(apps/perm/test_codename_coverage.py 钉住两者同步)。

幂等:全部 get_or_create,限定 is_deleted=False(见 0017 关于软删除同名行的说明)。
可逆:backward 删掉这两条 Permission(RolePermission 级联),不碰 Role 行。
"""
from django.db import migrations

PERMISSIONS = [
    ("scheduler.read", "查看定时任务", "scheduler"),
    ("scheduler.manage", "管理定时任务", "scheduler"),
]
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
        ("perm", "0020_role_and_permission_unique_among_live_rows"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
