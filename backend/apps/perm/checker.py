"""
Unified permission checking for SoulLedger.

Single source of truth for all permission evaluation.
All permission checks (middleware, mixin, decorator, view) should use this module.

Design:
- ADMIN bypass (role='ADMIN' → always True)
- DB lookup (Permission + RolePermission) for seeded codenames
- ROLE_PERMISSIONS dict fallback for unseeded codenames
- Redis-backed caching with memory fallback
"""
from apps.perm.cache import get_permission_cache

_permission_cache = get_permission_cache()


def check_permission(user, codename):
    """
    Check if a user has a specific permission codename.

    Priority: cache → DB (Permission + RolePermission) → ROLE_PERMISSIONS dict.

    Args:
        user: Django User instance (or None for unauthenticated)
        codename: Permission codename string (e.g., "soul.read")

    Returns:
        True if user has the permission, False otherwise
    """
    if not user or not getattr(user, 'is_authenticated', False):
        return False

    role = getattr(user, 'role', None)
    if not role:
        return False

    # ADMIN bypasses all permission checks
    if role == 'ADMIN':
        return True

    # Check cache first
    cached = _permission_cache.get(role, codename)
    if cached is not None:
        return cached

    # Imported here rather than at module scope: this module is pulled in from
    # middleware and DRF permission classes, and apps.perm.models must not be
    # touched before the app registry is ready.
    from apps.perm.models import ROLE_PERMISSIONS, Permission, RolePermission

    if Permission.objects.filter(codename=codename).exists():
        # DB is authoritative for seeded codenames.
        #
        # `role` is the role NAME string carried on the user (User.role), not a
        # Role instance, so the join has to go through Role.name. Filtering
        # `role=role` fed a string into the FK's id column, which raised
        # ValueError("Field 'id' expected a number but got 'VIEWER'") on every
        # single call — and the bare `except Exception` that used to sit here
        # caught it and answered from ROLE_PERMISSIONS instead. The effect was
        # that this branch never decided anything: no row in RolePermission has
        # ever granted a permission, and no revocation has ever taken one away.
        #
        # Nothing is caught here on purpose. Neither .exists() call can raise a
        # model DoesNotExist — that only comes from .get() — so anything they do
        # raise is a database or programming fault, and answering a permission
        # question from a stale dict while the database is unreachable is how
        # this stayed invisible for months. Let it surface.
        #
        # Note the consequence for a role with no Role row at all: it matches
        # nothing and is denied every seeded codename, whatever the dict says.
        # That is the correct DB answer, but it means the grant tables must be
        # seeded for a role before this can be relied on.
        has_perm = RolePermission.objects.filter(
            role__name=role,
            permission__codename=codename,
        ).exists()
    else:
        # Fallback to ROLE_PERMISSIONS dict (unseeded codenames)
        has_perm = codename in ROLE_PERMISSIONS.get(role, [])

    # Cache the result
    _permission_cache.set(role, codename, has_perm)
    return has_perm


def check_permissions(user, codenames, require_all=True):
    """
    Check if a user has multiple permission codenames.

    Args:
        user: Django User instance
        codenames: List of permission codename strings
        require_all: If True, user must have ALL permissions. If False, ANY is sufficient.

    Returns:
        True if user has the required permissions, False otherwise
    """
    if require_all:
        return all(check_permission(user, cod) for cod in codenames)
    return any(check_permission(user, cod) for cod in codenames)


# Backward-compatible alias for existing code
user_has_permission = check_permission
