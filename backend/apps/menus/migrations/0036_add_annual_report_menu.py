"""Data migration: 「冥界年报」(v4 第八批 S14,`annual.*`)的侧栏入口,挂在「概览」下、仪表盘之后。与 0030 同一写法。

* /dashboard/annual —— 页面 `frontend/app/dashboard/annual/page.tsx`,接口 `GET /judgment/annual/` 要 `judgment.read`,
  菜单挂同一个码(与审判队列同一扇门)。
* order 12:仪表盘(10)之后,不给既有行重新编号。icon `CalendarCheck` 在 IconPicker 里(`iconCatalog.ts`)。

幂等 / 可逆:按 path 取或建,限定 is_deleted=False;反向按 path 删这一行。
"""
from django.db import migrations

MENU_PATH = "/dashboard/annual"
PARENT_DIRECTORY = "概览"

MENU_DEFAULTS = {
    "name": "冥界年报",
    "name_en": "The underworld year",
    "icon": "CalendarCheck",
    "order": 12,
    "menu_type": "MENU",
    "permission": "judgment.read",
    "roles": ["ADMIN", "JUDGE"],
    "is_active": True,
    "visible": True,
    "component": "annual",
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


def remove_menu(apps, schema_editor):
    alias = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    _live(Menu, alias).filter(path=MENU_PATH).exclude(menu_type="DIRECTORY").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("menus", "0035_backfill_english"),
    ]

    operations = [
        migrations.RunPython(add_menu, remove_menu),
    ]
