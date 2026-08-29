"""
Data migration: 把 MODERATOR 从"流程管理员"扩成"地区主宰"，并新增
workflow.escalate（越级推进）。

背景：
- 0014 定义 MODERATOR 时，手头的问题是"谁能编辑工作流"，所以只给了
  workflow 的增删改查加几条只读，共 9 条 —— 比 JUDGE 的 18 条还少。但产品
  意图是"各文明的最高主管"（地藏之于地府、Osiris 之于杜阿特这类），一个
  地区的主宰不该比自己手下的判官权限还小。本迁移补齐。

授予范围 —— 在自己地界内把事情办完：
- soul 的 read/create/update/die/transition、judgment 的 read/create/execute、
  disposition、reincarnation、karma、cross_judgment，以及 dispatch 全套
  （跟别的地界谈灵魂调度本来就是主宰的活；租户隔离保证他只碰得到涉及自己
  地界的调度）。
- 只读的 audit / notification —— 主宰要看得见自己地界发生了什么。

刻意不给：
- workflow.approve / workflow.advance。十殿这个结构存在的意义就是把裁决分到
  十个人手里；主宰若既能配流程又能在任意一殿批准，一个人就能把灵魂从头推到
  尾，十殿就成了摆设。流程卡住的出口是下面这条新权限，而不是放开审批。
- user.manage。apps/authentication/views.py 的 UserViewSet **没有挂
  TenantQuerySetMixin**，该 codename 等于跨全部租户编辑任意用户，且没有对
  目标角色的约束 —— 地区主宰拿到它就能把自己改成 ADMIN，一步跨出这个角色
  赖以成立的租户隔离。这是提权通道，在用户管理做成租户隔离之前不能给。
- system.settings / menu.manage：平台级配置，不是地界级。
- soul.delete：破坏性，且回收站尚未落地、删除语义未定。

新增 workflow.escalate（越级推进）：
- apps/workflow/views.py 的 ApprovalWorkflowViewSet.escalate 检查这个
  codename。它不是 advance 的别名：必须带 reason，且无论成功与否都会写一条
  AuditLog（resource="workflow.escalate"，changes 里记下被跳过的节点 id、
  名称、court_code 和理由）。代价是留痕，所以能给主宰而不至于架空十殿。
- 只给 MODERATOR 和 ADMIN。JUDGE 不需要 —— 他本来就有 approve/advance。

幂等性：
- Permission 按 codename 取或建（带 is_deleted=False）。
- RolePermission 按 (role, permission) 取或建；codename 尚未落 Permission 表
  的跳过，checker 会回退到 ROLE_PERMISSIONS 字典，那边已同步。

可逆性：
- reverse 删掉本迁移建立的 RolePermission，以及 workflow.escalate 这条
  Permission（0014/0013 建的不动）。真删除而非软删除，保证反复 forward /
  backward 不撞 codename 唯一约束。
"""
from django.db import migrations

ESCALATE = ("workflow.escalate", "越级推进工作流", "workflow")

# 0014 已经授过的四条 workflow 权限不在这里重复，get_or_create 会跳过。
MODERATOR_GRANTS = [
    "workflow.escalate",
    "soul.create", "soul.update", "soul.die", "soul.transition",
    "judgment.create", "judgment.execute",
    "disposition.read", "disposition.execute",
    "reincarnation.read", "reincarnation.manage",
    "reincarnation.reborn", "reincarnation.complete",
    "karma.read", "karma.manage",
    "dispatch.read", "dispatch.manage",
    "dispatch.approve", "dispatch.reject", "dispatch.execute",
    "cross_judgment.read", "cross_judgment.create",
    "audit.read", "notification.read",
]

ADMIN_GRANTS = ["workflow.escalate"]


def _invalidate_cache():
    """迁移期间自动失效钩子被短路（见 0013 的说明），这里手动兜底。

    Wrapped in `transaction.atomic()`, which opens a SAVEPOINT inside the
    migration's transaction. Without it a bare `except Exception: pass` does
    not contain the failure on PostgreSQL: the failed statement puts the whole
    transaction into an aborted state, and every statement after it raises
    InFailedSqlTransaction -- including Django's own INSERT into
    django_migrations. The migration's data is written, then the *recording*
    step rolls the lot back, and the error says "current transaction is
    aborted" while pointing somewhere unrelated to the actual fault.

    Measured 2026-08-29: `manage.py migrate` against an empty PostgreSQL 16
    database fails here, so no fresh deployment of this project could ever
    have worked. 192.168.2.115 was migrated incrementally and has never done a
    from-scratch run, which is why nothing noticed.

    SQLite does not abort the transaction on a failed statement, so the whole
    suite is blind to this. `perm/0017` carries the same fix and the long-form
    version of this explanation; these three were left behind when it was made.
    """
    from django.db import transaction

    try:
        with transaction.atomic():
            from apps.perm.cache import invalidate_role_permissions
            for role_name in ("MODERATOR", "ADMIN"):
                invalidate_role_permissions(role_name)
    except Exception:
        # 缓存不可用（如测试库没有 Redis）不应阻塞迁移本身。
        pass


def _grant(permission_model, role_model, role_permission_model, role_name, codenames):
    Permission, Role, RolePermission = (
        permission_model,
        role_model,
        role_permission_model,
    )
    role = Role.all_objects.filter(name=role_name, is_deleted=False).first()
    if role is None:
        # 角色种子数据缺失是别的迁移的问题，这里不代它补。
        return
    for codename in codenames:
        perm = Permission.all_objects.filter(
            codename=codename, is_deleted=False
        ).first()
        if perm is None:
            # 尚未落 Permission 表，checker 会回退到 ROLE_PERMISSIONS 字典。
            continue
        RolePermission.all_objects.get_or_create(
            role=role, permission=perm, is_deleted=False, defaults={}
        )


def forward(apps, schema_editor):
    Permission = apps.get_model("perm", "Permission")
    Role = apps.get_model("perm", "Role")
    RolePermission = apps.get_model("perm", "RolePermission")

    codename, name, category = ESCALATE
    Permission.all_objects.get_or_create(
        codename=codename,
        is_deleted=False,
        defaults={"name": name, "category": category},
    )

    _grant(Permission, Role, RolePermission, "MODERATOR", MODERATOR_GRANTS)
    _grant(Permission, Role, RolePermission, "ADMIN", ADMIN_GRANTS)
    _invalidate_cache()


def backward(apps, schema_editor):
    Permission = apps.get_model("perm", "Permission")
    Role = apps.get_model("perm", "Role")
    RolePermission = apps.get_model("perm", "RolePermission")

    moderator = Role.all_objects.filter(name="MODERATOR", is_deleted=False).first()
    if moderator is not None:
        RolePermission.all_objects.filter(
            role=moderator, permission__codename__in=MODERATOR_GRANTS
        ).delete()

    admin = Role.all_objects.filter(name="ADMIN", is_deleted=False).first()
    if admin is not None:
        RolePermission.all_objects.filter(
            role=admin, permission__codename__in=ADMIN_GRANTS
        ).delete()

    # workflow.escalate 是本迁移引入的，回滚时一并撤掉。
    Permission.all_objects.filter(codename=ESCALATE[0]).delete()
    _invalidate_cache()


class Migration(migrations.Migration):

    dependencies = [
        ("perm", "0014_grant_moderator_workflow_permissions"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
