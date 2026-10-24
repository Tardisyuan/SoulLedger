"""Data migration: 申诉复核(第五十二批)与城隍(第五十三批)的三条侧栏入口。与 0024 同一写法(按 path 取或建,可逆)。

* /judgment/appeals —— 「灵魂业务」order 31(跨域审判 30 之后)。列表 `judgment/appeals/` 读码 `judgment.read`。
* /city-god-cases —— 城隍初审队列,「灵魂业务」order 18:灵魂事件(15)之后、审判队列(20)前面 —— 案子先过城隍再到十殿
  (Design 第五十三批说的「审判组第一项」;侧栏里审判一类页面在「灵魂业务」下,没有单独的「审判」组)。
* /city-gods —— 城隍管理,「系统设置」order 25(权限 20 与菜单 30 之间)。看是 `judgment.read`,
  增改删 `judgment.assign` 由接口自己查。JUDGE 经「持有 permission 即可见」看到它(apps/menus/access.py)。

permission / roles 同 /sentence-plans(0024):`judgment.read`,ADMIN / JUDGE。非地府的殿由前端藏起后两项
(接口照样只在地府能建城隍)。icon 都在 IconPicker 里。
"""
from django.db import migrations

_COMMON = {"menu_type": "MENU", "permission": "judgment.read", "roles": ["ADMIN", "JUDGE"],
           "is_active": True, "visible": True}

MENUS = [
    {"path": "/judgment/appeals", "parent": "灵魂业务",
     "defaults": {"name": "申诉复核", "icon": "Scale", "order": 31, "component": "judgment-appeals", **_COMMON}},
    {"path": "/city-god-cases", "parent": "灵魂业务",
     "defaults": {"name": "城隍初审", "icon": "Landmark", "order": 18, "component": "city-god-cases", **_COMMON}},
    {"path": "/city-gods", "parent": "系统设置",
     "defaults": {"name": "城隍", "icon": "MapPin", "order": 25, "component": "city-gods", **_COMMON}},
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
        ("menus", "0025_rebirth_group_and_register"),
    ]

    operations = [
        migrations.RunPython(add_menus, remove_menus),
    ]
