"""Data migration: 殿司收件箱的入口。与 0017 同一写法(按 path 取或建,可逆)。

/soul-inbox「殿司收件箱」,父目录「灵魂业务」
    permission = "soul_inbox.read":页面的列表与正文都来自 `/api/v1/chat/inbox/`,
    读要这一个码(perm/0024 播种,ADMIN 与 MODERATOR 持有);回复另要 `soul_inbox.reply`,
    页面里按码名收起回复框。
    roles = ["ADMIN"]:MODERATOR 经「持有 permission 即可见」那扇门看到它
    (apps/menus/access.py),与 0017 的 /moderation 同一处理。JUDGE / GUARDIAN / VIEWER
    不持有该码,看不到:那是灵魂写给殿司的私人信件。
    icon = "Inbox"(frontend/src/lib/icons.ts 在册)。order = 80:该组现有 10–70。
"""
from django.db import migrations

MENUS = [
    {
        "path": "/soul-inbox",
        "parent": "灵魂业务",
        "defaults": {
            "name": "殿司收件箱", "icon": "Inbox", "order": 80, "menu_type": "MENU",
            "permission": "soul_inbox.read", "roles": ["ADMIN"], "is_active": True, "visible": True,
            "component": "soul-inbox",
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
        ("menus", "0017_add_moderation_menu"),
    ]

    operations = [
        migrations.RunPython(add_menus, remove_menus),
    ]
