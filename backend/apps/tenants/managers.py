"""
Tenant context plumbing, and a manager that filters SOFT DELETES ONLY.

THE NAME LIES, AND THE DOCSTRING USED TO LIE WITH IT. This module's header read
"Context-variable tenant manager for automatic tenant filtering" until
2026-09-06, while `TenantManager.get_queryset` forty lines below has said the
opposite since it stopped filtering: it adds `is_deleted=False` and nothing
else. Tenant isolation lives entirely in the view layer, in
`apps.core.tenant.scope_to_tenant` — see that module's header for why.

The lie was load-bearing. `docs/ARCHITECTURE.md`, the root `AGENTS.md`, and
`apps/tenants/middleware.py` all repeated it, so anyone checking the claim
found three sources agreeing. A reader who trusts this name and writes a
ViewSet without `scope_to_tenant` gets a queryset with no isolation at all,
and every test that only exercises one tenant stays green.

Usage:
    from apps.tenants.managers import TenantManager
    class MyModel(models.Model):
        all_objects = models.Manager()   # unfiltered; declared first so it's _base_manager
        objects = TenantManager()        # soft-delete filtered; NOT tenant filtered

Uses contextvars.ContextVar instead of threading.local to properly
support async contexts and Celery workers. The contextvar exists so that
`apps/audit/signals.py` can attribute a write to a tenant — not so that
queries filter themselves.
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
        qs = super().get_queryset()
        if hasattr(self.model, 'is_deleted'):
            qs = qs.filter(is_deleted=False)
        return qs
