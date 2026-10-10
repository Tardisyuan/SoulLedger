"""
Permission Export/Import utilities.

Export role-permission configuration as JSON for backup/migration.
"""
import json

from django.db import transaction
from django.http import HttpResponse

from apps.perm.matrix import ADMIN_ROLE_NAME, admin_only_violations, role_forbidden_violations
from apps.perm.models import FieldPermission, Permission, Role, RolePermission, RowLevelDataScope


def export_permissions():
    """
    Export all permission configuration as a JSON dict.

    Returns:
        dict with roles, permissions, role_permissions, field_permissions, data_scopes
    """
    # Export permissions
    permissions = list(
        Permission.objects.values('codename', 'name', 'category')
    )

    # Export roles
    roles = list(
        Role.objects.values('name', 'display_name', 'description', 'scope')
    )

    # Export role-permission assignments
    role_permissions = list(
        RolePermission.objects.select_related('role', 'permission')
        .values('role__name', 'permission__codename', 'conditions')
    )
    # Flatten field names
    for rp in role_permissions:
        rp['role'] = rp.pop('role__name')
        rp['permission'] = rp.pop('permission__codename')

    # Export field permissions
    field_permissions = list(
        FieldPermission.objects.select_related('role')
        .values('role__name', 'model_name', 'field_name', 'visible', 'read_only', 'editable')
    )
    for fp in field_permissions:
        fp['role'] = fp.pop('role__name')

    # Export row-level data scopes
    data_scopes = list(
        RowLevelDataScope.objects.select_related('role')
        .values('role__name', 'civilization', 'model_name', 'filter_conditions', 'scope_type', 'priority', 'is_active')
    )
    for ds in data_scopes:
        ds['role'] = ds.pop('role__name')

    return {
        'version': '1.0',
        'permissions': permissions,
        'roles': roles,
        'role_permissions': role_permissions,
        'field_permissions': field_permissions,
        'data_scopes': data_scopes,
    }


def export_permissions_json_response():
    """Export permissions as a downloadable JSON file."""
    data = export_permissions()
    json_content = json.dumps(data, indent=2, ensure_ascii=False)

    response = HttpResponse(json_content, content_type='application/json')
    response['Content-Disposition'] = 'attachment; filename=permissions_export.json'
    return response


SECTIONS = ('permissions', 'roles', 'role_permissions', 'field_permissions', 'data_scopes')

# Why a row of the file was not added. `unknown_reference`: the row names a role
# or permission that exists neither in the database nor in the file.
SKIP_ALREADY_EXISTS = 'already_exists'
SKIP_ADMIN_ONLY = 'admin_only'
SKIP_ROLE_FORBIDDEN = 'role_forbidden'
SKIP_UNKNOWN_REFERENCE = 'unknown_reference'


def import_permissions(data, overwrite=False, dry_run=False):
    """
    Import permission configuration from a JSON dict.

    Args:
        data: dict from export_permissions()
        overwrite: if True, delete existing data before import (ADMIN's role
            permissions are kept), and existing roles take the file's
            display_name / description
        dry_run: run the whole merge, then roll the transaction back. The stats
            are what a real import would return; no row survives, and the
            audit rows (written on commit) are never written.

    Returns:
        dict: per section ``{'created': n, 'skipped': n}``, plus
        ``skipped_details`` - ``[{'section', 'key', 'reason'}]`` for every
        row of the file that was not added.
    """
    stats = {s: {'created': 0, 'skipped': 0} for s in SECTIONS}
    details = []

    def made(section):
        stats[section]['created'] += 1

    def skip(section, key, reason):
        stats[section]['skipped'] += 1
        details.append({'section': section, 'key': key, 'reason': reason})

    with transaction.atomic():
        _merge(data, overwrite, made, skip)
        if dry_run:
            transaction.set_rollback(True)

    stats['skipped_details'] = details
    return stats


def _merge(data, overwrite, made, skip):
    if overwrite:
        FieldPermission.objects.all().delete()
        RowLevelDataScope.objects.all().delete()
        # ADMIN always has everything (`admin_always_all`, 2026-09-25): an
        # overwrite import whose file lacks an ADMIN row must not strip it.
        RolePermission.objects.exclude(role__name=ADMIN_ROLE_NAME).delete()

    # Import permissions. `revive_or_create`, not `get_or_create`: a binned
    # row with the same natural key comes back rather than gaining a twin.
    for perm_data in data.get('permissions', []):
        _, created = Permission.revive_or_create(
            perm_data['codename'],
            name=perm_data['name'], category=perm_data['category'],
        )
        if created:
            made('permissions')
        else:
            skip('permissions', perm_data['codename'], SKIP_ALREADY_EXISTS)

    # Import roles
    for role_data in data.get('roles', []):
        labels = {
            'display_name': role_data['display_name'],
            # Files exported before the field existed carry no description: blank, not an error.
            'description': role_data.get('description', ''),
        }
        role, created = Role.revive_or_create(role_data['name'], scope=role_data.get('scope', 'ORG'), **labels)
        if created:
            made('roles')
        else:
            skip('roles', role_data['name'], SKIP_ALREADY_EXISTS)
        # Overwrite: the file's labels win for a role that already existed too
        # (2026-09-26 product decision). A normal import leaves existing roles alone.
        # Only the two labels - ADMIN's grants keep the protections above and below.
        if overwrite and any(getattr(role, k) != v for k, v in labels.items()):
            for k, v in labels.items():
                setattr(role, k, v)
            role.save(update_fields=list(labels))

    # Import role-permission assignments
    for rp_data in data.get('role_permissions', []):
        key = f"{rp_data['role']} / {rp_data['permission']}"
        role = Role.objects.filter(name=rp_data['role']).first()
        perm = Permission.objects.filter(codename=rp_data['permission']).first()
        if not (role and perm):
            skip('role_permissions', key, SKIP_UNKNOWN_REFERENCE)
        elif admin_only_violations(role.name, [perm.codename]):
            skip('role_permissions', key, SKIP_ADMIN_ONLY)
        elif role_forbidden_violations(role.name, [perm.codename]):
            skip('role_permissions', key, SKIP_ROLE_FORBIDDEN)
        else:
            _, created = RolePermission.objects.get_or_create(
                role=role,
                permission=perm,
                defaults={'conditions': rp_data.get('conditions', {})}
            )
            if created:
                made('role_permissions')
            else:
                skip('role_permissions', key, SKIP_ALREADY_EXISTS)

    # Import field permissions
    for fp_data in data.get('field_permissions', []):
        key = f"{fp_data['role']} / {fp_data['model_name']}.{fp_data['field_name']}"
        role = Role.objects.filter(name=fp_data['role']).first()
        if not role:
            skip('field_permissions', key, SKIP_UNKNOWN_REFERENCE)
            continue
        _, created = FieldPermission.objects.get_or_create(
            role=role,
            model_name=fp_data['model_name'],
            field_name=fp_data['field_name'],
            defaults={
                'visible': fp_data.get('visible', True),
                'read_only': fp_data.get('read_only', False),
                'editable': fp_data.get('editable', True),
            }
        )
        if created:
            made('field_permissions')
        else:
            skip('field_permissions', key, SKIP_ALREADY_EXISTS)

    # Import data scopes
    for ds_data in data.get('data_scopes', []):
        key = f"{ds_data['role']} / {ds_data['model_name']} / {ds_data['scope_type']}"
        role = Role.objects.filter(name=ds_data['role']).first()
        if not role:
            skip('data_scopes', key, SKIP_UNKNOWN_REFERENCE)
            continue
        _, created = RowLevelDataScope.objects.get_or_create(
            role=role,
            model_name=ds_data['model_name'],
            scope_type=ds_data['scope_type'],
            defaults={
                'civilization': ds_data.get('civilization'),
                'filter_conditions': ds_data.get('filter_conditions', {}),
                'priority': ds_data.get('priority', 0),
                'is_active': ds_data.get('is_active', True),
            }
        )
        if created:
            made('data_scopes')
        else:
            skip('data_scopes', key, SKIP_ALREADY_EXISTS)
