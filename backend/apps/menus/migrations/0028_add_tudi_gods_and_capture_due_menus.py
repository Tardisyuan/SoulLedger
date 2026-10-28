"""Data migration: 土地公与待发勾魂牒(Design 第五十七批 S-5 / S-7)的两条侧栏入口。与 0026 同一写法(按 path 取或建,可逆)。

* /judgment/capture-due —— 待发勾魂牒,「灵魂业务」order 17:灵魂事件(15)之后、城隍初审(18)前面 ——
  流程是勾魂 → 城隍初审 → 十殿。列表 `dispatch/capture-warrants/due/` 读码 `soul.read`;菜单挂 `soul.die`
  (发牒要的码名):只有能发牒的人在侧栏看到它。页面本身的门是 `soul.read`。
* /death-sync/tudi-gods —— 土地公管理,「系统设置」order 26,紧跟城隍(25)。看是 `judgment.read`,
  增改删 `judgment.assign` 由接口自己查(同城隍)。

路由放在已有的 `/judgment/`、`/death-sync/` 下面:土地公的接口就在 `death-sync/tudi-gods/`。
非地府的殿由前端藏起这两项(`hideOutsideDiyu`)。icon 都在 IconPicker 里。
"""
from django.db import migrations

_COMMON = {"menu_type": "MENU", "roles": ["ADMIN", "JUDGE"], "is_active": True, "visible": True}

MENUS = [
    {"path": "/judgment/capture-due", "parent": "灵魂业务",
     "defaults": {"name": "待发勾魂牒", "icon": "Ghost", "order": 17, "component": "capture-due",
                  "permission": "soul.die", **_COMMON}},
    {"path": "/death-sync/tudi-gods", "parent": "系统设置",
     "defaults": {"name": "土地公", "icon": "TreePine", "order": 26, "component": "tudi-gods",
                  "permission": "judgment.read", **_COMMON}},
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
        ("menus", "0027_add_global_group_and_halls_overview"),
    ]

    operations = [
        migrations.RunPython(add_menus, remove_menus),
    ]
