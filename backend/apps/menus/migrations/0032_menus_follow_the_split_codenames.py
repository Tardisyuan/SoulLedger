"""Data migration: 侧栏入口跟着拆出来的码走(用户 2026-10-29 第 2、3 条;perm/0029 建了这些码)。

* /city-god-cases、/city-gods —— `judgment.read` → `city_god.read`(页面与接口的读码)。
* /death-sync/tudi-gods —— `judgment.read` → `tudi.read`。
* /judgment/capture-due —— `soul.die` → `capture.issue`(菜单给能发牒的人,同 0028 的用意)。
* /permissions —— 空串 → `system.settings`:权限页的读接口从 2026-10-29 起按这个码判(perm/views.py),
  0029 当时没写它的理由(「没有一个码能让别的角色真用上它」)不再成立。

只改仍是旧值的行;管理员改过的不动。反向把仍是新值的行写回旧值。
"""
from django.db import migrations

#: path -> (旧码, 新码)
CHANGES = {
    "/city-god-cases": ("judgment.read", "city_god.read"),
    "/city-gods": ("judgment.read", "city_god.read"),
    "/death-sync/tudi-gods": ("judgment.read", "tudi.read"),
    "/judgment/capture-due": ("soul.die", "capture.issue"),
    "/permissions": ("", "system.settings"),
}


def _move(apps, schema_editor, forward):
    alias = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    for path, (old, new) in CHANGES.items():
        frm, to = (old, new) if forward else (new, old)
        Menu.all_objects.using(alias).filter(path=path, menu_type="MENU", permission=frm).update(permission=to)


def forward(apps, schema_editor):
    _move(apps, schema_editor, True)


def backward(apps, schema_editor):
    _move(apps, schema_editor, False)


class Migration(migrations.Migration):
    dependencies = [
        ("menus", "0031_social_menus_drop_a_codename_that_does_not_exist"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
