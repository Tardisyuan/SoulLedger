"""
Data migration: 把角色、权限、授权三者一次性播成一致状态。

背景 —— 为什么必须是"一起播"：
- `DEFAULT_ROLES` 里一直没有 MODERATOR（只有 ADMIN/JUDGE/GUARDIAN/VIEWER），
  而 `ROLE_PERMISSIONS` 有五个键。任何只跑过 `migrate` 的库因此根本没有
  MODERATOR 的 Role 行；更要命的是它连别的角色行也没有——Role 行是
  apps/perm/views.py 的初始化接口建的，没有任何迁移负责。
- 于是 0013/0014/0015 会无条件建出 workflow.* 等 Permission 行，却在
  `_grant()` 的 "role is None" 分支上把每一条授权整段跳过。结果是
  **已播种但未授权**：Permission 表里有行，RolePermission 表里没有。
- 在 checker 修好之前这没有后果，因为那时候查询抛异常、被吞掉、回退到
  ROLE_PERMISSIONS 字典，数据库内容根本不参与。修好之后数据库对已播种的
  codename 具有权威性，于是"已播种但未授权"= 拒绝：在 migrate-only 的库上
  MODERATOR 33→28、JUDGE 18→15，而整套测试对此毫无反应。

所以本迁移做三件事，缺一件都会重新制造上面那个状态：
  1. 按 DEFAULT_ROLES 建齐五个 Role 行（含此前缺失的 MODERATOR）；
  2. 建出 menu.read 这条新 codename；
  3. 把**已经存在 Permission 行的** codename 按 ROLE_PERMISSIONS 逐条授权。

刻意不做的一件事 —— 不把 DEFAULT_PERMISSIONS 整份播进 Permission 表：
- 已播种的 codename 由数据库作答，未播种的回退到 ROLE_PERMISSIONS 字典。把
  四十条全播了，等于把字典这一刻的内容永久冻进数据库，此后再改
  ROLE_PERMISSIONS 将不再生效——那是一次语义变更，不是一次缺陷修复，不该
  夹带在这里。
- 本迁移只让"已经躺在 Permission 表里却没人被授权"的那批恢复正常：
  migrate-only 的库里正好是 0013/0015 建的七条 workflow.*，加上本迁移新增的
  menu.read。其余 codename 的解析路径与今天完全一致。
效果是任何角色的**有效权限集都不减少**——审计 §4b 要求的正是这一点。

新增 menu.read：
- 此前唯一的菜单 codename 是 menu.manage，只有 ADMIN 持有；但
  apps/menus/views.py 的 list/tree/list-public 是给所有登录角色看导航的。
  把它们绑到 menu.manage 会在拦截落地那天让每个非 ADMIN 面对一棵空导航树。
- menu.read 授予全部五个角色，写操作仍归 menu.manage。

顺带补上 notification.read：
- JUDGE / GUARDIAN / VIEWER 此前都没有它，而通知列表本来就按
  `user=request.user` 过滤，给读权限不可能泄露别人的数据，只是让他们看得见
  自己的收件箱。不补的话拦截一开这三个角色的通知中心直接空掉。

矩阵在这里是**冻结的字面量**而非 import：迁移一旦提交就必须永远重放出同一个
结果，而 models.py 里的常量会继续演进。

幂等性：
- Role / Permission / RolePermission 全部 get_or_create，可反复 forward。

可逆性 —— 刻意不对称，理由如下：
- backward 只删 menu.read 这条本迁移引入的 Permission（及其级联授权）。
- **不删 Role 行**：删角色会级联清掉 RolePermission，连带毁掉早于本迁移就
  存在的授权，而 Role 行是否为本迁移所建无从分辨。
- **不删其余授权**：本迁移落下的授权正是 ROLE_PERMISSIONS 一直在承诺的那些，
  撤掉它们等于亲手重建本迁移要消除的"库与字典分叉"。回滚这次部署时字典仍
  在原处，让数据库继续与之一致才是安全的方向。
"""
from django.db import migrations

# —— 以下数据为本迁移的冻结快照，请勿改为 import ——

ROLES = [
    ("ADMIN", "Administrator"),
    ("MODERATOR", "Realm Lead"),
    ("JUDGE", "Judge"),
    ("GUARDIAN", "Guardian"),
    ("VIEWER", "Viewer"),
]

# 本迁移引入的新 codename，backward 负责撤掉它。
MENU_READ = ("menu.read", "查看菜单", "system")

GRANTS = {
    "ADMIN": [
        "soul.read", "soul.create", "soul.update", "soul.delete", "soul.die", "soul.transition",
        "judgment.read", "judgment.create", "judgment.execute",
        "ledger.read", "ledger.manage",
        "reincarnation.read", "reincarnation.manage", "reincarnation.complete", "reincarnation.reborn",
        "disposition.read", "disposition.execute",
        "dashboard.read", "audit.read", "notification.read",
        "dispatch.read", "dispatch.manage", "dispatch.approve", "dispatch.reject", "dispatch.execute",
        "cross_judgment.read", "cross_judgment.create",
        "realms.read", "actors.read",
        "system.settings", "user.manage", "menu.read", "menu.manage",
        "workflow.read", "workflow.create", "workflow.update", "workflow.delete",
        "workflow.approve", "workflow.advance",
    ],
    "MODERATOR": [
        "workflow.read", "workflow.create", "workflow.update", "workflow.delete",
        "workflow.escalate",
        "soul.read", "soul.create", "soul.update", "soul.die", "soul.transition",
        "judgment.read", "judgment.create", "judgment.execute",
        "disposition.read", "disposition.execute",
        "reincarnation.read", "reincarnation.manage",
        "reincarnation.reborn", "reincarnation.complete",
        "ledger.read", "ledger.manage",
        "dispatch.read", "dispatch.manage",
        "dispatch.approve", "dispatch.reject", "dispatch.execute",
        "cross_judgment.read", "cross_judgment.create",
        "realms.read", "actors.read", "dashboard.read",
        "audit.read", "notification.read", "menu.read",
    ],
    "JUDGE": [
        "soul.read", "soul.die", "soul.transition",
        "judgment.read", "judgment.create", "judgment.execute",
        "reincarnation.read", "reincarnation.manage",
        "ledger.read", "dashboard.read",
        "disposition.read",
        "cross_judgment.read", "cross_judgment.create",
        "realms.read", "actors.read",
        "notification.read", "menu.read",
        "workflow.read", "workflow.approve", "workflow.advance",
    ],
    "GUARDIAN": [
        "soul.read", "soul.update", "soul.transition",
        "reincarnation.read", "reincarnation.manage",
        "ledger.read", "dashboard.read",
        "disposition.read",
        "dispatch.read", "dispatch.manage",
        "realms.read", "actors.read",
        "notification.read", "menu.read",
    ],
    "VIEWER": [
        "soul.read", "reincarnation.read",
        "ledger.read", "dashboard.read",
        "realms.read", "actors.read",
        "notification.read", "menu.read",
    ],
}


def _invalidate_cache():
    """迁移期间自动失效钩子被短路（见 0013 的说明），这里手动兜底。"""
    try:
        from apps.perm.cache import invalidate_role_permissions
        for role_name, _ in ROLES:
            invalidate_role_permissions(role_name)
    except Exception:
        # 缓存不可用（如测试库没有 Redis）不应阻塞迁移本身。
        pass


def forward(apps, schema_editor):
    Permission = apps.get_model("perm", "Permission")
    Role = apps.get_model("perm", "Role")
    RolePermission = apps.get_model("perm", "RolePermission")

    for name, display_name in ROLES:
        Role.all_objects.get_or_create(
            name=name,
            is_deleted=False,
            defaults={"display_name": display_name},
        )

    codename, name, category = MENU_READ
    Permission.all_objects.get_or_create(
        codename=codename,
        is_deleted=False,
        defaults={"name": name, "category": category},
    )

    for role_name, codenames in GRANTS.items():
        role = Role.all_objects.filter(name=role_name, is_deleted=False).first()
        if role is None:
            # 上面刚建过，走到这里说明有并发或数据异常，跳过而不是崩掉迁移。
            continue
        for codename in codenames:
            perm = Permission.all_objects.filter(
                codename=codename, is_deleted=False
            ).first()
            if perm is None:
                # 尚未落 Permission 表 —— checker 会回退到 ROLE_PERMISSIONS
                # 字典，那边已同步。刻意不代它建行，理由见模块 docstring。
                continue
            RolePermission.all_objects.get_or_create(
                role=role, permission=perm, is_deleted=False, defaults={}
            )

    _invalidate_cache()


def backward(apps, schema_editor):
    Permission = apps.get_model("perm", "Permission")
    RolePermission = apps.get_model("perm", "RolePermission")

    # 只撤本迁移引入的 codename。Role 行与其余授权刻意保留，理由见模块 docstring。
    RolePermission.all_objects.filter(permission__codename=MENU_READ[0]).delete()
    Permission.all_objects.filter(codename=MENU_READ[0]).delete()
    _invalidate_cache()


class Migration(migrations.Migration):

    dependencies = [
        ("perm", "0016_rename_karma_permissions_to_ledger"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
