"""Data migration: 最早那 16 条菜单的种子。全新的库里它们原本不存在。

背景。0009「收成 6 个分组」只会**改**既有的 16 条菜单(`update()` 命中 0 行时安静通过),它自己的
注释就写着「在全新的测试库里这些 path 并不存在」。那 16 条只存在于早期手工建出来的库里,仓库里没有它们的种子,
于是全新的库跑完全部迁移得到一棵残缺的侧边栏:6 个分组目录、0009 之后各迁移陆续加的页面,唯独没有仪表盘、
灵魂管理、审判队列、用户管理……

依据只用仓库里的东西:`backend/scripts/backups/pre_migrate_20260805T055951Z.json`(0009 之后的菜单快照)
给出名称 / 图标 / 顺序 / 分组 / 可见性 / roles / component,再把后续迁移对这些 path 的改动叠上去
(0011:`/karma` → `/ledger`;0009 的重命名早已体现在快照里)。快照里已软删除的测试行
(`/settings`、`/test-del`、`/test-del2`、一条重复的 `/souls`)**不种**。

幂等,而且在已有这些行的库里是零改动:按 path 判断,**已存在(包括已软删除的)就一行都不动** ——
不改名、不改顺序、不改可见性、不把管理员删掉的行复活。不存在才创建。

Menu 没有租户字段,所以这是全局的(与 0009 以来的每一条一样)。

反向只删「正向建出来之后没有人碰过」的行:与种子逐字段相同、`version == 0`(模型每次保存都 +1,管理员改过的行
和真实库里早就存在的行 —— 快照里它们的 version 都 ≥ 1 —— 都不满足)。回退不会把生产的侧边栏删掉。
"""
from django.db import migrations

ALL = ["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"]

# path, name, icon, order, 分组(None = 一级、不在侧边栏), roles, visible, component
MENUS = [
    {"path": "/dashboard", "name": "仪表盘", "icon": "PanelsTopLeft", "order": 10, "parent": "概览",
     "roles": ALL, "visible": True, "component": "dashboard"},
    {"path": "/souls", "name": "灵魂管理", "icon": "Users", "order": 10, "parent": "灵魂业务",
     "roles": ALL, "visible": True, "component": ""},
    {"path": "/judgment", "name": "审判队列", "icon": "Scale", "order": 20, "parent": "灵魂业务",
     "roles": ["ADMIN", "JUDGE"], "visible": True, "component": "judgment"},
    {"path": "/cross-judgments", "name": "跨域审判", "icon": "Scale", "order": 30, "parent": "灵魂业务",
     "roles": ["ADMIN", "JUDGE"], "visible": True, "component": ""},
    {"path": "/ledger", "name": "功德管理", "icon": "Gem", "order": 40, "parent": "灵魂业务",
     "roles": ALL, "visible": True, "component": ""},
    {"path": "/workflow", "name": "审批流程", "icon": "PanelsTopLeft", "order": 10, "parent": "流程协作",
     "roles": ["ADMIN", "JUDGE", "GUARDIAN"], "visible": True, "component": "workflow"},
    {"path": "/dispatch", "name": "调度管理", "icon": "ArrowRightLeft", "order": 20, "parent": "流程协作",
     "roles": ["ADMIN", "JUDGE", "GUARDIAN"], "visible": True, "component": ""},
    {"path": "/realms", "name": "领域管理", "icon": "Globe", "order": 10, "parent": "组织与领域",
     "roles": ALL, "visible": True, "component": ""},
    {"path": "/actors", "name": "神祇名录", "icon": "UserCog", "order": 20, "parent": "组织与领域",
     "roles": ALL, "visible": True, "component": ""},
    {"path": "/users", "name": "用户管理", "icon": "Users", "order": 10, "parent": "系统设置",
     "roles": ["ADMIN"], "visible": True, "component": ""},
    {"path": "/permissions", "name": "权限与角色", "icon": "ShieldCheck", "order": 20, "parent": "系统设置",
     "roles": ["ADMIN"], "visible": True, "component": ""},
    {"path": "/menus", "name": "菜单管理", "icon": "Menu", "order": 30, "parent": "系统设置",
     "roles": ["ADMIN"], "visible": True, "component": ""},
    {"path": "/audit", "name": "审计日志", "icon": "Scroll", "order": 40, "parent": "系统设置",
     "roles": ["ADMIN"], "visible": True, "component": "audit"},
    # 以下三条不在侧边栏(顶栏已有入口),路由与权限照旧 —— 与 0009 的 HIDDEN_FROM_SIDEBAR 同一批。
    {"path": "/welcome", "name": "欢迎页", "icon": "House", "order": 1, "parent": None,
     "roles": [], "visible": False, "component": ""},
    {"path": "/profile", "name": "个人资料", "icon": "User", "order": 18, "parent": None,
     "roles": ALL, "visible": False, "component": ""},
    {"path": "/notifications", "name": "通知中心", "icon": "Bell", "order": 20, "parent": None,
     "roles": ALL, "visible": False, "component": "notifications"},
]


def seed(apps, schema_editor):
    alias = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    objects = Menu.all_objects.using(alias)
    for item in MENUS:
        if objects.filter(path=item["path"]).exists():  # 含已软删除的:有过就不动
            continue
        parent = None
        if item["parent"]:
            parent = objects.filter(name=item["parent"], menu_type="DIRECTORY", is_deleted=False).first()
        objects.create(
            path=item["path"], name=item["name"], icon=item["icon"], order=item["order"], parent=parent,
            menu_type="MENU", permission="", roles=item["roles"], is_active=True,
            visible=item["visible"], component=item["component"],
        )


def unseed(apps, schema_editor):
    alias = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    for item in MENUS:
        Menu.all_objects.using(alias).filter(
            path=item["path"], is_deleted=False, version=0, menu_type="MENU", name=item["name"],
            icon=item["icon"], order=item["order"], roles=item["roles"], visible=item["visible"],
            component=item["component"], permission="", is_active=True,
        ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("menus", "0020_add_assistant_admin_menu"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
