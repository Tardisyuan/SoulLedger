"""Data migration: `/social` 与 `/social/follows` 的 `permission` 从 `social.read` 清成空串(rbac-web L-8,2026-10-29)。

0007 种下的 `social.read` 不在权限目录里(`apps/perm/models.py` 只有 `social.moderate`),没有哪个角色持有它,
也没有接口执行它 —— 社交接口是 IsAuthenticated + 对象级规则。这两条的 `roles` 是空的(人人可见),
所以这个码眼下不生效;但 `menu_is_visible_to` 的第二道门读 `permission`,而菜单编辑页把它当真码展示,
一个不存在的码只会误导。社交没有读码,正确的值是空串。

只改仍是 `social.read` 的行;反向只把本迁移清空、且 `roles` 仍为空的这两条写回。
"""
from django.db import migrations

PATHS = ("/social", "/social/follows")


def clear(apps, schema_editor):
    alias = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    Menu.all_objects.using(alias).filter(path__in=PATHS, permission="social.read").update(permission="")


def restore(apps, schema_editor):
    alias = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    for row in Menu.all_objects.using(alias).filter(path__in=PATHS, permission=""):
        # roles 是 JSONField,SQLite 上不能按值过滤 —— 逐行在 Python 里比(同 0029)。
        if not row.roles:
            Menu.all_objects.using(alias).filter(pk=row.pk).update(permission="social.read")


class Migration(migrations.Migration):
    dependencies = [
        ("menus", "0029_first_sixteen_menus_name_their_read_codename"),
    ]

    operations = [
        migrations.RunPython(clear, restore),
    ]
