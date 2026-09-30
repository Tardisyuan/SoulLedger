"""Data migration: 助手管理页(/admin/assistant)的侧边栏入口,挂在「系统设置」下。与 0019 同一写法(按 path 取或建,可逆)。

permission = ""
    页面的接口按角色判断(`apps/soul_assist/admin_views.py::IsAdminRole`,`role == "ADMIN"`),
    **故意不走权限码** —— 否则「权限」页能把它误授给别人(docs/ARCHITECTURE-assist-admin.md §6)。
    写一个码名,就会打开 `apps/menus/access.py` 的第二扇门(持码可见),给一个点进去 403 的入口。
roles = ["ADMIN"]:唯一能用这一页的角色。
「实际用量」(/admin/assistant/usage)是同一页的第二个标签(`AssistAdminTabs`),不另建菜单行。
icon = "Sparkles"(frontend/src/lib/icons.ts 在册)。order = 47:紧跟定时任务(45),同为运维配置,
    在 tenants(50)之前,不给既有行重新编号。
"""
from django.db import migrations

MENUS = [
    {
        "path": "/admin/assistant",
        "parent": "系统设置",
        "defaults": {
            "name": "助手管理", "icon": "Sparkles", "order": 47, "menu_type": "MENU",
            "permission": "", "roles": ["ADMIN"], "is_active": True, "visible": True,
            "component": "admin/assistant",
        },
    },
]


def _live(menu_model):
    return menu_model.all_objects.filter(is_deleted=False)


def add_menus(apps, schema_editor):
    Menu = apps.get_model("menus", "Menu")
    for item in MENUS:
        parent = _live(Menu).filter(name=item["parent"], menu_type="DIRECTORY").first()
        Menu.all_objects.get_or_create(
            path=item["path"], is_deleted=False, defaults={**item["defaults"], "parent": parent}
        )
        _live(Menu).filter(path=item["path"]).exclude(menu_type="DIRECTORY").update(
            parent=parent, order=item["defaults"]["order"]
        )


def remove_menus(apps, schema_editor):
    Menu = apps.get_model("menus", "Menu")
    _live(Menu).filter(path__in=[m["path"] for m in MENUS]).exclude(menu_type="DIRECTORY").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("menus", "0019_add_sentence_requests_menu"),
    ]

    operations = [
        migrations.RunPython(add_menus, remove_menus),
    ]
