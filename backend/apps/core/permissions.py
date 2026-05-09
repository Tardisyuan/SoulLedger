"""
DRF permission classes for SoulLedger multi-tenant isolation.
"""
from rest_framework import permissions


class TenantPermission(permissions.BasePermission):
    """
    Enforce tenant isolation at the DRF permission layer.

    - SYS_ADMIN (role='ADMIN') bypasses tenant checks (global read-only stats)
    - All other roles: resource tenant must match request tenant
    """

    def has_permission(self, request, view):
        # Allow unauthenticated requests to pass through (auth will handle it)
        if not request.user or not request.user.is_authenticated:
            return True

        # SYS_ADMIN bypasses tenant filtering (global access)
        if request.user.role == 'ADMIN':
            return True

        # Must have a tenant on the request (set by TenantMiddleware)
        return getattr(request, 'tenant', None) is not None

    def has_object_permission(self, request, view, obj):
        if not request.user or not request.user.is_authenticated:
            return False

        # SYS_ADMIN bypasses
        if request.user.role == 'ADMIN':
            return True

        tenant = getattr(request, 'tenant', None)
        if tenant is None:
            return False

        # Check if object has a tenant field
        obj_tenant = getattr(obj, 'tenant', None)
        if obj_tenant is None:
            return True  # No tenant field — allow

        return str(obj_tenant.pk) == str(tenant.pk)
