"""
ViewSet mixins for SoulLedger.
"""
from rest_framework import viewsets
from apps.core.request_local import set_current_user, set_current_request, clear_current_user


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
    Mixin that auto-generates _required_permissions for PermissionMiddleware.

    Subclasses set `permission_codename` (e.g. "soul") and the mixin builds
    codenames like "soul.read", "soul.create" from the current DRF action.

    Custom actions are mapped via `extra_permissions` dict:
        extra_permissions = {
            'die': ['soul.die'],
            'karma': ['soul.read'],
        }

    PermissionMiddleware calls get_required_permissions() when _required_permissions
    is not set, so no DRF dispatch() timing issues.
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
    Mixin that applies RowLevelDataScope filtering to get_queryset().

    Calls super().get_queryset() first (preserving tenant filtering from
    TenantQuerySetMixin or manual logic), then applies DataScopeFilter.

    ADMIN bypasses data scope filtering (handled by DataScopeFilter.filter_queryset).
    Unauthenticated users get empty queryset.
    """

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not user.is_authenticated:
            return qs.none()
        if getattr(user, 'role', None) == 'ADMIN':
            return qs
        from apps.perm.filters import DataScopeFilter
        return DataScopeFilter.filter_queryset(self.request, qs, self.queryset.model)


class AuditUserViewSetMixin:
    """
    Mixin that sets thread-local user context before create/update operations.

    This ensures AuditUserFields.save() can access the current authenticated user
    even when using DRF's force_authenticate() in tests.
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
