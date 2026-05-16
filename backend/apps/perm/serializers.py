"""
Permission serializers
"""
from rest_framework import serializers
from .models import Permission, RolePermission, Role


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


class RoleSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source='organization.name', read_only=True)

    class Meta:
        model = Role
        fields = ["id", "name", "display_name", "scope", "organization", "organization_name"]


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
