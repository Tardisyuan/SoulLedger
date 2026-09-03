"""
Audit serializers
"""
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import AuditLog


class AuditUserDetailsSerializer(serializers.Serializer):
    """The dict `AuditLogDetailSerializer.get_user_details` hand-builds.

    Schema-only, never instantiated. Without it the field is `string` in the
    OpenAPI document, and any generated client sees a string where an object is.

    `role` and `tenant` are nullable and `tenant` is the tenant **code**, not
    its id — `obj.tenant.code if obj.tenant else None`. Worth stating because
    every other `tenant` key in this API is an id.
    """

    id = serializers.IntegerField()
    username = serializers.CharField()
    role = serializers.CharField(allow_null=True)
    tenant = serializers.CharField(allow_null=True)


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
            "username", "tenant_code", "user_display", "trace_id",
            "create_user", "update_user", "create_time", "update_time",
        ]
        read_only_fields = ["id", "timestamp", "create_time", "update_time"]

    def get_user_display(self, obj) -> str:
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

    @extend_schema_field(AuditUserDetailsSerializer(allow_null=True))
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

    def get_is_batch_operation(self, obj) -> bool:
        """Check if this log entry is from a batch operation."""
        if obj.changes and isinstance(obj.changes, dict):
            return obj.changes.get("batch_operation", False)
        return False


class AuditActionOptionSerializer(serializers.Serializer):
    """One entry of `GET /audit-logs/actions/` — `AuditAction.choices` flattened.

    Schema-only, never instantiated. The view returns a list comprehension over
    `AuditAction.choices`, so `value` is the stored enum member and `label` its
    human-readable half.
    """

    value = serializers.CharField()
    label = serializers.CharField()


class AuditActionCountSerializer(serializers.Serializer):
    """One row of `stats.action_distribution` — a `values("action").annotate(count=…)`."""

    action = serializers.CharField()
    count = serializers.IntegerField()


class AuditResourceCountSerializer(serializers.Serializer):
    """One row of `stats.top_resources` — the same shape keyed by resource.

    Kept separate from `AuditActionCountSerializer` rather than generalised to
    `{name, count}`: the key really is `action` in one and `resource` in the
    other, and a client reading `name` would get `undefined` from both.
    """

    resource = serializers.CharField()
    count = serializers.IntegerField()


class AuditStatsSerializer(serializers.Serializer):
    """The dict `AuditLogViewSet.stats` hand-builds.

    Schema-only. `top_resources` is capped at 20 rows by the view;
    `action_distribution` is not capped, because the action set is an enum.
    """

    action_distribution = AuditActionCountSerializer(many=True)
    top_resources = AuditResourceCountSerializer(many=True)
    total_logs = serializers.IntegerField()
