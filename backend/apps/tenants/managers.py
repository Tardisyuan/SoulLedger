"""
Context-variable tenant manager for automatic tenant filtering.

Usage:
    from apps.tenants.managers import TenantManager
    class MyModel(models.Model):
        objects = TenantManager()

Uses contextvars.ContextVar instead of threading.local to properly
support async contexts and Celery workers.
"""
import contextvars
from django.db import models

# Context variable for tenant (Celery-safe)
_tenant_var: contextvars.ContextVar[object] = contextvars.ContextVar('tenant', default=None)


def get_current_tenant():
    """Return the current context-variable tenant, or None if not set."""
    return _tenant_var.get()


def set_current_tenant(tenant):
    """Set the current context-variable tenant."""
    _tenant_var.set(tenant)


def clear_current_tenant():
    """Clear the current context-variable tenant."""
    _tenant_var.set(None)


class TenantManager(models.Manager):
    """
    Manager that automatically filters querysets by the current context-variable tenant.
    When no tenant is set, returns unfiltered queryset (admin/superuser bypass).
    """

    def get_queryset(self):
        qs = super().get_queryset()
        tenant = get_current_tenant()
        if tenant is not None:
            return qs.filter(tenant=tenant)
        return qs
