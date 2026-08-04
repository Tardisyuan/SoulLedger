"""
Auth serializers: register, login, user profile.
"""
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

User = get_user_model()


# ---------------------------------------------------------------------------
# Role privilege ranking — guards role assignment in the user-management API
# (UserCreateSerializer, UserUpdateSerializer, UserViewSet.assign_roles).
#
# Lower rank = more privileged. Mirrors the breadth of
# apps.perm.models.ROLE_PERMISSIONS (MODERATOR is tenant/realm-scoped but
# nearly as broad as ADMIN within its own tenant, so it ranks just under
# ADMIN). A role missing from this dict — including one not yet wired into
# UserRole.choices — ranks below VIEWER so an unrecognized caller role can
# never be used to escalate anything.
# ---------------------------------------------------------------------------
ROLE_HIERARCHY = {
    "ADMIN": 0,
    "MODERATOR": 10,
    "JUDGE": 20,
    "GUARDIAN": 30,
    "VIEWER": 40,
}
_UNRANKED_ROLE = 999


def role_rank(role):
    """Return the privilege rank for `role` (lower = more privileged)."""
    return ROLE_HIERARCHY.get(role, _UNRANKED_ROLE)


class TenantInfoSerializer(serializers.Serializer):
    """Nested tenant info in login response."""
    code = serializers.CharField()
    display_name = serializers.CharField()


class UserWithTenantSerializer(serializers.ModelSerializer):
    """User serializer with tenant info + role permissions for login response."""
    tenant = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "role", "tenant", "display_name", "permissions"]

    def get_tenant(self, obj):
        if obj.tenant:
            return {"code": obj.tenant.code, "display_name": obj.tenant.display_name}
        return None

    def get_permissions(self, obj):
        """Get permissions based on rbac_role (preferred) or legacy role field."""
        from apps.perm.models import ROLE_PERMISSIONS, RolePermission
        # Prefer rbac_role FK if set
        if obj.rbac_role_id:
            return list(
                RolePermission.objects.filter(role=obj.rbac_role)
                .select_related("permission")
                .values_list("permission__codename", flat=True)
            )
        # Fallback: query by role name
        if RolePermission.objects.exists():
            return list(
                RolePermission.objects.filter(role__name=obj.role)
                .select_related("permission")
                .values_list("permission__codename", flat=True)
            )
        return ROLE_PERMISSIONS.get(obj.role, [])


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Add tenant info to JWT + response."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        if user.tenant:
            token["tenant_code"] = user.tenant.code
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        user = self.user
        data["user"] = UserWithTenantSerializer(user).data
        return data


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(
        write_only=True,
        required=True,
        style={"input_type": "password"},
    )

    class Meta:
        model = User
        # FIX: removed 'role' — role is always set to VIEWER on creation
        # this prevents mass assignment of privileged roles during registration
        fields = ["username", "email", "password", "first_name", "last_name"]

    def validate_password(self, value):
        validate_password(value)
        return value

    def create(self, validated_data):
        # role is always VIEWER on registration — never user-controlled
        validated_data.pop("role", None)
        user = User.objects.create_user(
            username=validated_data["username"],
            email=validated_data.get("email", ""),
            password=validated_data["password"],
            role="VIEWER",  # always VIEWER on self-registration
            first_name=validated_data.get("first_name", ""),
            last_name=validated_data.get("last_name", ""),
        )
        return user


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "email", "role", "first_name", "last_name", "is_active", "display_name", "organization", "position"]
        read_only_fields = ["id", "is_active", "username", "role"]


# ---------------------------------------------------------------------------
# User Management API Serializers (Tenant Admin)
# ---------------------------------------------------------------------------


class UserManagementSerializer(serializers.ModelSerializer):
    """User serializer for list/retrieve operations in user management API."""
    tenant = serializers.SerializerMethodField()
    organization = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'role', 'tenant', 'organization', 'position', 'is_active', 'create_time', 'avatar']
        read_only_fields = ['id', 'create_time']

    def get_tenant(self, obj):
        if obj.tenant:
            return {"id": obj.tenant.id, "code": obj.tenant.code, "display_name": obj.tenant.display_name}
        return None

    def get_organization(self, obj):
        if obj.organization:
            return {"id": obj.organization.id, "code": obj.organization.code, "name": obj.organization.name}
        return None


class UserCreateSerializer(serializers.ModelSerializer):
    """User serializer for creation with password handling.

    Non-ADMIN callers are constrained two ways (see ROLE_HIERARCHY above):
    - `tenant` is forced to the caller's own tenant — a client-supplied
      value for another tenant is rejected rather than silently honored.
    - `role` can never be more privileged than the caller's own role, which
      is what blocks a non-ADMIN from creating an ADMIN account (themselves
      or anyone else).
    ADMIN keeps its existing unrestricted behavior (any tenant, any role).
    """
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'password', 'role', 'tenant', 'organization', 'position', 'is_active']

    def validate(self, attrs):
        request = self.context.get('request')
        caller = getattr(request, 'user', None) if request is not None else None
        caller_role = getattr(caller, 'role', None)

        if caller_role != 'ADMIN':
            caller_tenant = getattr(request, 'tenant', None) if request is not None else None
            target_tenant = attrs.get('tenant')
            if target_tenant is None:
                if caller_tenant is None:
                    raise serializers.ValidationError(
                        {'tenant': 'No tenant context available for this request.'}
                    )
                attrs['tenant'] = caller_tenant
            elif target_tenant != caller_tenant:
                raise serializers.ValidationError(
                    {'tenant': 'Cannot create a user in another tenant.'}
                )

            target_role = attrs.get('role', 'VIEWER')
            if role_rank(caller_role) > role_rank(target_role):
                raise serializers.ValidationError(
                    {'role': 'Cannot assign a role more privileged than your own.'}
                )

        return attrs

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class UserUpdateSerializer(serializers.ModelSerializer):
    """User serializer for updates (email, role, is_active, organization, position).

    `tenant` is deliberately not in `fields` — a user's tenant can't be
    changed through this path at all, by ADMIN or otherwise.
    """

    class Meta:
        model = User
        fields = ['email', 'role', 'is_active', 'organization', 'position']

    def validate_role(self, value):
        request = self.context.get('request')
        caller = getattr(request, 'user', None) if request is not None else None
        caller_role = getattr(caller, 'role', None)
        if caller_role != 'ADMIN' and role_rank(caller_role) > role_rank(value):
            raise serializers.ValidationError(
                'Cannot assign a role more privileged than your own.'
            )
        return value


class ChangePasswordSerializer(serializers.Serializer):
    """Serializer for changing password with old password verification."""
    old_password = serializers.CharField(write_only=True, required=True)
    new_password = serializers.CharField(write_only=True, required=True, min_length=8)

    def validate_old_password(self, value):
        user = self.context['request'].user
        if not user.check_password(value):
            raise serializers.ValidationError("旧密码不正确")
        return value

    def validate_new_password(self, value):
        if len(value) < 8:
            raise serializers.ValidationError("密码至少8位")
        return value


class ResetPasswordSerializer(serializers.Serializer):
    """Serializer for requesting password reset."""
    email = serializers.EmailField()


class SetNewPasswordSerializer(serializers.Serializer):
    """Serializer for setting new password via code."""
    email = serializers.EmailField()
    code = serializers.CharField(min_length=6, max_length=6)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_code(self, value):
        """Ensure code is exactly 6 digits."""
        if not value.isdigit() or len(value) != 6:
            raise serializers.ValidationError("验证码必须是6位数字")
        return value


class LoginLogSerializer(serializers.ModelSerializer):
    """Serializer for login log entries."""
    class Meta:
        from .models import LoginLog
        model = LoginLog
        fields = ["id", "user", "username", "status", "ip_address",
                  "user_agent", "failure_reason", "timestamp"]
        read_only_fields = fields
