"""Data migration: 播种 `workflow.terminate`,只授予 ADMIN(用户 2026-11-06)。

与 0027 同一写法与同一理由。它只管 `POST /workflows/{id}/terminate/`。码名写死在这里:迁移是冻结的快照。
幂等:get_or_create,限定 is_deleted=False。可逆:backward 删掉这一条 Permission。
"""
from django.db import migrations

PERMISSIONS = [("workflow.terminate", "结束工作流", "End workflows", "workflow")]
GRANTED_TO = ["ADMIN"]


def forward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Permission = apps.get_model("perm", "Permission")
    Role = apps.get_model("perm", "Role")
    RolePermission = apps.get_model("perm", "RolePermission")

    for codename, name, name_en, category in PERMISSIONS:
        perm, _ = Permission.all_objects.using(alias).get_or_create(
            codename=codename, is_deleted=False, defaults={"name": name, "name_en": name_en, "category": category}
        )
        for role_name in GRANTED_TO:
            role = Role.all_objects.using(alias).filter(name=role_name, is_deleted=False).first()
            if role is None:
                continue
            RolePermission.all_objects.using(alias).get_or_create(role=role, permission=perm, is_deleted=False)


def backward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Permission = apps.get_model("perm", "Permission")
    Permission.all_objects.using(alias).filter(codename__in=[p[0] for p in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("perm", "0033_backfill_english"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
