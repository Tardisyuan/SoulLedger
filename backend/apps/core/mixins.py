"""
Core mixins for ViewSets.
"""


class TenantQuerySetMixin:
    """
    Mixin that provides tenant isolation for ViewSets.
    Filters queryset by tenant from request, unless user is ADMIN.
    """

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not user.is_authenticated:
            return qs.none()
        if user.role == "ADMIN":
            return qs
        # Some models this mixin is applied to (e.g. Organization) have no
        # `tenant` field at all — they're global reference/hierarchy data,
        # not per-tenant rows. Filtering unconditionally on `tenant=` used
        # to raise FieldError for every non-ADMIN request against them.
        # Mirror the hasattr(model, "tenant") guard TenantCreateMixin
        # already uses below, so a model without the field is simply left
        # unscoped rather than blowing up the request.
        if not hasattr(qs.model, "tenant"):
            return qs
        tenant = getattr(self.request, "tenant", None)
        if tenant:
            return qs.filter(tenant=tenant)
        return qs.none()


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
