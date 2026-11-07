"""Data migration: MODERATOR 的显示名「Realm Lead」→「Circle Moderator」(用户 2026-11-07:朋友圈巡察)。

0017 播种时写的是 Realm Lead(殿主);这个角色从 perm/0036 起只管朋友圈审核。只改仍是种子原值的那一行 ——
管理员在角色页改过显示名的不动。可逆:backward 把仍是新值的改回 Realm Lead。
"""
from django.db import migrations

OLD, NEW = "Realm Lead", "Circle Moderator"


def _rename(apps, schema_editor, before, after):
    Role = apps.get_model("perm", "Role")
    Role.all_objects.using(schema_editor.connection.alias).filter(
        name="MODERATOR", display_name=before
    ).update(display_name=after)


def forward(apps, schema_editor):
    _rename(apps, schema_editor, OLD, NEW)


def backward(apps, schema_editor):
    _rename(apps, schema_editor, NEW, OLD)


class Migration(migrations.Migration):
    dependencies = [
        ("perm", "0036_moderator_only_moderates_the_circle"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
