"""Data migration: 「在线会话」(管理员看谁在线、强退)的侧栏入口,挂在「系统设置」下。与 0015 / 0028 同一写法。

* /audit/sessions —— 页面在审计页签里(`frontend/app/audit/sessions/page.tsx`),接口
  `auth/admin/sessions/` 只认 `session.manage`(perm/0028 播种,只授 ADMIN)。菜单挂同一个码。
* order 42:审计日志(40)之后、定时任务(45)之前,不给既有行重新编号。icon `Monitor` 在 IconPicker 里。

幂等 / 可逆:按 path 取或建,限定 is_deleted=False;反向按 path 删这一行。
"""
from django.db import migrations

MENU_PATH = "/audit/sessions"
PARENT_DIRECTORY = "系统设置"

MENU_DEFAULTS = {
    "name": "在线会话",
    "icon": "Monitor",
    "order": 42,
    "menu_type": "MENU",
    "permission": "session.manage",
    "roles": ["ADMIN"],
    "is_active": True,
    "visible": True,
    "component": "audit-sessions",
}


def _live(menu_model, alias):
    return menu_model.all_objects.using(alias).filter(is_deleted=False)


def add_menu(apps, schema_editor):
    alias = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    parent = _live(Menu, alias).filter(name=PARENT_DIRECTORY, menu_type="DIRECTORY").first()
    Menu.all_objects.using(alias).get_or_create(
        path=MENU_PATH, is_deleted=False, defaults={**MENU_DEFAULTS, "parent": parent}
    )
    _live(Menu, alias).filter(path=MENU_PATH).exclude(menu_type="DIRECTORY").update(
        parent=parent, order=MENU_DEFAULTS["order"]
    )


def remove_menu(apps, schema_editor):
    alias = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    _live(Menu, alias).filter(path=MENU_PATH).exclude(menu_type="DIRECTORY").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("menus", "0029_first_sixteen_menus_name_their_read_codename"),
    ]

    operations = [
        migrations.RunPython(add_menu, remove_menu),
    ]
