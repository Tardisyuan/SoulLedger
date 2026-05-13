"""
Audit serializers
"""
from rest_framework import serializers
from .models import AuditLog, AuditAction


class AuditLogSerializer(serializers.ModelSerializer):
    """Basic audit log serializer for list view."""
    username = serializers.CharField(source="user.username", read_only=True, allow_null=True)
    tenant_code = serializers.CharField(source="tenant.code", read_only=True, allow_null=True)
    user_display = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            "id", "action", "resource", "resource_id", "changes",
            "ip_address", "user_agent", "description", "timestamp",
            "username", "tenant_code", "user_display",
            "create_user", "update_user", "create_time", "update_time",
        ]
        read_only_fields = ["id", "timestamp", "create_time", "update_time"]

    def get_user_display(self, obj):
        """Return user display name or 'System' for anonymous."""
        if obj.user:
            return obj.user.username
        return "System"


class AuditLogDetailSerializer(AuditLogSerializer):
    """Detailed audit log serializer for retrieve view."""
    user_details = serializers.SerializerMethodField()
    is_batch_operation = serializers.SerializerMethodField()

    class Meta(AuditLogSerializer.Meta):
        fields = AuditLogSerializer.Meta.fields + [
            "user_details", "is_batch_operation",
        ]

    def get_user_details(self, obj):
        """Return detailed user information."""
        if obj.user:
            return {
                "id": obj.user.id,
                "username": obj.user.username,
                "role": getattr(obj.user, 'role', None),
                "tenant": obj.tenant.code if obj.tenant else None,
            }
        return None

    def get_is_batch_operation(self, obj):
        """Check if this log entry is from a batch operation."""
        if obj.changes and isinstance(obj.changes, dict):
            return obj.changes.get("batch_operation", False)
        return False
