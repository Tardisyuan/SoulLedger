from rest_framework import serializers

from apps.tenants.models import Tenant


class TenantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tenant
        fields = [
            "id",
            "code",
            "display_name",
            "description",
            "is_active",
            "dispatch_enabled",
            "api_endpoint",
            "settings",
            "created_at",
        ]
        read_only_fields = ["id", "code", "created_at"]
