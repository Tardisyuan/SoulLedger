"""Data migration: 侧栏「全局」组与「各殿概况」(第五十四批 O-1)。只有全局管理员(ADMIN)看得到。

「全局」是一级分组(DIRECTORY),排在「系统设置」(60)之后;/halls 读 `GET /tenants/overview/`(ADMIN)。
permission 留空、roles 只 ADMIN,与 /tenants 同。按 path / 分组名取或建,幂等;反向删掉两行。
"""
from django.db import migrations

GROUP = {"name": "全局", "icon": "Globe", "order": 70, "roles": ["ADMIN"]}
HALLS = {
    "path": "/halls",
    "defaults": {
        "name": "各殿概况", "icon": "Building2", "order": 10, "menu_type": "MENU", "permission": "",
        "roles": ["ADMIN"], "is_active": True, "visible": True, "component": "halls",
    },
}


def _live(menu_model, alias):
    return menu_model.all_objects.using(alias).filter(is_deleted=False)


def forward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    group, _ = Menu.all_objects.using(alias).get_or_create(
        name=GROUP["name"], menu_type="DIRECTORY", is_deleted=False,
        defaults={"path": "", "icon": GROUP["icon"], "order": GROUP["order"], "roles": GROUP["roles"],
                  "parent": None, "is_active": True, "visible": True, "component": ""},
    )
    Menu.all_objects.using(alias).get_or_create(
        path=HALLS["path"], is_deleted=False, defaults={**HALLS["defaults"], "parent": group},
    )


def backward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    _live(Menu, alias).filter(path=HALLS["path"]).exclude(menu_type="DIRECTORY").delete()
    _live(Menu, alias).filter(name=GROUP["name"], menu_type="DIRECTORY").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("menus", "0026_add_appeals_and_city_god_menus"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
