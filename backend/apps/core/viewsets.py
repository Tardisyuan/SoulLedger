"""
ViewSet mixins for SoulLedger.
"""
from rest_framework import viewsets
from apps.core.request_local import set_current_user, set_current_request, clear_current_user


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
