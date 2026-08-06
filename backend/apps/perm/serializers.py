"""
Permission serializers
"""
from rest_framework import serializers

from .models import Permission, Role, RolePermission


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["id", "codename", "name", "category"]


class PermissionCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["codename", "name", "category"]

    def validate_codename(self, value):
        if not value.replace(".", "").replace("_", "").isalnum():
            raise serializers.ValidationError(
                "codename must contain only letters, digits, dots, and underscores"
            )
        return value


class RolePermissionSerializer(serializers.ModelSerializer):
    permission = PermissionSerializer(read_only=True)

    class Meta:
        model = RolePermission
        fields = ["id", "role", "permission"]


class RolePermissionAssignSerializer(serializers.Serializer):
    role = serializers.CharField(max_length=20)
    permission_ids = serializers.ListField(
        child=serializers.IntegerField(), allow_empty=True
    )
    # Optional so existing callers keep working unchanged. When present,
    # assign_role_permissions rejects the call with 409 if it doesn't match
    # the role's current `version` — the Stage 7 permissions-matrix screen's
    # stale-write guard: two admins editing the same role's grants at once,
    # and the replace-not-diff semantics of this endpoint mean the second
    # save silently reverts the first rather than conflicting visibly.
    expected_version = serializers.IntegerField(required=False)


class RoleSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source='organization.name', read_only=True)
    # How many users this role's name is currently assigned to
    # (User.role is a plain CharField, not a FK to Role — no join needed).
    # Exists for the Stage 7 permissions-matrix screen's save-confirmation
    # guard: "N users are affected" is what turns a grant/removal from an
    # abstract diff into a consequence worth reading before confirming.
    user_count = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = [
            "id", "name", "display_name", "scope", "organization", "organization_name",
            "user_count", "version", "update_time",
        ]
        read_only_fields = ["version", "update_time"]

    def get_user_count(self, obj):
        from apps.authentication.models import User
        return User.objects.filter(role=obj.name, is_active=True).count()


class RoleCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ["name", "display_name", "scope", "organization"]

    def validate_name(self, value):
        # Only allow uppercase letters and underscores
        if not value.replace("_", "").isalpha():
            raise serializers.ValidationError(
                "Role name must contain only letters and underscores"
            )
        return value.upper()
