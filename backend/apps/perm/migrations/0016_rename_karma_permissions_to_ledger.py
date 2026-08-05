"""
Data migration: karma.read → ledger.read, karma.manage → ledger.manage，
并把 category 从 "karma" 改成 "ledger"。

背景：
- apps.karma 已改名 apps.ledger，API 也搬到 /api/v1/ledger/，但权限 codename
  留在了 karma.*。codename 是**存在数据库里的值**，不是代码标识符，所以改名
  必须走数据迁移，而不是全局替换字符串。

为什么是 UPDATE 而不是先删后建：
- RolePermission 通过外键指向 Permission 的主键。把行**改名**，主键不变，
  指向它的授权原封不动。删掉再新建会换一个主键，所有 RolePermission 随
  on_delete=CASCADE 一起消失 —— 那等于静默收回权限，正是这次要避免的事。

target 已存在时的处理（正常流程不会发生，反复 forward/backward 可能）：
- 若 ledger.read 已存在而 karma.read 也还在，无法直接改名（codename 唯一）。
  这时把指向 karma.read 的 RolePermission 逐条迁到 ledger.read 上
  （get_or_create，避开 (role, permission) 唯一约束），再硬删掉 karma.read
  这行。授权数量不减，这是唯一要守住的不变量。

可逆性：
- backward 做完全对称的反向改名。硬删除而非软删除，保证反复 forward /
  backward 不会撞 codename 的唯一约束。

对现有鉴权的影响：
- apps/perm/checker.py 的 DB 分支实际上永远不生效（它用
  RolePermission.objects.filter(role=<角色名字符串>) 查一个指向 Role 主键的
  外键，必然抛 ValueError，被 except 吞掉后回退到 ROLE_PERMISSIONS 字典），
  所以本迁移改不动 REST 侧的判定；字典已在 models.py 同步改名。
- 真正读这些行的是 UserWithTenantSerializer.get_permissions（登录响应里的
  permissions 列表）和 WebSocket 的 rbac_role.get_inherited_permissions()。
  两边都只是把 codename 原样传出去，前端没有任何组件以 karma.read /
  karma.manage 为条件，events 也没有用它们做 _permission 门禁，所以改名后
  没有消费者会因为找不到旧串而失去访问。
"""
from django.db import migrations

# (旧 codename, 新 codename, 新 name, 新 category)
RENAMES = [
    ("karma.read", "ledger.read", "查看功德", "ledger"),
    ("karma.manage", "ledger.manage", "管理功德", "ledger"),
]


def _invalidate_cache():
    """迁移期间自动失效钩子被短路（见 0013 的说明），这里手动兜底。

    PermissionCache 的键是 (role, codename)，改名后旧键成了没人问的孤儿，
    但新键此前可能被 checker 以 False 缓存过（旧名下不存在的 codename），
    所以整体清一次比按角色清更稳妥。
    """
    try:
        from apps.perm.cache import invalidate_all_permissions
        invalidate_all_permissions()
    except Exception:
        # 缓存不可用（如测试库没有 Redis）不应阻塞迁移本身。
        pass


def _rename(permission_model, role_permission_model, pairs):
    Permission, RolePermission = permission_model, role_permission_model
    for old_codename, new_codename, new_name, new_category in pairs:
        source = Permission.all_objects.filter(codename=old_codename).first()
        if source is None:
            continue

        target = Permission.all_objects.filter(codename=new_codename).first()
        if target is None:
            # 常规路径：原地改名，主键不变 → RolePermission 全部保留。
            source.codename = new_codename
            source.name = new_name
            source.category = new_category
            source.save(update_fields=["codename", "name", "category"])
            continue

        # 两个 codename 同时存在：把授权搬到 target 再删掉 source。
        for rp in RolePermission.all_objects.filter(permission=source):
            RolePermission.all_objects.get_or_create(
                role_id=rp.role_id,
                permission=target,
                defaults={
                    "conditions": rp.conditions,
                    "data_scope_id": rp.data_scope_id,
                    "is_deleted": rp.is_deleted,
                },
            )
        RolePermission.all_objects.filter(permission=source).delete()
        Permission.all_objects.filter(pk=source.pk).delete()


def forward(apps, schema_editor):
    Permission = apps.get_model("perm", "Permission")
    RolePermission = apps.get_model("perm", "RolePermission")
    _rename(Permission, RolePermission, RENAMES)
    _invalidate_cache()


def backward(apps, schema_editor):
    Permission = apps.get_model("perm", "Permission")
    RolePermission = apps.get_model("perm", "RolePermission")
    reverse_pairs = [
        (new_codename, old_codename, old_name, "karma")
        for old_codename, new_codename, old_name, _ in RENAMES
    ]
    _rename(Permission, RolePermission, reverse_pairs)
    _invalidate_cache()


class Migration(migrations.Migration):

    dependencies = [
        ("perm", "0015_moderator_realm_lead_and_escalate"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
