"""
Audit serializers
"""
from rest_framework import serializers
from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    tenant_code = serializers.CharField(source="tenant.code", read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            "id", "action", "resource", "resource_id", "changes",
            "ip_address", "user_agent", "description", "timestamp",
            "username", "tenant_code"
        ]
