"""
DRF permission classes for SoulLedger multi-tenant isolation.
"""
from rest_framework import permissions


class TenantPermission(permissions.BasePermission):
    """
    Enforce tenant isolation at the DRF permission layer.

    - IsAuthenticated: unauthenticated requests are rejected (401)
    - SYS_ADMIN (role='ADMIN') bypasses tenant filtering (global read)
    - All other authenticated users: request must have a valid tenant
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False  # Reject unauthenticated — let DRF's 401 take over

        # SYS_ADMIN bypasses tenant filtering (global access)
        if getattr(request.user, 'role', None) == 'ADMIN':
            return True

        # Must have a tenant on the request (set by TenantMiddleware)
        return getattr(request, 'tenant', None) is not None

    def has_object_permission(self, request, view, obj):
        if not request.user or not request.user.is_authenticated:
            return False

        # SYS_ADMIN bypasses
        if getattr(request.user, 'role', None) == 'ADMIN':
            return True

        tenant = getattr(request, 'tenant', None)
        if tenant is None:
            return False

        # Check if object has a tenant field
        obj_tenant = getattr(obj, 'tenant', None)
        if obj_tenant is None:
            return True  # No tenant field — allow

        return str(obj_tenant.pk) == str(tenant.pk)


class IsAdminPermission(permissions.BasePermission):
    """
    Permission class that only allows ADMIN role users.
    Use this for admin-only endpoints like user management, role management.
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return getattr(request.user, 'role', None) == 'ADMIN'

    def has_object_permission(self, request, view, obj):
        return getattr(request.user, 'role', None) == 'ADMIN'


def admin_required(view_func):
    """
    Decorator for function-based views that requires ADMIN role.
    Use for @api_view decorated endpoints that need admin check.
    """
    def wrapper(request, *args, **kwargs):
        if getattr(request, 'user', None) is None:
            from rest_framework.exceptions import NotAuthenticated
            raise NotAuthenticated()
        if getattr(request.user, 'role', None) != 'ADMIN':
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Admin access required")
        return view_func(request, *args, **kwargs)
    return wrapper


def user_has_permission(user, codename):
    """
    Check if a user has a specific permission codename.

    Uses the same logic as PermissionMiddleware._has_permission:
    1. ADMIN always has all permissions
    2. Check DB (Permission + RolePermission) if seeded
    3. Fallback to ROLE_PERMISSIONS dict

    Args:
        user: Django User instance
        codename: Permission codename string (e.g., "soul.read")

    Returns:
        True if user has the permission, False otherwise
    """
    if not user or not user.is_authenticated:
        return False

    role = getattr(user, 'role', None)
    if not role:
        return False

    # ADMIN bypasses all permission checks
    if role == 'ADMIN':
        return True

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
            return RolePermission.objects.filter(
                role=role,
                permission__codename=codename
            ).exists()
        except Exception:
            pass

    # Fallback to ROLE_PERMISSIONS dict (unseeded codenames)
    from apps.perm.models import ROLE_PERMISSIONS
    return codename in ROLE_PERMISSIONS.get(role, [])
