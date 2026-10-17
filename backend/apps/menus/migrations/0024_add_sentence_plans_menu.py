"""Data migration: 受刑计划列表(/sentence-plans)的侧边栏入口。与 0019 / 0023 同一写法(按 path 取或建,可逆)。

审计 2026-10-17 第 8 条:受刑计划此前没有自己的列表,只有受刑请求收件箱与灵魂详情的计划卡;
首页「待重发的调拨」只能链到第一份计划的灵魂,数量大于 1 时其余的找不到。

permission / roles 同 /sentence-requests(0019):列表来自 `/api/v1/sentence-plans/`,读码 `judgment.read`
(ADMIN / JUDGE / MODERATOR 持有);MODERATOR 经「持有 permission 即可见」那扇门看到它(apps/menus/access.py)。
GUARDIAN / VIEWER 不持有 judgment.read,不写 —— 写上就是一个点进去 403 的入口。
icon = "ListChecks"(IconPicker 在册)。order = 34:紧挨受刑请求(35)之前,不给既有行重新编号。
"""
from django.db import migrations

MENUS = [
    {
        "path": "/sentence-plans",
        "parent": "灵魂业务",
        "defaults": {
            "name": "受刑计划", "icon": "ListChecks", "order": 34, "menu_type": "MENU",
            "permission": "judgment.read", "roles": ["ADMIN", "JUDGE"], "is_active": True, "visible": True,
            "component": "sentence-plans",
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
        ("menus", "0023_b37_add_soul_events_menu"),
    ]

    operations = [
        migrations.RunPython(add_menus, remove_menus),
    ]
