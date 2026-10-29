"""
Permission Export/Import utilities.

Export role-permission configuration as JSON for backup/migration.
"""
import json

from django.db import transaction
from django.http import HttpResponse

from apps.perm.matrix import ADMIN_ROLE_NAME, admin_only_violations, role_forbidden_violations
from apps.perm.models import FieldPermission, Permission, Role, RoleDataScope, RolePermission


def export_permissions():
    """
    Export all permission configuration as a JSON dict.

    Returns:
        dict with roles, permissions, role_permissions, field_permissions, role_data_scopes
    """
    # Export permissions
    permissions = list(
        Permission.objects.values('codename', 'name', 'category')
    )

    # Export roles
    roles = list(
        Role.objects.values('name', 'display_name', 'description')
    )

    # Export role-permission assignments
    role_permissions = list(
        RolePermission.objects.select_related('role', 'permission')
        .values('role__name', 'permission__codename')
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

    # Role data scopes (数据范围 B4): machines move by org code, not id — ids differ between databases.
    role_data_scopes = [
        {'role': role, 'resource': resource, 'scope': scope, 'orgs': codes}
        for (role, resource), (scope, codes) in sorted(_role_data_scope_rows().items())
    ]

    return {
        'version': '1.0',
        'permissions': permissions,
        'roles': roles,
        'role_permissions': role_permissions,
        'field_permissions': field_permissions,
        'role_data_scopes': role_data_scopes,
    }


def export_permissions_json_response():
    """Export permissions as a downloadable JSON file."""
    data = export_permissions()
    json_content = json.dumps(data, indent=2, ensure_ascii=False)

    response = HttpResponse(json_content, content_type='application/json')
    response['Content-Disposition'] = 'attachment; filename=permissions_export.json'
    return response


SECTIONS = ('permissions', 'roles', 'role_permissions', 'field_permissions', 'role_data_scopes')

# Why a row of the file was not added. `unknown_reference`: the row names a role
# or permission that exists neither in the database nor in the file.
SKIP_ALREADY_EXISTS = 'already_exists'
SKIP_ADMIN_ONLY = 'admin_only'
SKIP_ROLE_FORBIDDEN = 'role_forbidden'
SKIP_UNKNOWN_REFERENCE = 'unknown_reference'
# A role data scope the API would refuse too: unknown resource or scope, DEFINE with no orgs, or ADMIN.
SKIP_INVALID = 'invalid'


GRANT_SECTIONS = ('role_permissions', 'field_permissions', 'role_data_scopes')


def _role_data_scope_rows():
    """``{(role, resource): (scope, [org codes, sorted])}`` for every live row of a live role."""
    rows = {}
    for row in RoleDataScope.objects.filter(role__is_deleted=False).select_related('role').prefetch_related('orgs'):
        rows[(row.role.name, row.resource)] = (row.scope, sorted(o.code for o in row.orgs.all()))
    return rows


def _snapshot():
    """The three tables an overwrite rewrites, as ``{natural key: values}``.

    The natural keys are the ones the merge itself uses for ``get_or_create``
    (role + permission / role + model + field / role + resource), so
    "the same entry before and after" means what the importer means by it. The
    values are what would differ if the entry were rebuilt with other content.
    """
    return {
        'role_permissions': {
            (role, codename): None  # a grant has no content beyond its key (数据范围 B7 dropped `conditions`)
            for role, codename in RolePermission.objects.values_list('role__name', 'permission__codename')
        },
        'field_permissions': {
            (role, model, field): (visible, read_only, editable)
            for role, model, field, visible, read_only, editable in FieldPermission.objects.values_list(
                'role__name', 'model_name', 'field_name', 'visible', 'read_only', 'editable')
        },
        'role_data_scopes': {key: (scope, tuple(codes)) for key, (scope, codes) in _role_data_scope_rows().items()},
    }


def _caller_role_names(user):
    """The roles whose grants, field rules and data scopes actually decide what
    ``user`` can do - the same answer ``check_permission`` and the field / row
    filters give, not the role column read naively.

    ADMIN bypasses all three (``check_permission``, ``FieldPermissionMixin``,
    ``DataScopeFilter``), so for ADMIN no stored row is "its own": the set is
    empty. Everyone else: the primary role plus live extra roles.
    """
    role = getattr(user, 'role', None)
    if not role or role == ADMIN_ROLE_NAME:
        return set()
    from apps.perm.checker import _live_extra_roles

    return {role, *_live_extra_roles(user)}


def _overwrite_outcome(before, after, user):
    """What an overwrite really did, from the tables before and after the merge.

    ``removed``: entries that existed and do not any more (before - after) - NOT
    the number deleted first. The importer deletes everything and rebuilds from
    the file, so rows the file carries again are not lost; "the file does not
    have N entries" is what the dialog says, and this is that N.
    ``created``: entries that did not exist before. ``updated``: entries that
    survive with different content.
    """
    removed, created, updated = {}, {}, 0
    gone = {}
    for section in GRANT_SECTIONS:
        b, a = before[section], after[section]
        gone[section] = set(b) - set(a)
        removed[section] = len(gone[section])
        created[section] = len(set(a) - set(b))
        updated += sum(1 for key in set(a) & set(b) if a[key] != b[key])
    removed['total'] = sum(removed[s] for s in GRANT_SECTIONS)
    mine = _caller_role_names(user) if user is not None else set()
    own = any(key[0] in mine for section in GRANT_SECTIONS for key in gone[section])
    return removed, created, updated, own


def import_permissions(data, overwrite=False, dry_run=False, user=None):
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
        user: the caller, for ``removes_own_permissions``.

    Returns:
        dict: per section ``{'created': n, 'skipped': n}``, plus
        ``skipped_details`` - ``[{'section', 'key', 'reason'}]`` for every
        row of the file that was not added. Also ``updated`` (roles whose
        labels changed, plus surviving entries whose content changed - always
        0 for a merge), ``removed`` (``{role_permissions, field_permissions,
        role_data_scopes, total}``: entries an overwrite leaves gone) and
        ``removes_own_permissions`` (a removed entry belongs to a role that
        decides what the caller may do). In an overwrite the three grant
        sections' ``created`` is the net: entries that did not exist before.
    """
    stats = {s: {'created': 0, 'skipped': 0} for s in SECTIONS}
    details = []
    role_labels_updated = []

    def made(section):
        stats[section]['created'] += 1

    def skip(section, key, reason):
        stats[section]['skipped'] += 1
        details.append({'section': section, 'key': key, 'reason': reason})

    removed = {s: 0 for s in GRANT_SECTIONS}
    removed['total'] = 0
    updated = 0
    own = False
    with transaction.atomic():
        before = _snapshot() if overwrite else None
        _merge(data, overwrite, made, skip, role_labels_updated)
        if overwrite:
            removed, created, grants_updated, own = _overwrite_outcome(before, _snapshot(), user)
            for section, n in created.items():
                stats[section]['created'] = n
            updated = len(role_labels_updated) + grants_updated
        if dry_run:
            transaction.set_rollback(True)

    stats['skipped_details'] = details
    stats['updated'] = updated
    stats['removed'] = removed
    stats['removes_own_permissions'] = own
    return stats


def _merge(data, overwrite, made, skip, role_labels_updated):
    if overwrite:
        FieldPermission.objects.all().delete()
        RoleDataScope.objects.all().delete()
        # ADMIN always has everything (`admin_always_all`, 2026-09-25): an
        # overwrite import whose file lacks an ADMIN row must not strip it.
        RolePermission.objects.exclude(role__name=ADMIN_ROLE_NAME).delete()

    # Import permissions. `revive_or_create`, not `get_or_create`: a binned
    # row with the same natural key comes back rather than gaining a twin.
    from apps.perm.services import grant_catalogue_defaults

    for perm_data in data.get('permissions', []):
        perm, created = Permission.revive_or_create(
            perm_data['codename'],
            name=perm_data['name'], category=perm_data['category'],
        )
        if created:
            # A catalogue codename's new row brings its default grants, or creating it would silently
            # revoke it from every default holder (rbac-be3 M-4). An overwrite then replaces them anyway.
            grant_catalogue_defaults(perm)
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
        role, created = Role.revive_or_create(role_data['name'], **labels)
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
            if not created:
                role_labels_updated.append(role.name)

    # Import role-permission assignments
    for rp_data in data.get('role_permissions', []):
        key = f"{rp_data['role']} / {rp_data['permission']}"
        role = Role.objects.filter(name=rp_data['role']).first()
        perm = Permission.objects.filter(codename=rp_data['permission']).first()
        if not (role and perm):
            skip('role_permissions', key, SKIP_UNKNOWN_REFERENCE)
        elif admin_only_violations(role.name, [perm.codename]):
            skip('role_permissions', key, SKIP_ADMIN_ONLY)
        elif role_forbidden_violations(
            role.name, [perm.codename],
            RolePermission.objects.filter(role=role).values_list('permission__codename', flat=True),
        ):
            skip('role_permissions', key, SKIP_ROLE_FORBIDDEN)
        else:
            _, created = RolePermission.objects.get_or_create(role=role, permission=perm)
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

    # Import role data scopes (数据范围 B4): the same refusals as PUT /perm/roles/<id>/data-scope/.
    from apps.org.models import Organization
    from apps.perm.data_scope import DEFINE
    from apps.perm.data_scope_api import SCOPES, resource_keys

    resources = set(resource_keys())
    for ds_data in data.get('role_data_scopes', []):
        resource = ds_data.get('resource', '')
        key = f"{ds_data['role']} / {resource or '*'}"
        codes = sorted(set(ds_data.get('orgs') or []))
        if ds_data['role'] == ADMIN_ROLE_NAME or (resource and resource not in resources) \
                or ds_data['scope'] not in SCOPES or (ds_data['scope'] == DEFINE and not codes):
            skip('role_data_scopes', key, SKIP_INVALID)
            continue
        role = Role.objects.filter(name=ds_data['role']).first()
        orgs = list(Organization.objects.filter(code__in=codes)) if ds_data['scope'] == DEFINE else []
        if not role or len(orgs) != (len(codes) if ds_data['scope'] == DEFINE else 0):
            skip('role_data_scopes', key, SKIP_UNKNOWN_REFERENCE)
            continue
        if RoleDataScope.objects.filter(role=role, resource=resource).exists():
            skip('role_data_scopes', key, SKIP_ALREADY_EXISTS)
            continue
        row = RoleDataScope.objects.create(role=role, resource=resource, scope=ds_data['scope'])
        row.orgs.set(orgs)
        made('role_data_scopes')
