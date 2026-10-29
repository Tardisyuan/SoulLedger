"""Data migration: `add_record` / `update_record` moved from `soul.update` to `ledger.manage` (rbac-be1, user
2026-10-29 item 19). Every role that writes merit / demerit records today does so through `soul.update`, so each
role holding `soul.update` and not yet `ledger.manage` is granted `ledger.manage` — on a seeded database that is
GUARDIAN (ADMIN and MODERATOR already hold both). Nobody who keeps the ledger loses the button; who may keep it
is from here on a matrix decision on the right codename.

In souls rather than perm because it carries out a souls endpoint change. Idempotent (get_or_create). Backward is a
no-op: which grants were added here is not recorded, and taking ledger.manage from roles that held it before
would be worse than leaving the extra grant.
"""
from django.db import migrations


def forward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Permission = apps.get_model("perm", "Permission")
    RolePermission = apps.get_model("perm", "RolePermission")

    manage = Permission.all_objects.using(alias).filter(codename="ledger.manage", is_deleted=False).first()
    update = Permission.all_objects.using(alias).filter(codename="soul.update", is_deleted=False).first()
    if manage is None or update is None:
        return
    writers = RolePermission.all_objects.using(alias).filter(
        permission=update, is_deleted=False, role__is_deleted=False,
    ).values_list("role_id", flat=True)
    for role_id in set(writers):
        RolePermission.all_objects.using(alias).get_or_create(role_id=role_id, permission=manage, is_deleted=False)


class Migration(migrations.Migration):
    dependencies = [
        ("souls", "0052_soul_code_search_trigram"),
        ("perm", "0027_souls_mfa_reset_permission"),
    ]

    operations = [
        migrations.RunPython(forward, migrations.RunPython.noop),
    ]
