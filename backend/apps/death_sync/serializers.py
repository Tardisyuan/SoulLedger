"""
Serializers for death_sync app.
"""
from rest_framework import serializers

from apps.death_sync.models import (
    DeathRegistrationRequest,
    ExternalApiKey,
    WebhookConfig,
    WebhookDeliveryLog,
)


class ExternalApiKeySerializer(serializers.ModelSerializer):
    """Serializer for ExternalApiKey (hides key_hash, shows raw_key on create)."""
    _raw_key = serializers.CharField(read_only=True, required=False)

    class Meta:
        model = ExternalApiKey
        fields = [
            'id', 'name', 'system_type', 'key_prefix', 'is_active', 'expires_at',
            'rate_limit_per_minute', 'rate_limit_per_hour', 'allowed_ips',
            'can_register_death', 'can_query_status', 'can_manage_webhooks',
            'last_used_at', 'usage_count', '_raw_key',
        ]
        read_only_fields = ['key_prefix', 'last_used_at', 'usage_count']


class DeathRegistrationRequestSerializer(serializers.ModelSerializer):
    """Serializer for DeathRegistrationRequest (read-only for listing)."""
    class Meta:
        model = DeathRegistrationRequest
        fields = [
            'id', 'status', 'source_system', 'idempotency_key',
            'source_reference_id', 'soul', 'judgment',
            'error_code', 'error_message', 'retry_count',
            'request_timestamp', 'processing_duration_ms',
        ]
        read_only_fields = fields


class DeathRegistrationCreateSerializer(serializers.Serializer):
    """Serializer for death registration creation."""
    soul_lookup = serializers.DictField(required=False)
    death_date = serializers.DateField()
    death_location = serializers.CharField(max_length=500, required=False, default="")
    cause_of_death = serializers.CharField(max_length=500, required=False, default="")
    source_reference = serializers.CharField(max_length=200, required=False, default="")
    metadata = serializers.DictField(required=False, default=dict)

    def validate_soul_lookup(self, value):
        if not value:
            return value
        has_id = 'soul_id' in value
        has_name = 'name' in value
        if not has_id and not has_name:
            raise serializers.ValidationError("Must provide soul_id or name")
        return value


class WebhookConfigSerializer(serializers.ModelSerializer):
    """Serializer for WebhookConfig (hides signing_secret)."""
    class Meta:
        model = WebhookConfig
        fields = [
            'id', 'url', 'is_active', 'events', 'max_retries',
            'timeout_seconds', 'created_at',
        ]
        read_only_fields = ['created_at']


class WebhookDeliveryLogSerializer(serializers.ModelSerializer):
    """Serializer for WebhookDeliveryLog."""
    class Meta:
        model = WebhookDeliveryLog
        fields = [
            'id', 'status', 'attempt', 'http_status_code',
            'error_message', 'duration_ms', 'next_retry_at', 'created_at',
        ]
        read_only_fields = fields


class HealthSerializer(serializers.Serializer):
    """Serializer for health check response."""
    api_key = serializers.DictField()
    system = serializers.DictField()
