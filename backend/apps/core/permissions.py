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
