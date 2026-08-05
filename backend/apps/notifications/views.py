"""
Views for notifications.
"""
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import TenantPermission
from apps.core.viewsets import CodenameViewSetMixin
from apps.notifications.models import UserNotification
from apps.notifications.serializers import UserNotificationListSerializer, UserNotificationSerializer


class NotificationViewSet(CodenameViewSetMixin, viewsets.ModelViewSet):
    """
    ViewSet for user notifications.

    list: GET /api/v1/notifications/ - List user's notifications
    mark_read: POST /api/v1/notifications/{id}/mark_read/ - Mark single notification as read
    mark_all_read: POST /api/v1/notifications/mark_all_read/ - Mark all notifications as read
    """
    permission_classes = [TenantPermission]
    # BINARY on `notification.read`, the only notification codename that
    # exists. Not a CRUD family, and deliberately so: get_queryset() below
    # filters to `user=request.user`, so every action on this viewset — listing,
    # marking read, deleting — operates on the caller's own inbox and never on
    # anyone else's. The codename therefore means "may use my notification
    # inbox", not "may edit notifications", and one codename covers it.
    #
    # This replaces notification.create/update/delete, which existed nowhere
    # and were held by nobody, so mark_read was gated on a codename that could
    # only answer no.
    #
    # Follow-up for the lead, not fixed here: only ADMIN and MODERATOR hold
    # notification.read, so under enforcement JUDGE, GUARDIAN and VIEWER lose
    # their own inbox. That is already true of `list` today and this change
    # neither causes it nor widens it — but it is a grant that looks missing.
    permission_codename = "notification"
    extra_permissions = {
        'mark_read': ['notification.read'],
        'mark_all_read': ['notification.read'],
        'create': ['notification.read'],
        'update': ['notification.read'],
        'partial_update': ['notification.read'],
        'destroy': ['notification.read'],
    }
    serializer_class = UserNotificationSerializer
    # pagination_class = None  # Removed: paginate to prevent large payloads

    def get_serializer_class(self):
        if self.action == "list":
            return UserNotificationListSerializer
        return UserNotificationSerializer

    def get_queryset(self):
        """Return only the current user's notifications, tenant-scoped."""
        if not self.request.user.is_authenticated:
            return UserNotification.objects.none()

        qs = UserNotification.objects.filter(user=self.request.user).select_related("user")

        # Defense-in-depth: ensure user belongs to the current tenant
        tenant = getattr(self.request, "tenant", None)
        if tenant:
            qs = qs.filter(user__tenant=tenant)
        return qs

    @action(detail=True, methods=["post"])
    def mark_read(self, request, pk=None):
        """Mark a single notification as read."""
        notification = self.get_object()
        notification.is_read = True
        notification.save(update_fields=["is_read"])
        return Response(UserNotificationSerializer(notification).data)

    @action(detail=False, methods=["post"])
    def mark_all_read(self, request):
        """Mark all of the user's notifications as read."""
        updated = self.get_queryset().update(is_read=True)
        return Response({"marked_read": updated})
