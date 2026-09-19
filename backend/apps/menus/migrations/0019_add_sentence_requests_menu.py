"""Data migration: 受刑请求收件箱的入口。与 0018 同一写法(按 path 取或建,可逆)。

/sentence-requests「受刑请求」,父目录「灵魂业务」
    permission = "judgment.read":页面的列表来自 `/api/v1/sentence-plans/?pending_request=true`,
    `SentencePlanViewSet` 的读码就是它(ADMIN / JUDGE / MODERATOR 持有);批准 / 驳回 / 撤回另要
    `judgment.execute`,页面里按码名与租户收起按钮(docs/ARCHITECTURE-sentence-plan.md §2.5)。
    roles = ["ADMIN", "JUDGE"]:与 /judgment 同一批人;MODERATOR 经「持有 permission 即可见」那扇门
    看到它(apps/menus/access.py)。GUARDIAN / VIEWER 不持有 judgment.read,不写 —— 写上就是一个
    点进去 403 的入口(tests/test_menu_visibility_follows_the_codename.py 的 seeded-rows 断言)。
    icon = "FileCheck"(frontend/src/lib/icons.ts 在册)。order = 35:紧跟 /cross-judgments(30),
    请求多半来自联审定下的外地节点。
"""
from django.db import migrations

MENUS = [
    {
        "path": "/sentence-requests",
        "parent": "灵魂业务",
        "defaults": {
            "name": "受刑请求", "icon": "FileCheck", "order": 35, "menu_type": "MENU",
            "permission": "judgment.read", "roles": ["ADMIN", "JUDGE"], "is_active": True, "visible": True,
            "component": "sentence-requests",
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
        ("menus", "0018_add_soul_inbox_menu"),
    ]

    operations = [
        migrations.RunPython(add_menus, remove_menus),
    ]
