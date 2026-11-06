"""Data migration: /corpus 的 `roles` 去掉 MODERATOR(用户 2026-11-07:朋友圈巡察只管朋友圈审核)。

0013 按「持有 `judgment.read` 的三个角色」写了 `["ADMIN", "JUDGE", "MODERATOR"]`;perm/0036 收回了
MODERATOR 的 `judgment.read`,这一格再留着就是一扇打不开的门(`/statutes/` 403)。别的菜单行的 `roles`
里没有 MODERATOR —— 它一直经「持有 permission 即可见」那扇门看到它们(apps/menus/access.py),
码收回了,菜单自己就跟着消失。

只改 path=/corpus、未软删的行,且只删 MODERATOR 这一项;别的角色、管理员手加的角色不动。
可逆:backward 在 roles 里没有 MODERATOR 时补回。
"""
from django.db import migrations

PATH = "/corpus"
ROLE = "MODERATOR"


def _rows(apps, schema_editor):
    Menu = apps.get_model("menus", "Menu")
    return Menu.all_objects.using(schema_editor.connection.alias).filter(path=PATH, is_deleted=False)


def forward(apps, schema_editor):
    for menu in _rows(apps, schema_editor):
        if ROLE in (menu.roles or []):
            menu.roles = [r for r in menu.roles if r != ROLE]
            menu.save(update_fields=["roles"])


def backward(apps, schema_editor):
    for menu in _rows(apps, schema_editor):
        if ROLE not in (menu.roles or []):
            menu.roles = [*(menu.roles or []), ROLE]
            menu.save(update_fields=["roles"])


class Migration(migrations.Migration):
    dependencies = [
        ("menus", "0036_add_annual_report_menu"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
