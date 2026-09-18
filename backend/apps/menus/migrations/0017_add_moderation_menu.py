"""Data migration: 灵魂朋友圈审核后台的入口。与 0015 / 0016 同一写法(按 path 取或建,可逆)。

/moderation「朋友圈审核」,父目录「灵魂业务」
    permission = "social.moderate":页面数据全部来自 `/api/v1/social-moderation/`,
    每个端点都要这一个码(perm/0023 播种,ADMIN 与 MODERATOR 持有)。
    roles = ["ADMIN"]:MODERATOR 经「持有 permission 即可见」那扇门看到它
    (apps/menus/access.py),所以不写进 roles —— 与 0016 的 /soul-credentials 同一处理。
    JUDGE / GUARDIAN / VIEWER 不持有该码,看不到:被举报的内容里有 PRIVATE 与待审的
    帖子,按最小可见收。
    icon = "ShieldAlert"(frontend/src/lib/icons.ts 在册)。order = 70:该组现有 10–60。
"""
from django.db import migrations

MENUS = [
    {
        "path": "/moderation",
        "parent": "灵魂业务",
        "defaults": {
            "name": "朋友圈审核", "icon": "ShieldAlert", "order": 70, "menu_type": "MENU",
            "permission": "social.moderate", "roles": ["ADMIN"], "is_active": True, "visible": True,
            "component": "moderation",
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
        ("menus", "0016_add_soul_account_menus"),
    ]

    operations = [
        migrations.RunPython(add_menus, remove_menus),
    ]
