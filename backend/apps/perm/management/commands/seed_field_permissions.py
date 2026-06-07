"""
Management command to seed example FieldPermission rules.

Usage:
    python manage.py seed_field_permissions
"""
from django.core.management.base import BaseCommand

from apps.perm.models import FieldPermission, Role


class Command(BaseCommand):
    help = 'Seed example FieldPermission rules for different roles'

    def handle(self, *args, **options):
        # Ensure roles exist
        roles = {}
        for role_name in ['ADMIN', 'JUDGE', 'GUARDIAN', 'VIEWER']:
            role, _ = Role.objects.get_or_create(
                name=role_name,
                defaults={'display_name': role_name.title()}
            )
            roles[role_name] = role

        # Define field permission rules
        rules = [
            # Soul: VIEWER can see but not edit sensitive fields
            {
                'role': 'VIEWER',
                'model_name': 'Soul',
                'field_name': 'merit_score',
                'visible': True,
                'read_only': True,
                'editable': False,
            },
            {
                'role': 'VIEWER',
                'model_name': 'Soul',
                'field_name': 'demerit_score',
                'visible': True,
                'read_only': True,
                'editable': False,
            },
            {
                'role': 'VIEWER',
                'model_name': 'Soul',
                'field_name': 'current_state',
                'visible': True,
                'read_only': True,
                'editable': False,
            },

            # JUDGE: can see all fields, edit judgment-related fields
            {
                'role': 'JUDGE',
                'model_name': 'Soul',
                'field_name': 'merit_score',
                'visible': True,
                'read_only': False,
                'editable': True,
            },
            {
                'role': 'JUDGE',
                'model_name': 'Soul',
                'field_name': 'demerit_score',
                'visible': True,
                'read_only': False,
                'editable': True,
            },

            # GUARDIAN: can see all fields, limited editing
            {
                'role': 'GUARDIAN',
                'model_name': 'Soul',
                'field_name': 'current_state',
                'visible': True,
                'read_only': True,
                'editable': False,
            },

            # Judgment: VIEWER can only see, not edit
            {
                'role': 'VIEWER',
                'model_name': 'Judgment',
                'field_name': 'verdict',
                'visible': True,
                'read_only': True,
                'editable': False,
            },
            {
                'role': 'VIEWER',
                'model_name': 'Judgment',
                'field_name': 'verdict_reason',
                'visible': True,
                'read_only': True,
                'editable': False,
            },

            # User: VIEWER cannot see sensitive fields
            {
                'role': 'VIEWER',
                'model_name': 'User',
                'field_name': 'email',
                'visible': False,
                'read_only': False,
                'editable': False,
            },
            {
                'role': 'VIEWER',
                'model_name': 'User',
                'field_name': 'is_active',
                'visible': False,
                'read_only': False,
                'editable': False,
            },

            # GUARDIAN: cannot see other users' emails
            {
                'role': 'GUARDIAN',
                'model_name': 'User',
                'field_name': 'email',
                'visible': True,
                'read_only': True,
                'editable': False,
            },
        ]

        created_count = 0
        for rule_data in rules:
            role_name = rule_data.pop('role')
            role = roles[role_name]

            obj, created = FieldPermission.objects.get_or_create(
                role=role,
                model_name=rule_data['model_name'],
                field_name=rule_data['field_name'],
                defaults={
                    'visible': rule_data.get('visible', True),
                    'read_only': rule_data.get('read_only', False),
                    'editable': rule_data.get('editable', True),
                    'is_active': True,
                }
            )
            if created:
                created_count += 1
                self.stdout.write(
                    self.style.SUCCESS(
                        f"Created: {role_name} → {rule_data['model_name']}.{rule_data['field_name']}"
                    )
                )

        self.stdout.write(
            self.style.SUCCESS(f"\nDone: {created_count} FieldPermission rules created")
        )
