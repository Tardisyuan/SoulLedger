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
        """What the server will actually allow this user, asked of the checker.

        This list is the login payload's `user.permissions`. It lands in
        `usePermissions`, so every codename here is a control the UI offers and
        every one missing is a control it hides.

        It used to resolve the question itself, and it resolved it differently
        from `apps/perm/checker.py`, which is what decides the answer the
        server gives. Any RolePermission row at all switched the
        ROLE_PERMISSIONS fallback off for the whole role, so on a
        partially-seeded database — a migrate-only one, which is what CI builds
        — it reported ADMIN 7 codenames against the checker's 40, GUARDIAN 1
        against 14, VIEWER 1 against 8. Users were shown almost nothing while
        the server went on permitting them everything. That is the permission
        audit's §2 finding; this serializer is its "login list" column.

        It survived a fix to the same defect in `apps/perm/views.py` because
        the two were separate copies of one rule, and because the rehydrate
        fetch in `frontend/src/contexts/TenantContext.tsx` replaces this list
        on the next page load — which bounded the damage to the first render
        after login, but bounded it with a frontend behaviour rather than
        anything in the permission layer. Trusting the login payload again
        would have restored the divergence at full size.

        `rbac_role` is deliberately no longer consulted. `check_permission`
        resolves off `obj.role` and never reads the FK, so preferring the FK
        here made the reported list depend on which of two role fields happened
        to be populated — a divergence in its own right. The FK still drives
        the WebSocket permission set (`apps/core/ws_permissions.py`), which is
        a fourth answer to this same question and is not reconciled yet.
        """
        from apps.perm.services import get_role_permission_codenames
        return get_role_permission_codenames(obj.role)


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
    """The serializer behind `PATCH /auth/profile/` — what a user may change
    about themselves.

    `role` and `tenant` were already locked. `organization` was not, and it is
    a foreign key with no tenant check: measured, a VIEWER could
    `PATCH /auth/profile/ {"organization": <an org belonging to tenant B>}`
    and get 200. Nothing downstream widened that into data access
    (`apps/perm/filters.py` never mentions `organization`, so `DataScopeFilter`
    does not read it), which is why this is a write-integrity hole rather than
    a privilege escalation — but "the field nobody reads today" is not a
    permission model.

    Kept writable rather than made read-only: moving between the organizations
    of one's own tenant is what this field is for. The scoping happens in
    `validate_organization`.
    """

    class Meta:
        model = User
        fields = ["id", "username", "email", "role", "first_name", "last_name", "is_active", "display_name", "organization", "position"]
        read_only_fields = ["id", "is_active", "username", "role"]

    def validate_organization(self, value):
        """Refuse an organization belonging to somebody else's tenant.

        `PrimaryKeyRelatedField` resolves the FK against the whole table — the
        queryset it builds from the model field has no tenant contextvar and no
        request. So the check has to be here, against the caller's own tenant,
        and it has to read the tenant off the request rather than off
        `self.instance` (a user with no tenant must not be able to claim one by
        way of an organization).
        """
        if value is None:
            return value
        request = self.context.get("request")
        user = getattr(request, "user", None)
        tenant = getattr(request, "tenant", None) or getattr(user, "tenant", None)
        if tenant is None:
            raise serializers.ValidationError(
                "无法确定当前租户,不能设置组织。"
            )
        if value.tenant_id != tenant.id:
            raise serializers.ValidationError(
                f"组织 {value.code} 属于另一个租户,不能挂到当前账号下。"
            )
        return value


# ---------------------------------------------------------------------------
# User Management API Serializers (Tenant Admin)
# ---------------------------------------------------------------------------


class UserManagementSerializer(serializers.ModelSerializer):
    """User serializer for list/retrieve operations in user management API."""
    tenant = serializers.SerializerMethodField()
    organization = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'role', 'tenant', 'organization', 'position', 'is_active', 'create_time', 'avatar']
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
        fields = ['id', 'username', 'email', 'password', 'first_name', 'last_name', 'role', 'tenant', 'organization', 'position', 'is_active']

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
        fields = ['email', 'first_name', 'last_name', 'role', 'is_active', 'organization', 'position']

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
