"""Data migration: 灵魂端的两个官员页面入口。与 0015 同一写法(按 path 取或建,可逆)。

/soul-credentials「待交付初始密码」,父目录「灵魂业务」
    permission = "soul_account.read":页面数据来自 `/api/v1/soul-accounts/credentials/`,
    list 需要这个码(perm/0022 播种,ADMIN 与 MODERATOR 持有)。
    roles = ["ADMIN"]:MODERATOR 经「持有 permission 即可见」这扇门看到它,目录「灵魂业务」
    随可见子项可见(apps/menus/access.py),所以不改 roles 也不改目录。VIEWER / JUDGE /
    GUARDIAN 不持有该码,看不到 —— 联系方式与待交付明文是按最小可见收的。
    icon = "KeyRound"(frontend/src/lib/icons.ts 在册)。order = 60:该组现有 10–50。

/rebirth-applications「转生申请」,父目录「流程协作」
    permission = "workflow.read":`/api/v1/soul-accounts/rebirth-applications/` 的 list 码。
    roles = ["ADMIN", "JUDGE"]:角色表里除 MODERATOR 外持有 workflow.read 的只有这两个;
    MODERATOR 经 permission 门可见。不写 GUARDIAN —— 它不持有 workflow.read,写上就是
    一个点进去 403 的入口(tests/test_menu_visibility_follows_the_codename.py 的
    seeded-rows 断言也要求 roles 与持有者一致)。
    icon = "RefreshCw"(在册)。order = 40:该组现有 10–30。
"""
from django.db import migrations

MENUS = [
    {
        "path": "/soul-credentials",
        "parent": "灵魂业务",
        "defaults": {
            "name": "待交付初始密码", "icon": "KeyRound", "order": 60, "menu_type": "MENU",
            "permission": "soul_account.read", "roles": ["ADMIN"], "is_active": True, "visible": True,
            "component": "soul-credentials",
        },
    },
    {
        "path": "/rebirth-applications",
        "parent": "流程协作",
        "defaults": {
            "name": "转生申请", "icon": "RefreshCw", "order": 40, "menu_type": "MENU",
            "permission": "workflow.read", "roles": ["ADMIN", "JUDGE"], "is_active": True, "visible": True,
            "component": "rebirth-applications",
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
        ("menus", "0015_add_scheduler_menu"),
    ]

    operations = [
        migrations.RunPython(add_menus, remove_menus),
    ]
