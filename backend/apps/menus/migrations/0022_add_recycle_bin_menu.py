"""Data migration: 回收站(/recycle-bin)的侧边栏入口,挂在「系统设置」下,只给 ADMIN。与 0020 同一写法(按 path 取或建,可逆)。

页面早就在:`/recycle-bin` 列出各类软删除的父行,可恢复或永久删除。全前端只有朋友圈审核页一处链接,
要去回收站只能手输 URL。

roles = ["ADMIN"]:恢复与永久删除是 ADMIN 的事(`recycle_bin.restore` / `.hard_delete` 是 ADMIN-only 码,
    `apps/perm/matrix.py::ADMIN_ONLY_CODENAMES`)。permission = "":写 `recycle_bin.read` 会打开
    `apps/menus/access.py` 的第二扇门(持码可见),把入口露给被授予读码的非 ADMIN —— 用户 2026-10-11
    要的是「仅 ADMIN 可见」,与 0020 对助手管理页的处理一致。
icon = "Trash2"(lucide,IconPicker 在册)。order = 70:接在组织架构(60)之后,不给既有行重新编号。
"""
from django.db import migrations

MENUS = [
    {
        "path": "/recycle-bin",
        "parent": "系统设置",
        "defaults": {
            "name": "回收站", "icon": "Trash2", "order": 70, "menu_type": "MENU",
            "permission": "", "roles": ["ADMIN"], "is_active": True, "visible": True,
            "component": "recycle-bin",
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
        ("menus", "0021_seed_the_first_sixteen_menus"),
    ]

    operations = [
        migrations.RunPython(add_menus, remove_menus),
    ]
