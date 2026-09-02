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
    """Serializer for WebhookConfig (hides signing_secret).

    ``create_time``, not ``created_at`` — WebhookConfig gets its audit
    timestamp from AuditUserFields, which names the field ``create_time``.
    Referencing a nonexistent field name here raised ImproperlyConfigured
    as soon as DRF built the field list, which happens for every action
    (list/retrieve/create/update) — this endpoint has never successfully
    served a single request, so there's no wire-format compatibility to
    preserve by keeping ``created_at`` as the JSON key via ``source=``.
    """
    class Meta:
        model = WebhookConfig
        fields = [
            'id', 'url', 'is_active', 'events', 'max_retries',
            'timeout_seconds', 'create_time',
        ]
        read_only_fields = ['create_time']


class WebhookDeliveryLogSerializer(serializers.ModelSerializer):
    """Serializer for WebhookDeliveryLog. Same create_time/created_at note
    as WebhookConfigSerializer above — this one crashed identically."""
    class Meta:
        model = WebhookDeliveryLog
        fields = [
            'id', 'status', 'attempt', 'http_status_code',
            'error_message', 'duration_ms', 'next_retry_at', 'create_time',
        ]
        read_only_fields = fields


class HealthSerializer(serializers.Serializer):
    """Serializer for health check response."""
    api_key = serializers.DictField()
    system = serializers.DictField()


# ── Doc-only response shapes ─────────────────────────────────────────────


class ApiKeyRateLimitSerializer(serializers.Serializer):
    """The two configured ceilings on the key. Zero when there is no key on
    the request, which is what the health view substitutes rather than
    omitting the block."""

    per_minute = serializers.IntegerField()
    per_hour = serializers.IntegerField()


class ApiKeyRateLimitRemainingSerializer(serializers.Serializer):
    """Requests actually left in each window.

    Nullable, and that is the point of the field existing: `remaining_for`
    returns None when the counter cannot be read, and the view reports that
    as null rather than inventing a number. A null here is "unknown", never
    "zero" — these two were once reported under this name while carrying the
    configured ceiling, which is never the remaining count.
    """

    per_minute = serializers.IntegerField(allow_null=True)
    per_hour = serializers.IntegerField(allow_null=True)


class DeathSyncApiKeyHealthSerializer(serializers.Serializer):
    """`name` and `system_type` are null when the request carries no api key."""

    name = serializers.CharField(allow_null=True)
    system_type = serializers.CharField(allow_null=True)
    is_active = serializers.BooleanField()
    rate_limit = ApiKeyRateLimitSerializer()
    rate_limit_remaining = ApiKeyRateLimitRemainingSerializer()


class DeathSyncSystemHealthSerializer(serializers.Serializer):
    """The three counts are scoped to the calling key's tenant and to the
    last 24 hours. `status` is the literal "healthy" — the view has no branch
    that emits anything else, so it reports that the endpoint answered, not
    that the counts are within any threshold.
    """

    status = serializers.CharField()
    pending_registrations_24h = serializers.IntegerField()
    failed_registrations_24h = serializers.IntegerField()
    failed_webhooks_24h = serializers.IntegerField()


class DeathSyncHealthSerializer(serializers.Serializer):
    """200 body of `DeathSyncHealthView`. Doc-only; see apps/core/schema.py."""

    api_key = DeathSyncApiKeyHealthSerializer()
    system = DeathSyncSystemHealthSerializer()
