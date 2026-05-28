"""
Permission Export/Import utilities.

Export role-permission configuration as JSON for backup/migration.
"""
import json
from django.http import HttpResponse
from apps.perm.models import Role, RolePermission, Permission, FieldPermission, RowLevelDataScope


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
        Role.objects.values('name', 'display_name', 'scope')
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


def import_permissions(data, overwrite=False):
    """
    Import permission configuration from a JSON dict.

    Args:
        data: dict from export_permissions()
        overwrite: if True, delete existing data before import

    Returns:
        dict with import statistics
    """
    stats = {'permissions': 0, 'roles': 0, 'role_permissions': 0, 'field_permissions': 0, 'data_scopes': 0}

    if overwrite:
        FieldPermission.objects.all().delete()
        RowLevelDataScope.objects.all().delete()
        RolePermission.objects.all().delete()

    # Import permissions
    for perm_data in data.get('permissions', []):
        _, created = Permission.objects.get_or_create(
            codename=perm_data['codename'],
            defaults={'name': perm_data['name'], 'category': perm_data['category']}
        )
        if created:
            stats['permissions'] += 1

    # Import roles
    for role_data in data.get('roles', []):
        _, created = Role.objects.get_or_create(
            name=role_data['name'],
            defaults={'display_name': role_data['display_name'], 'scope': role_data.get('scope', 'ORG')}
        )
        if created:
            stats['roles'] += 1

    # Import role-permission assignments
    for rp_data in data.get('role_permissions', []):
        role = Role.objects.filter(name=rp_data['role']).first()
        perm = Permission.objects.filter(codename=rp_data['permission']).first()
        if role and perm:
            _, created = RolePermission.objects.get_or_create(
                role=role,
                permission=perm,
                defaults={'conditions': rp_data.get('conditions', {})}
            )
            if created:
                stats['role_permissions'] += 1

    # Import field permissions
    for fp_data in data.get('field_permissions', []):
        role = Role.objects.filter(name=fp_data['role']).first()
        if role:
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
                stats['field_permissions'] += 1

    # Import data scopes
    for ds_data in data.get('data_scopes', []):
        role = Role.objects.filter(name=ds_data['role']).first()
        if role:
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
                stats['data_scopes'] += 1

    return stats
