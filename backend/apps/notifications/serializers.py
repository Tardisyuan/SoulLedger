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
        read_only_fields = [
            "id",
            "user",
            "created_at",
            # The body of a notification is written by whatever raised it, not
            # by its recipient. Measured 2026-08-29: a user could PATCH their
            # own notification's `title`, `message`, `notification_type`
            # (SYSTEM -> ROLE_ASSIGNED) and `related_resource`/`related_id`.
            # Only their own inbox is affected, but `related_resource` and
            # `related_id` drive the deep link, so a recipient could aim their
            # own notification at an arbitrary target. `is_read` stays writable
            # -- marking something read is the one thing a recipient does.
            "title",
            "message",
            "notification_type",
            "related_resource",
            "related_id",
        ]


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


class MarkAllReadResultSerializer(serializers.Serializer):
    """`{"marked_read": N}` — what `mark_all_read` returns.

    Schema-only, never instantiated. `N` counts rows the update touched, which
    is the number that were still unread, not the size of the caller's inbox.
    """

    marked_read = serializers.IntegerField()
