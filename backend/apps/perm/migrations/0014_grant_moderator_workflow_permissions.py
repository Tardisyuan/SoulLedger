"""
Data migration: 让 MODERATOR 成为"地域领导"角色。

背景：
- perm.Role 表里一直有 MODERATOR 这一行，但 apps/perm/models.py 的
  ROLE_PERMISSIONS 字典里没有它的条目 —— 也就是说它此前一个权限都没有，
  是个空壳角色。本迁移给它落上第一批权限。
- 产品意图是"每个地域(文明)的领导"。这件事**不需要**按地域建三个角色：
  每个用户恰好属于一个租户（当前 98/98 全部有 tenant），而 apps/core/
  mixins.py 的 TenantQuerySetMixin 会把非 ADMIN 的查询集过滤到
  request.tenant。所以同一个 MODERATOR 角色授给三个文明的领导，各自只看
  得见自己的地界，隔离由租户层免费提供。
- 反过来说，这个角色**绝不能**是 ADMIN。apps/core/permissions.py 里
  role == 'ADMIN' 直接返回未过滤的查询集，跨租户可见。库里现有 19 个
  ADMIN，很可能就是因为它是唯一的高权限角色，需要提权的人只能给 ADMIN，
  于是都顺带拿到了跨文明访问权 —— 与"地域领导"的本意正相反。

授权范围：
- workflow.read / create / update / delete —— 在自己地界内设计与维护流程。
- 刻意不给 workflow.approve / workflow.advance。设计流程和执行流程是两件
  事，这两个动作留给 JUDGE 在具体案子上行使（见 0013 的 ROLE_GRANTS）。
- 另附 soul.read / judgment.read / realms.read / actors.read /
  dashboard.read —— 配流程时需要能看见流程作用的对象，否则只能盲配。全部
  是只读，不含任何写操作。

为什么必须落 RolePermission 而不能只改字典：
- apps/perm/checker.py 的判定是：codename 在 Permission 表里存在时 DB 为唯一
  权威，不存在时才回退 ROLE_PERMISSIONS 字典。workflow.* 六条已由 0013 落
  进 Permission 表，所以对这些 codename 而言字典已经不再生效，必须建
  RolePermission 行。字典里同步加 MODERATOR 是为了让两边一致，并让尚未
  落库的 codename（soul.read 等若干）也能正确回退。

幂等性：
- Permission 按 codename 查（不新建 —— 六条 workflow 权限由 0013 负责创建，
  这里只引用；查不到就跳过，不代它补）。
- RolePermission 按 (role, permission) 取或建，带 is_deleted=False。

可逆性：
- reverse 只删本迁移建立的 RolePermission 行，不动 Permission 本身
  （那是 0013 的职责）。真删除而非软删除，保证反复 forward/backward 不撞
  唯一约束。
"""
from django.db import migrations

ROLE_NAME = "MODERATOR"

GRANTS = [
    "workflow.read",
    "workflow.create",
    "workflow.update",
    "workflow.delete",
    "soul.read",
    "judgment.read",
    "realms.read",
    "actors.read",
    "dashboard.read",
]


def _invalidate_cache():
    """迁移期间自动失效钩子被短路（见 0013 的说明），这里手动兜底。"""
    try:
        from apps.perm.cache import invalidate_role_permissions
        invalidate_role_permissions(ROLE_NAME)
    except Exception:
        # 缓存不可用（如测试库没有 Redis）不应阻塞迁移本身。
        pass


def grant(apps, schema_editor):
    Permission = apps.get_model("perm", "Permission")
    Role = apps.get_model("perm", "Role")
    RolePermission = apps.get_model("perm", "RolePermission")

    role = Role.all_objects.filter(name=ROLE_NAME, is_deleted=False).first()
    if role is None:
        # 角色种子数据缺失是别的迁移的问题，这里不代它补。
        return

    for codename in GRANTS:
        perm = Permission.all_objects.filter(
            codename=codename, is_deleted=False
        ).first()
        if perm is None:
            # 该 codename 尚未落 Permission 表，checker 会回退到
            # ROLE_PERMISSIONS 字典，那边已经同步加了 MODERATOR。
            continue
        RolePermission.all_objects.get_or_create(
            role=role,
            permission=perm,
            is_deleted=False,
            defaults={},
        )

    _invalidate_cache()


def revoke(apps, schema_editor):
    Role = apps.get_model("perm", "Role")
    RolePermission = apps.get_model("perm", "RolePermission")

    role = Role.all_objects.filter(name=ROLE_NAME, is_deleted=False).first()
    if role is not None:
        RolePermission.all_objects.filter(
            role=role, permission__codename__in=GRANTS
        ).delete()

    _invalidate_cache()


class Migration(migrations.Migration):

    dependencies = [
        ("perm", "0013_add_workflow_permissions"),
    ]

    operations = [
        migrations.RunPython(grant, revoke),
    ]
