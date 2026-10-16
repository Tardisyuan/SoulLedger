"""Data migration: 灵魂事件(/events)的侧边栏入口,挂在「灵魂业务」下、灵魂管理(/souls)之后。与 0022 同一写法(按 path 取或建,可逆)。

第三十七批 W-13:全殿的灵魂事件流水,来看的是持灵魂读权限的官员,不是审计人员,所以不进「系统设置」。

roles 同 /souls(四个角色都能看灵魂详情页上的同一批事件,`SoulEventViewSet` 不另设码);
permission = "soul.read":持码即可见(`apps/menus/access.py` 的第二扇门),与页面的守卫同一个码。
icon = "Activity"(lucide,IconPicker 在册)。order = 15:接在灵魂管理(10)与审判队列(20)之间,不给既有行重新编号。
"""
from django.db import migrations

MENUS = [
    {
        "path": "/events",
        "parent": "灵魂业务",
        "defaults": {
            "name": "灵魂事件", "icon": "Activity", "order": 15, "menu_type": "MENU",
            "permission": "soul.read", "roles": ["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"],
            "is_active": True, "visible": True, "component": "events",
        },
    },
]


def _live(menu_model, alias):
    return menu_model.all_objects.using(alias).filter(is_deleted=False)


def add_menus(apps, schema_editor):
    alias = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    for item in MENUS:
        parent = _live(Menu, alias).filter(name=item["parent"], menu_type="DIRECTORY").first()
        Menu.all_objects.using(alias).get_or_create(
            path=item["path"], is_deleted=False, defaults={**item["defaults"], "parent": parent}
        )
        _live(Menu, alias).filter(path=item["path"]).exclude(menu_type="DIRECTORY").update(
            parent=parent, order=item["defaults"]["order"]
        )


def remove_menus(apps, schema_editor):
    alias = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    _live(Menu, alias).filter(path__in=[m["path"] for m in MENUS]).exclude(menu_type="DIRECTORY").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("menus", "0022_add_recycle_bin_menu"),
    ]

    operations = [
        migrations.RunPython(add_menus, remove_menus),
    ]
