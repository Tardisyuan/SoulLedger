"""
Core mixins for ViewSets.
"""
from apps.core.tenant import scope_to_tenant


class TenantQuerySetMixin:
    """
    Mixin that provides tenant isolation for ViewSets.
    Filters queryset by tenant from request, unless user is ADMIN.

    The scoping itself lives in apps/core/tenant.py — see that module for why
    it is not inlined here.
    """

    def get_queryset(self):
        # missing_field="allow": some models this mixin is applied to (e.g.
        # Organization) have no `tenant` field at all — they're global
        # reference/hierarchy data, not per-tenant rows. Filtering
        # unconditionally on `tenant=` used to raise FieldError for every
        # non-ADMIN request against them, so a model without the field is
        # left unscoped rather than blowing up the request.
        return scope_to_tenant(super().get_queryset(), self.request, missing_field="allow")


class TenantCreateMixin:
    """
    Mixin that automatically sets tenant on create.
    Use together with TenantQuerySetMixin.
    """

    def perform_create(self, serializer):
        kwargs = {}
        # Set tenant from request
        tenant = getattr(self.request, "tenant", None)
        # During create, serializer.instance is None, so check the model class
        model = getattr(serializer.Meta, "model", None)
        if tenant and model and hasattr(model, "tenant"):
            kwargs["tenant"] = tenant
        # Set create_user from AuditMixin
        if model and hasattr(model, "create_user"):
            kwargs["create_user"] = self.request.user
        serializer.save(**kwargs)
