"""
Serializers for notifications.
"""
from rest_framework import serializers

from apps.notifications.models import UserNotification


class UserNotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserNotification
        fields = [
            "id",
            "user",
            "title",
            "message",
            "notification_type",
            "is_read",
            "related_resource",
            "related_id",
            "created_at",
        ]
        # `user` stays read-only from the client's perspective: it is always
        # forced to request.user by NotificationViewSet.perform_create, never
        # taken from the payload. See that method for why self-notify only.
        read_only_fields = ["id", "user", "created_at"]


class UserNotificationListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing notifications."""

    class Meta:
        model = UserNotification
        fields = [
            "id",
            "title",
            "message",
            "notification_type",
            "is_read",
            "related_resource",
            "related_id",
            "created_at",
        ]
