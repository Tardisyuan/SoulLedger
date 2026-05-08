"""
Thread-local tenant manager for automatic tenant filtering.

Usage:
    from apps.tenants.managers import TenantManager
    class MyModel(models.Model):
        objects = TenantManager()
"""
import threading
from django.db import models

_tenant_local = threading.local()


def get_current_tenant():
    """Return the current thread-local tenant, or None if not set."""
    return getattr(_tenant_local, 'tenant', None)


def set_current_tenant(tenant):
    """Set the current thread-local tenant."""
    _tenant_local.tenant = tenant


def clear_current_tenant():
    """Clear the current thread-local tenant."""
    if hasattr(_tenant_local, 'tenant'):
        del _tenant_local.tenant


class TenantManager(models.Manager):
    """
    Manager that automatically filters querysets by the current thread-local tenant.
    When no tenant is set, returns unfiltered queryset (admin/superuser bypass).
    """

    def get_queryset(self):
        qs = super().get_queryset()
        tenant = get_current_tenant()
        if tenant is not None:
            return qs.filter(tenant=tenant)
        return qs
