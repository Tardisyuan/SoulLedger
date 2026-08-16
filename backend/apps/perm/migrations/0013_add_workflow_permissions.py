"""
Data migration: 补上缺失的 workflow.* 权限。

背景：
- apps/workflow/views.py 里 WorkflowTemplateViewSet / ApprovalWorkflowViewSet
  都设置了 permission_codename = "workflow"，CodenameViewSetMixin
  （apps/core/viewsets.py 的 ACTION_PERM_MAP）据此把标准 CRUD 动作映射成
  workflow.read / workflow.create / workflow.update / workflow.delete；
  ApprovalWorkflowViewSet 的 extra_permissions 又显式声明了
  workflow.advance、workflow.approve 两个自定义动作。全库没有任何地方
  检查过 "workflow.manage" 这种归并式 codename —— workflow 走的是标准六
  件套，不是 dispatch.manage 那种二分模式。
- 但 Permission 表里从来没有 workflow 这一族（现有 22 条、14 个 category，
  参见 apps/perm/models.py 的 DEFAULT_PERMISSIONS），导致权限管理界面上
  看不到、也没法单独给任何角色授予或收回这六个 codename。
- apps/perm/models.py 的 ROLE_PERMISSIONS 字典里其实已经写好了这六条对
  ADMIN / JUDGE 的分配（ADMIN 全六条，JUDGE 有 read/approve/advance）。
  apps/perm/checker.py 的判定逻辑是：codename 在 Permission 表里不存在
  时才 fallback 到这个字典 —— 也就是说 JUDGE 现在就已经能通过
  workflow.read/approve/advance 的检查，不是只有 ADMIN 靠角色豁免侥幸能
  用。本迁移只是把字典里已经生效的规则落到 DB 里，让它在权限管理界面
  上可见、可编辑；两边的 RolePermission 内容和字典逐条对齐，不新增、
  不削减任何角色的实际权限，落库前后行为一致。
- checker.py 有按 (role, codename) 缓存的权限判定结果（apps/perm/cache.py）。
  自动失效钩子挂在 apps/audit/signals.py 的 _invalidate_permission_cache
  上，但它在迁移期间会被 _is_migration_context() 短路跳过。这里手动调用
  invalidate_role_permissions() 兜底 —— 虽然本迁移严格复刻字典现状，
  理论上不会有缓存值和迁移后 DB 判定结果不一致的情况，但显式失效更稳妥，
  也不依赖"这次刚好没变"这个前提。

幂等性：
- Permission 按 codename 取或建（codename 全局唯一，取的时候带 is_deleted=False，
  避免误判软删除的同名记录为"已存在"）。
- RolePermission 按 (role, permission) 取或建，同样带 is_deleted=False。

可逆性：
- reverse 对本迁移新建的 RolePermission / Permission 做真删除（queryset.delete()
  是裸 SQL DELETE，不会走 SoftDeleteMixin 覆写的实例级 delete()），保证
  forward → backward → forward 反复跑不会撞 codename 唯一约束。
- 「本迁移新建的」是字面意思，不是「这六个 codename 沾边的一切」——
  见 remove_workflow_permissions() 的说明，以及为什么删 Permission 那一步的
  级联才是真正的破坏来源。
"""
from django.db import migrations

WORKFLOW_PERMISSIONS = [
    ("workflow.read", "查看工作流", "workflow"),
    ("workflow.create", "创建工作流", "workflow"),
    ("workflow.update", "编辑工作流", "workflow"),
    ("workflow.delete", "删除工作流", "workflow"),
    ("workflow.approve", "审批工作流", "workflow"),
    ("workflow.advance", "推进工作流", "workflow"),
]

# 严格照抄 apps/perm/models.py::ROLE_PERMISSIONS 里已经生效的 workflow.* 分配，
# 不新增、不删减任何角色的实际权限。
ROLE_GRANTS = {
    "ADMIN": [
        "workflow.read", "workflow.create", "workflow.update",
        "workflow.delete", "workflow.approve", "workflow.advance",
    ],
    "JUDGE": ["workflow.read", "workflow.approve", "workflow.advance"],
}


def _invalidate_cache(role_names):
    """迁移期间自动失效钩子被短路，这里手动兜底失效缓存。"""
    try:
        from apps.perm.cache import invalidate_role_permissions
        for role_name in role_names:
            invalidate_role_permissions(role_name)
    except Exception:
        # 缓存不可用（如测试库没有 Redis）不应阻塞迁移本身。
        pass


def create_workflow_permissions(apps, schema_editor):
    Permission = apps.get_model("perm", "Permission")
    Role = apps.get_model("perm", "Role")
    RolePermission = apps.get_model("perm", "RolePermission")

    perms = {}
    for codename, name, category in WORKFLOW_PERMISSIONS:
        perm, _ = Permission.all_objects.get_or_create(
            codename=codename,
            is_deleted=False,
            defaults={"name": name, "category": category},
        )
        perms[codename] = perm

    for role_name, codenames in ROLE_GRANTS.items():
        role = Role.all_objects.filter(name=role_name, is_deleted=False).first()
        if role is None:
            # 角色种子数据缺失是别的迁移的问题，这里不代它补，跳过即可。
            continue
        for codename in codenames:
            RolePermission.all_objects.get_or_create(
                role=role,
                permission=perms[codename],
                is_deleted=False,
                defaults={},
            )

    _invalidate_cache(ROLE_GRANTS.keys())


def remove_workflow_permissions(apps, schema_editor):
    """只撤本迁移授出的那些行。

    原来的写法是「按 codename 一刀切」：先删掉引用这六个 codename 的**全部**
    RolePermission，再删掉这六条 Permission。两步都比 forward 写的多。

    - forward 只给 ADMIN 和 JUDGE 授权（见 ROLE_GRANTS）。按 codename 删会连
      带删掉别人授的 —— 在权限管理界面上手动给 GUARDIAN 加的 workflow.approve
      就是典型例子，没有任何迁移会授它，所以它只可能是人授的。
    - 更要命的是第二步。Permission 被删时 RolePermission.permission 是
      CASCADE，于是**即使第一步一行没删，级联也会把所有引用它的授权一起带走**。
      也就是说旧版 reverse 撤销一个「什么都没建」的 forward（codename 早就存在、
      get_or_create 只是取到）时，照样能把整张授权表上这六个 codename 清空。

    所以这里改成：
    1. 只删 (ADMIN|JUDGE) × 该角色被授的 codename，即 forward 的写入集合；
    2. Permission 只删「删完第一步后已经没有任何 RolePermission 引用」的那几条
       —— 还有人引用就说明它不是本迁移独占的，留着。留着也不影响幂等：forward
       是 get_or_create，再跑一遍会取到而不是重建。

    残留风险（不改 forward 就消不掉）：本迁移之前就存在、且没有任何授权指向它的
    Permission 行，与 forward 刚建的那条长得一模一样，会被一并删除。forward 没
    有记录自己建了哪几条，而给它加标记等于改写一条已经在生产库上 apply 过的迁移。

    真删除而非软删除，仍然是为了保证反复 forward/backward 不撞 codename 唯一约束。
    """
    Permission = apps.get_model("perm", "Permission")
    Role = apps.get_model("perm", "Role")
    RolePermission = apps.get_model("perm", "RolePermission")

    codenames = [codename for codename, _, _ in WORKFLOW_PERMISSIONS]

    for role_name, granted in ROLE_GRANTS.items():
        role = Role.all_objects.filter(name=role_name, is_deleted=False).first()
        if role is None:
            # forward 在同样的分支上什么都没授，这里也就没有什么可撤。
            continue
        RolePermission.all_objects.filter(
            role=role, permission__codename__in=granted, is_deleted=False
        ).delete()

    # 只删已经没人引用的 Permission。软删除的授权也算引用 —— 它仍是一行外键，
    # 硬删 Permission 一样会级联把它带走。
    orphaned = [
        permission.pk
        for permission in Permission.all_objects.filter(
            codename__in=codenames, is_deleted=False
        )
        if not RolePermission.all_objects.filter(permission=permission).exists()
    ]
    Permission.all_objects.filter(pk__in=orphaned).delete()

    _invalidate_cache(ROLE_GRANTS.keys())


class Migration(migrations.Migration):

    dependencies = [
        ("perm", "0012_alter_datascope_managers_alter_permission_managers_and_more"),
    ]

    operations = [
        migrations.RunPython(create_workflow_permissions, remove_workflow_permissions),
    ]
