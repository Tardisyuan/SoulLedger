"""
Data migration: Add Social menu entry to sidebar navigation.

The Social menu provides access to M13 Social Features:
- /social — Feed (posts, comments, reactions)
- /social/follows — Following/Followers lists
- /social/profile/[id] — User profiles

Visibility: All authenticated users (roles=[] means public).
Icon: Users (Lucide) — consistent with social/follow features.
"""
from django.db import migrations


def add_social_menu(apps, schema_editor):
    Menu = apps.get_model("menus", "Menu")

    # Create top-level Social menu (visible to all roles)
    social_menu, created = Menu.objects.get_or_create(
        name="Social",
        defaults={
            "path": "/social",
            "icon": "Users",
            "order": 50,  # After existing menus (souls=10, judgment=20, etc.)
            "menu_type": "MENU",
            "permission": "social.read",
            "roles": [],  # Empty = visible to all authenticated users
            "is_active": True,
            "visible": True,
            "component": "social",
        },
    )

    if created:
        # Create child menu items for sub-routes
        Menu.objects.get_or_create(
            name="Follows",
            parent=social_menu,
            defaults={
                "path": "/social/follows",
                "icon": "UserCheck",
                "order": 10,
                "menu_type": "MENU",
                "permission": "social.read",
                "roles": [],
                "is_active": True,
                "visible": True,
            },
        )


def remove_social_menu(apps, schema_editor):
    Menu = apps.get_model("menus", "Menu")
    Menu.objects.filter(name="Social", path="/social").delete()
    Menu.objects.filter(name="Follows", path="/social/follows").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("menus", "0006_remove_menu_idx_menu_parent_active_order"),
    ]

    operations = [
        migrations.RunPython(add_social_menu, remove_social_menu),
    ]
