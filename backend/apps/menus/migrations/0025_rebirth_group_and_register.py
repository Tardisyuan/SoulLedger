"""Data migration: 侧栏「轮回」改成一组 —— 处置(原 /disposition)· 转生登记簿(/rebirths)。第四十批 W-c。

侧栏只画两层(分组 → 页面,`GlobalNav`),所以「轮回」是**一级分组**(DIRECTORY),排在「灵魂业务」(20)
与「流程协作」(30)之间(order = 25);/disposition 从「灵魂业务」挪进来、改名「处置」。

/rebirths 的 permission = "reincarnation.read"(列表 `/api/v1/reincarnation/` 的读码,四个官员角色都持有),
roles 同 /disposition。分组的 roles 取两页的并集。icon:分组沿用 /disposition 的 "RefreshCw",
登记簿用 "ScrollText"(IconPicker 在册)。

按 path / 分组名取或建,幂等;反向把 /disposition 放回「灵魂业务」(order 50、原名「轮回处置」),删掉登记簿与分组。
"""
from django.db import migrations

GROUP = {"name": "轮回", "icon": "RefreshCw", "order": 25, "roles": ["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"]}
DISPOSITION = {"path": "/disposition", "name": "处置", "order": 10}
REGISTER = {
    "path": "/rebirths",
    "defaults": {
        "name": "转生登记簿", "icon": "ScrollText", "order": 20, "menu_type": "MENU",
        "permission": "reincarnation.read", "roles": ["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"],
        "is_active": True, "visible": True, "component": "rebirths",
    },
}
OLD_PARENT, OLD_NAME, OLD_ORDER = "灵魂业务", "轮回处置", 50


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
    _live(Menu, alias).filter(path=DISPOSITION["path"]).exclude(menu_type="DIRECTORY").update(
        parent=group, name=DISPOSITION["name"], order=DISPOSITION["order"],
    )
    Menu.all_objects.using(alias).get_or_create(
        path=REGISTER["path"], is_deleted=False, defaults={**REGISTER["defaults"], "parent": group},
    )
    _live(Menu, alias).filter(path=REGISTER["path"]).exclude(menu_type="DIRECTORY").update(
        parent=group, order=REGISTER["defaults"]["order"],
    )


def backward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    old_parent = _live(Menu, alias).filter(name=OLD_PARENT, menu_type="DIRECTORY").first()
    _live(Menu, alias).filter(path=DISPOSITION["path"]).exclude(menu_type="DIRECTORY").update(
        parent=old_parent, name=OLD_NAME, order=OLD_ORDER,
    )
    _live(Menu, alias).filter(path=REGISTER["path"]).exclude(menu_type="DIRECTORY").delete()
    _live(Menu, alias).filter(name=GROUP["name"], menu_type="DIRECTORY").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("menus", "0024_add_sentence_plans_menu"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
