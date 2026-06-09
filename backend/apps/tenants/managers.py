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
    Manager for tenant-scoped models.

    NOTE: Tenant filtering is now handled exclusively by ViewSet mixins
    (DataScopeViewSetMixin, TenantQuerySetMixin) and service-layer code.
    This manager no longer applies implicit contextvar-based filtering,
    which caused stale state issues in pytest and class-level querysets.

    The set_current_tenant() / get_current_tenant() API is preserved for
    backward compatibility with WebSocket middleware and audit signals.
    """

    def get_queryset(self):
        # Tenant filtering is handled by ViewSet mixins, not by the manager.
        # This avoids stale contextvar filters on class-level queryset attributes.
        return super().get_queryset()
