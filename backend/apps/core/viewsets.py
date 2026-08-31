"""
ViewSet mixins for SoulLedger.
"""
from apps.core.request_local import clear_current_user, set_current_request, set_current_user
from apps.core.tenant import is_tenant_exempt, scope_to_tenant

# Standard DRF action → permission codename suffix mapping
ACTION_PERM_MAP = {
    'list': 'read',
    'retrieve': 'read',
    'create': 'create',
    'update': 'update',
    'partial_update': 'update',
    'destroy': 'delete',
}


class CodenameViewSetMixin:
    """
    Mixin that auto-generates the codenames a request must carry.

    Subclasses set `permission_codename` (e.g. "soul") and the mixin builds
    codenames like "soul.read", "soul.create" from the current DRF action.

    Custom actions are mapped via `extra_permissions` dict:
        extra_permissions = {
            'die': ['soul.die'],
            'karma': ['soul.read'],
        }

    `apps/core/permissions.py::CodenamePermission` calls
    get_required_permissions() from `APIView.initial()`. It has to be there
    and not in middleware: the answer depends on `self.action`, which DRF sets
    in `initialize_request()` — inside `dispatch()`. The `PermissionMiddleware`
    this docstring used to name ran in the request phase, read a
    `request.view` attribute nothing sets, and took its `view is None` early
    return on every request ever made. It was deleted 2026-08-28.
    """
    permission_codename = None
    extra_permissions = {}

    def get_required_permissions(self):
        """Return list of codenames for the current action."""
        if not self.permission_codename:
            return []

        action = getattr(self, 'action', None)
        if action is None:
            return []

        # Check custom action mappings first
        if action in self.extra_permissions:
            return self.extra_permissions[action]

        # Map standard DRF actions to permission suffixes
        suffix = ACTION_PERM_MAP.get(action)
        if suffix:
            return [f"{self.permission_codename}.{suffix}"]

        # Unknown action — deny by default (safer than permissive)
        return [f"{self.permission_codename}.{action}"]


class DataScopeViewSetMixin:
    """
    Mixin that provides tenant isolation + RowLevelDataScope filtering.

    Combines TenantQuerySetMixin logic (tenant filtering, ADMIN bypass)
    with DataScopeFilter (row-level data scope rules).

    ViewSets using this mixin do NOT need TenantQuerySetMixin or manual
    tenant filtering in get_queryset().
    """

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not user.is_authenticated:
            return qs.none()
        # ADMIN bypasses both tenant filtering and data scope, so it returns
        # before the data-scope pass below rather than going through
        # scope_to_tenant's own admin_bypass.
        if is_tenant_exempt(user):
            return qs
        # Tenant isolation — see apps/core/tenant.py.
        qs = scope_to_tenant(qs, self.request)
        # Data scope filtering
        from apps.perm.filters import DataScopeFilter
        return DataScopeFilter.filter_queryset(self.request, qs, self.queryset.model)


class AuditUserViewSetMixin:
    """Set the current-user contextvar around every write.

    A `contextvar` (`apps/core/request_local.py`), not thread-local — the
    distinction matters under ASGI, where one thread serves many requests.

    **This is the only place that sets it.** `AuditUserFields.save()` reads it
    to fill `create_user` / `update_user`, so a writable viewset that does not
    inherit this mixin records rows with no author — measured on eight of them
    2026-08-29, including `ExternalApiKeyViewSet` and `WebhookViewSet`, where
    "who added this" is the whole of the audit question.
    `tests/test_every_writable_audit_viewset_sets_the_user.py` walks the real
    URLconf so the next one to be added is caught rather than counted.
    """

    def perform_create(self, serializer):
        """Set thread-local user before creating."""
        set_current_user(self.request.user)
        set_current_request(self.request)
        try:
            super().perform_create(serializer)
        finally:
            clear_current_user()

    def perform_update(self, serializer):
        """Set thread-local user before updating."""
        set_current_user(self.request.user)
        set_current_request(self.request)
        try:
            super().perform_update(serializer)
        finally:
            clear_current_user()

    def perform_destroy(self, instance):
        """Set thread-local user before deleting."""
        set_current_user(self.request.user)
        set_current_request(self.request)
        try:
            super().perform_destroy(instance)
        finally:
            clear_current_user()
