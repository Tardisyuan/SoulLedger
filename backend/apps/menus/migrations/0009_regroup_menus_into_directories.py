"""
Data migration: 把平铺的一级菜单收成 6 组 DIRECTORY，并收编 5 个孤儿页面。

背景（信息架构评审结论）：
- 侧边栏 17 项全部平铺，在 1440x900 下末项被裁出视口。
- Menu 模型早已支持 MenuType.DIRECTORY（纯导航分组），前端 AppLayout
  也已实现子菜单折叠渲染，只是种子数据从未使用分组能力。
- /tenants、/organizations、/admin/stats、/disposition、/death-sync
  五个页面没有任何菜单入口，只能手输 URL。

本迁移只改动 parent / order / name / visible 四个字段，
不触碰既有菜单的 roles、icon、permission、component，
以免破坏现有权限配置。

幂等性：
- 目录按 (name, menu_type=DIRECTORY) 取或建。
- 新增叶子菜单按 path 取或建。
- 重命名只在旧名仍然存在时执行。
- 所有查询都限定 is_deleted=False —— 库中存在软删除的同 path 记录
  （例如 id=19 "Souls" /souls），不加这个条件会误伤。
"""
from django.db import migrations

# ---------------------------------------------------------------------------
# 6 个一级分组（DIRECTORY，无 path）
# roles 取各自子项 roles 的并集，保证按角色过滤时不会把整组藏掉。
# ---------------------------------------------------------------------------
DIRECTORIES = [
    {
        "name": "概览",
        "icon": "LayoutDashboard",
        "order": 10,
        "roles": ["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"],
    },
    {
        "name": "灵魂业务",
        "icon": "Ghost",
        "order": 20,
        "roles": ["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"],
    },
    {
        "name": "流程协作",
        "icon": "ArrowRightLeft",
        "order": 30,
        "roles": ["ADMIN", "JUDGE", "GUARDIAN"],
    },
    {
        "name": "组织与领域",
        "icon": "Globe",
        "order": 40,
        "roles": ["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"],
    },
    {
        "name": "社交",
        "icon": "MessageSquare",
        "order": 50,
        "roles": [],
    },
    {
        "name": "系统设置",
        "icon": "Settings",
        "order": 60,
        "roles": ["ADMIN"],
    },
]

# ---------------------------------------------------------------------------
# 新增的 5 个叶子菜单（收编孤儿页面）
# permission 留空，与既有 18 条保持一致（该字段目前无处强制，靠 roles 控制）。
# ---------------------------------------------------------------------------
NEW_MENUS = [
    {
        "path": "/admin/stats",
        "name": "业力统计",
        "icon": "BarChart",
        "group": "概览",
        "order": 20,
        "roles": ["ADMIN"],
        "component": "admin/stats",
    },
    {
        "path": "/disposition",
        "name": "轮回处置",
        "icon": "RefreshCw",
        "group": "灵魂业务",
        "order": 50,
        "roles": ["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"],
        "component": "disposition",
    },
    {
        "path": "/death-sync",
        "name": "死亡同步",
        "icon": "Skull",
        "group": "流程协作",
        "order": 30,
        "roles": ["ADMIN", "JUDGE", "GUARDIAN"],
        "component": "death-sync",
    },
    {
        "path": "/tenants",
        "name": "租户管理",
        "icon": "Building2",
        "group": "系统设置",
        "order": 50,
        "roles": ["ADMIN"],
        "component": "tenants",
    },
    {
        "path": "/organizations",
        "name": "组织架构",
        "icon": "Building",
        "group": "系统设置",
        "order": 60,
        "roles": ["ADMIN"],
        "component": "organizations",
    },
]

# ---------------------------------------------------------------------------
# 既有菜单归位： path -> (分组名, 组内顺序)
# 在全新的测试库里这些 path 并不存在，update() 会安静地命中 0 行。
# ---------------------------------------------------------------------------
ASSIGNMENTS = {
    "/dashboard": ("概览", 10),
    "/souls": ("灵魂业务", 10),
    "/judgment": ("灵魂业务", 20),
    "/cross-judgments": ("灵魂业务", 30),
    "/karma": ("灵魂业务", 40),
    "/workflow": ("流程协作", 10),
    "/dispatch": ("流程协作", 20),
    "/realms": ("组织与领域", 10),
    "/actors": ("组织与领域", 20),
    "/social": ("社交", 10),
    "/social/follows": ("社交", 20),
    "/users": ("系统设置", 10),
    "/permissions": ("系统设置", 20),
    "/menus": ("系统设置", 30),
    "/audit": ("系统设置", 40),
}

# 重命名： path -> (旧名, 新名)
# /actors 让出"角色"一词给 RBAC —— 该页实际是神话人物实体（阎罗王 / Anubis / Lucifer）。
RENAMES = {
    "/actors": ("角色管理", "神祇名录"),
    "/permissions": ("权限管理", "权限与角色"),
    "/social": ("Social", "动态"),
    "/social/follows": ("Follows", "关注"),
}

# 移出侧边栏（保留路由与权限，仅 visible=False）
# 欢迎页 -> 与 / 和 /dashboard 职责重叠；个人资料 / 通知中心 -> 顶栏已有入口。
HIDDEN_FROM_SIDEBAR = ["/welcome", "/profile", "/notifications"]

# 回滚用：迁移前的一级顺序
ORIGINAL_ORDERS = {
    "/welcome": 1,
    "/workflow": 5,
    "/souls": 10,
    "/social/follows": 10,
    "/judgment": 11,
    "/realms": 12,
    "/actors": 13,
    "/dispatch": 14,
    "/cross-judgments": 15,
    "/karma": 16,
    "/users": 17,
    "/profile": 18,
    "/menus": 20,
    "/dashboard": 20,
    "/notifications": 20,
    "/audit": 20,
    "/permissions": 21,
    "/social": 50,
}


def _live(Menu):
    """未被软删除的菜单。"""
    return Menu.all_objects.filter(is_deleted=False)


def regroup(apps, schema_editor):
    Menu = apps.get_model("menus", "Menu")

    # 1. 建立 6 个分组目录
    dirs = {}
    for spec in DIRECTORIES:
        obj, _ = Menu.all_objects.get_or_create(
            name=spec["name"],
            menu_type="DIRECTORY",
            is_deleted=False,
            defaults={
                "path": "",
                "icon": spec["icon"],
                "order": spec["order"],
                "roles": spec["roles"],
                "parent": None,
                "is_active": True,
                "visible": True,
                "component": "",
            },
        )
        dirs[spec["name"]] = obj

    # 2. 重命名（只在旧名还在时动手，重复执行安全）
    for path, (old, new) in RENAMES.items():
        _live(Menu).filter(path=path, name=old).update(name=new)

    # 3. 收编 5 个孤儿页面
    for spec in NEW_MENUS:
        Menu.all_objects.get_or_create(
            path=spec["path"],
            is_deleted=False,
            defaults={
                "name": spec["name"],
                "icon": spec["icon"],
                "order": spec["order"],
                "roles": spec["roles"],
                "parent": dirs[spec["group"]],
                "menu_type": "MENU",
                "permission": "",
                "is_active": True,
                "visible": True,
                "component": spec["component"],
            },
        )

    # 4. 既有菜单归位到对应分组
    for path, (group, order) in ASSIGNMENTS.items():
        _live(Menu).filter(path=path).exclude(menu_type="DIRECTORY").update(
            parent=dirs[group], order=order
        )

    # 5. 新增叶子也确保 parent/order 正确（应对"上次跑了一半"的情况）
    for spec in NEW_MENUS:
        _live(Menu).filter(path=spec["path"]).exclude(menu_type="DIRECTORY").update(
            parent=dirs[spec["group"]], order=spec["order"]
        )

    # 6. 三项移出侧边栏（保留路由本身）
    _live(Menu).filter(path__in=HIDDEN_FROM_SIDEBAR).update(visible=False, parent=None)


def restore_flat(apps, schema_editor):
    Menu = apps.get_model("menus", "Menu")

    # 1. 恢复三项可见
    _live(Menu).filter(path__in=HIDDEN_FROM_SIDEBAR).update(visible=True)

    # 2. 删除本迁移新建的 5 个叶子菜单
    _live(Menu).filter(path__in=[s["path"] for s in NEW_MENUS]).exclude(
        menu_type="DIRECTORY"
    ).delete()

    # 3. 既有菜单拍回一级，顺序还原
    for path, (_group, _order) in ASSIGNMENTS.items():
        _live(Menu).filter(path=path).exclude(menu_type="DIRECTORY").update(
            parent=None, order=ORIGINAL_ORDERS.get(path, 0)
        )

    # /social/follows 原本挂在 /social 之下，单独还原这一层父子关系
    social = _live(Menu).filter(path="/social").exclude(menu_type="DIRECTORY").first()
    if social is not None:
        _live(Menu).filter(path="/social/follows").exclude(
            menu_type="DIRECTORY"
        ).update(parent=social, order=ORIGINAL_ORDERS["/social/follows"])

    # 4. 撤销重命名
    for path, (old, new) in RENAMES.items():
        _live(Menu).filter(path=path, name=new).update(name=old)

    # 5. 删除 6 个分组目录
    #    先把仍然挂在目录下的"漏网"菜单（例如管理员后来手工新增的）拍回一级，
    #    否则 parent 的 CASCADE 会把它们一并删掉。
    dir_ids = list(
        _live(Menu)
        .filter(menu_type="DIRECTORY", name__in=[d["name"] for d in DIRECTORIES])
        .values_list("id", flat=True)
    )
    Menu.all_objects.filter(parent_id__in=dir_ids).update(parent=None)
    _live(Menu).filter(id__in=dir_ids).delete()

    # 其余未在 ORIGINAL_ORDERS 中登记的项保持原样
    for path in HIDDEN_FROM_SIDEBAR:
        _live(Menu).filter(path=path).update(order=ORIGINAL_ORDERS.get(path, 0))


class Migration(migrations.Migration):

    dependencies = [
        ("menus", "0008_alter_menu_managers_alter_menubutton_managers"),
    ]

    operations = [
        migrations.RunPython(regroup, restore_flat),
    ]
