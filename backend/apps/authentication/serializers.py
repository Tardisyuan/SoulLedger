"""
Auth serializers: register, login, user profile.
"""
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password

User = get_user_model()


class TenantInfoSerializer(serializers.Serializer):
    """Nested tenant info in login response."""
    code = serializers.CharField()
    display_name = serializers.CharField()


class UserWithTenantSerializer(serializers.ModelSerializer):
    """User serializer with tenant info for login response."""
    tenant = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "role", "tenant"]

    def get_tenant(self, obj):
        if obj.tenant:
            return {"code": obj.tenant.code, "display_name": obj.tenant.display_name}
        return None


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
        fields = ["id", "username", "email", "role", "first_name", "last_name", "is_active"]
        read_only_fields = ["id", "is_active"]
