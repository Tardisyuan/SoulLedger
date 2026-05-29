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

    # Check if permission exists in DB (seeded)
    try:
        from apps.perm.models import Permission
        perm_exists = Permission.objects.filter(codename=codename).exists()
    except Exception:
        perm_exists = False

    if perm_exists:
        # DB is authoritative for seeded codenames
        try:
            from apps.perm.models import RolePermission
            has_perm = RolePermission.objects.filter(
                role=role,
                permission__codename=codename
            ).exists()
        except Exception:
            from apps.perm.models import ROLE_PERMISSIONS
            has_perm = codename in ROLE_PERMISSIONS.get(role, [])
    else:
        # Fallback to ROLE_PERMISSIONS dict (unseeded codenames)
        from apps.perm.models import ROLE_PERMISSIONS
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
