"""
Views for notifications.
"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from apps.notifications.models import UserNotification
from apps.notifications.serializers import UserNotificationSerializer, UserNotificationListSerializer
from apps.core.viewsets import CodenameViewSetMixin


class NotificationViewSet(CodenameViewSetMixin, viewsets.ModelViewSet):
    """
    ViewSet for user notifications.

    list: GET /api/v1/notifications/ - List user's notifications
    mark_read: POST /api/v1/notifications/{id}/mark_read/ - Mark single notification as read
    mark_all_read: POST /api/v1/notifications/mark_all_read/ - Mark all notifications as read
    """
    permission_classes = [IsAuthenticated]
    permission_codename = "notification"
    extra_permissions = {
        'mark_read': ['notification.update'],
        'mark_all_read': ['notification.update'],
    }
    serializer_class = UserNotificationSerializer
    pagination_class = None

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