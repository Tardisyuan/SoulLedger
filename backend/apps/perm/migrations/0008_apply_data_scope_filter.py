"""
Migration: Apply data scope filter to RowLevelDataScope.

This migration seeds sample RowLevelDataScope entries that demonstrate
the data scope filtering capability.
"""
from django.db import migrations


def seed_sample_data_scopes(apps, schema_editor):
    """
    Seed sample RowLevelDataScope entries for demonstration.

    In production, these would be managed via admin or fixtures.
    """
    # Skip if running in test environment without Role model
    try:
        Role = apps.get_model('perm', 'Role')
        RowLevelDataScope = apps.get_model('perm', 'RowLevelDataScope')
    except LookupError:
        return

    # Only seed if tables exist and are empty
    if not Role.objects.exists():
        return

    def get_role(name):
        try:
            return Role.objects.get(name=name)
        except Role.DoesNotExist:
            return None

    scopes_to_create = []

    # ACTOR can only see PENDING souls in their civilization
    actor_role = get_role('ACTOR')
    if actor_role and not RowLevelDataScope.objects.filter(role=actor_role, model_name='Soul').exists():
        scopes_to_create.append(
            RowLevelDataScope(
                role=actor_role,
                model_name='Soul',
                filter_conditions={"current_state": ["PENDING"]},
                scope_type='READ',
                priority=10,
                is_active=True,
            )
        )

    # GUARDIAN can see DISPOSED souls in their civilization
    guardian_role = get_role('GUARDIAN')
    if guardian_role and not RowLevelDataScope.objects.filter(role=guardian_role, model_name='Soul').exists():
        scopes_to_create.append(
            RowLevelDataScope(
                role=guardian_role,
                model_name='Soul',
                filter_conditions={"current_state": ["DISPOSED"]},
                scope_type='READ',
                priority=10,
                is_active=True,
            )
        )

    # VIEWER can see ALIVE souls
    viewer_role = get_role('VIEWER')
    if viewer_role and not RowLevelDataScope.objects.filter(role=viewer_role, model_name='Soul').exists():
        scopes_to_create.append(
            RowLevelDataScope(
                role=viewer_role,
                model_name='Soul',
                filter_conditions={"current_state": ["ALIVE"]},
                scope_type='READ',
                priority=5,
                is_active=True,
            )
        )

    if scopes_to_create:
        RowLevelDataScope.objects.bulk_create(scopes_to_create, ignore_conflicts=True)


def reverse_seed(apps, schema_editor):
    """Remove seeded data scopes."""
    try:
        RowLevelDataScope = apps.get_model('perm', 'RowLevelDataScope')
        apps.get_model('perm', 'Role')
    except LookupError:
        return

    # Remove scopes created for ACTOR, GUARDIAN, VIEWER roles (not ADMIN or JUDGE)
    roles_to_remove = ['ACTOR', 'GUARDIAN', 'VIEWER']
    RowLevelDataScope.objects.filter(
        role__name__in=roles_to_remove,
        model_name='Soul',
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('perm', '0007_role_parent'),
    ]

    operations = [
        migrations.RunPython(
            seed_sample_data_scopes,
            reverse_seed,
        ),
    ]
