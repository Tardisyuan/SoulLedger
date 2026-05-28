"""
Data migration: populate User.rbac_role from User.role TextChoices.
"""
from django.db import migrations


def populate_rbac_role(apps, schema_editor):
    """Map User.role (CharField) → User.rbac_role (FK to perm.Role)."""
    User = apps.get_model("authentication", "User")
    Role = apps.get_model("perm", "Role")

    role_mapping = {
        "ADMIN": "ADMIN",
        "JUDGE": "JUDGE",
        "GUARDIAN": "GUARDIAN",
        "VIEWER": "VIEWER",
    }

    for user_role_name, perm_role_name in role_mapping.items():
        try:
            perm_role = Role.objects.get(name=perm_role_name)
            User.objects.filter(role=user_role_name, rbac_role__isnull=True).update(rbac_role=perm_role)
        except Role.DoesNotExist:
            pass  # perm.Role not seeded yet — skip


def reverse_populate(apps, schema_editor):
    """Reverse: clear rbac_role."""
    User = apps.get_model("authentication", "User")
    User.objects.all().update(rbac_role=None)


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0009_add_rbac_role_fk"),
        ("perm", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(populate_rbac_role, reverse_populate),
    ]
