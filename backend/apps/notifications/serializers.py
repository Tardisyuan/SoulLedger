"""
Serializers for notifications.
"""
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.core.locale import locale_from_context
from apps.notifications import messages
from apps.notifications.models import UserNotification


class RequestContextSerializer(serializers.Serializer):
    """「第五殿 · 殿司 · 近 24 小时第 1 次」:一条求助通知里请求者账号的殿、角色,
    与这次请求在该账号近 24 小时求助里的序号。"""

    hall = serializers.CharField(allow_null=True)
    role = serializers.CharField()
    count_24h = serializers.IntegerField()


class _LocalizedMixin:
    """分语言的类型按请求语言重渲染 title / message(见 `apps/notifications/messages.py`)。
    请求的语言不是三种之一,或行上没有 params(旧行),就返回存下来的原文。

    `request_context`:求助类通知(`authentication.tasks.notify_password_help`)的那一行
    上下文;别的通知与旧行为 null。殿名按请求语言取。"""

    @extend_schema_field(RequestContextSerializer(allow_null=True))
    def get_request_context(self, instance):
        params = instance.params or {}
        if "count_24h" not in params:
            return None
        halls = params.get("hall") or {}
        locale = locale_from_context(self.context)
        return {
            "hall": halls.get(locale) or halls.get(messages.DEFAULT_LOCALE),
            "role": params.get("role", ""),
            "count_24h": params["count_24h"],
        }

    def to_representation(self, instance):
        data = super().to_representation(instance)
        kind = messages.kind_for(instance.notification_type, instance.params)
        locale = locale_from_context(self.context)
        if kind and instance.params and locale in messages.MESSAGES:
            data["title"], data["message"] = messages.render(locale, kind, instance.params)
        return data


class UserNotificationSerializer(_LocalizedMixin, serializers.ModelSerializer):
    request_context = serializers.SerializerMethodField()

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
            "request_context",
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


class UserNotificationListSerializer(_LocalizedMixin, serializers.ModelSerializer):
    """Lightweight serializer for listing notifications."""

    request_context = serializers.SerializerMethodField()

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
            "request_context",
        ]


class MarkAllReadResultSerializer(serializers.Serializer):
    """`{"marked_read": N}` — what `mark_all_read` returns.

    Schema-only, never instantiated. `N` counts rows the update touched, which
    is the number that were still unread, not the size of the caller's inbox.
    """

    marked_read = serializers.IntegerField()
