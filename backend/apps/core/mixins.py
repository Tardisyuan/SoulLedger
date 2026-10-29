"""
Core mixins for ViewSets.
"""
from apps.core.tenant import residence_read_allowed, scope_to_tenant


class TenantQuerySetMixin:
    """
    Mixin that provides tenant isolation for ViewSets.
    Filters queryset by tenant from request, unless user is ADMIN.

    The scoping itself lives in apps/core/tenant.py — see that module for why
    it is not inlined here.
    """

    #: 模型没有 `tenant` 列时怎么办(rbac-scope 第 15 条,2026-10-29 起默认 "error"):
    #: "error" 抛 ImproperlyConfigured —— 套了租户隔离却无从隔离是配置错,不该静默放行;
    #: "allow" 不过滤(真正的全局表,显式写在视图上);"deny" 返回空。
    #: 改默认那天六个使用者(Disposition / Organization / Judgment / Statute / WorkflowTemplate /
    #: ApprovalWorkflow)都有 `tenant` 列,没有依赖 "allow" 的。Organization 当年没有列,才有了旧默认。
    tenant_missing_field = "error"

    def get_queryset(self):
        qs = super().get_queryset()
        missing = self.tenant_missing_field
        if missing == "error":
            from django.core.exceptions import FieldDoesNotExist, ImproperlyConfigured

            try:
                qs.model._meta.get_field("tenant")
            except FieldDoesNotExist:
                raise ImproperlyConfigured(
                    f"{type(self).__name__} uses TenantQuerySetMixin but {qs.model.__name__} has no `tenant` field; "
                    f"set tenant_missing_field = 'allow' (global table) or 'deny'."
                ) from None
            missing = "deny"
        return scope_to_tenant(
            qs, self.request, missing_field=missing,
            residence_read=residence_read_allowed(self),
        )


class TenantCreateMixin:
    """
    Mixin that automatically sets tenant on create.
    Use together with TenantQuerySetMixin.
    """

    def create_tenant(self, serializer):
        """The tenant the new row is filed under: the request's. A viewset whose row belongs where a related row
        lives overrides this (judgment / disposition take the soul's hall, rbac-be1 M4)."""
        return getattr(self.request, "tenant", None)

    def perform_create(self, serializer):
        kwargs = {}
        tenant = self.create_tenant(serializer)
        # During create, serializer.instance is None, so check the model class
        model = getattr(serializer.Meta, "model", None)
        if tenant and model and hasattr(model, "tenant"):
            kwargs["tenant"] = tenant
        # Set create_user from AuditMixin
        if model and hasattr(model, "create_user"):
            kwargs["create_user"] = self.request.user
        serializer.save(**kwargs)
