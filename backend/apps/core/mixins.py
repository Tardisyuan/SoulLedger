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
        if tenant and hasattr(serializer.instance, 'tenant'):
            kwargs['tenant'] = tenant
        # Set create_user from AuditMixin
        if hasattr(serializer.instance, 'create_user'):
            kwargs['create_user'] = self.request.user
        serializer.save(**kwargs)
