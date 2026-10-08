"""
Serializers for death_sync app.
"""
from urllib.parse import urlparse

from rest_framework import serializers

from apps.death_sync.models import (
    DeathRegistrationRequest,
    ExternalApiKey,
    WebhookConfig,
)
from apps.events.models import EventType, EventWebhookDelivery


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
    # 灵魂端初始密码的投递渠道(2026-09-17)。都可选;没有就进「待交付」。
    # 与 Soul 上的字段同一套校验:EmailField,手机号 7-15 位数字可带 +。
    contact_email = serializers.EmailField(required=False, default="")
    contact_phone = serializers.RegexField(
        r"^\+?[1-9]\d{6,14}$", max_length=20, required=False, default="",
        error_messages={"invalid": "手机号须为 7-15 位数字,可带 + 前缀"},
    )
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


class DeathRegistrationSummarySerializer(serializers.Serializer):
    """200 body of `registrations/summary/`. Doc-only.

    `anomaly_count` counts this tenant's rows in `anomaly_status`, which is
    the value `registrations/?status=` takes to list exactly those rows.
    """

    anomaly_status = serializers.CharField()
    anomaly_count = serializers.IntegerField()


class DeathSyncHealthSerializer(serializers.Serializer):
    """200 body of `DeathSyncHealthView`. Doc-only; see apps/core/schema.py."""

    api_key = DeathSyncApiKeyHealthSerializer()
    system = DeathSyncSystemHealthSerializer()


# ── Admin webhook management (JWT + ADMIN; see AdminWebhookViewSet) ─────────


class AdminWebhookConfigSerializer(serializers.ModelSerializer):
    """`WebhookConfig` as the admin tab sees it.

    `_signing_secret` is the plaintext and arrives exactly once, in the 201
    of `create` — the same shape as `ExternalApiKeySerializer._raw_key`. The
    field is `read_only` and the view sets it on the saved instance, so a
    list / retrieve / update response never carries it (nothing puts it on
    those instances). The model column is encrypted at rest and is not a
    serializer field at all.

    `events` is a list of real `EventType` members: the delivery code
    (`apps/events/handlers/webhook_handler.py`) compares
    `envelope.event_type` against this list verbatim, so a misspelt name
    would silently subscribe to nothing. An empty list keeps the model's
    meaning of "everything".

    `api_key` is the external system the webhook belongs to: the
    self-service endpoint (`WebhookViewSet`) scopes by it, so an admin-created
    webhook is visible to that system under its own key. It must be one of
    the request tenant's keys and cannot be moved after creation.
    """

    _signing_secret = serializers.CharField(read_only=True, required=False)
    api_key_name = serializers.CharField(source="api_key.name", read_only=True)
    events = serializers.ListField(
        child=serializers.ChoiceField(choices=EventType.choices), required=False, default=list
    )

    class Meta:
        model = WebhookConfig
        fields = [
            "id", "api_key", "api_key_name", "url", "is_active", "events",
            "max_retries", "timeout_seconds", "create_time", "update_time",
            "_signing_secret",
        ]
        read_only_fields = ["create_time", "update_time"]

    def validate_url(self, value):
        """http(s) only, and nothing that resolves to a private or loopback
        address — `_validate_webhook_url` is the SSRF blocklist the delivery
        task already applies at send time; refusing here means the row is
        never written rather than failing on every attempt."""
        from apps.death_sync.webhook_service import _validate_webhook_url

        if urlparse(value).scheme not in ("http", "https"):
            raise serializers.ValidationError("Webhook URL must use http or https.")
        try:
            _validate_webhook_url(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from None
        return value

    def validate_api_key(self, value):
        tenant = getattr(self.context.get("request"), "tenant", None)
        if tenant is None or value.tenant_id != tenant.id:
            raise serializers.ValidationError("API key does not belong to this tenant.")
        if self.instance is not None and value.pk != self.instance.api_key_id:
            raise serializers.ValidationError("A webhook cannot be moved to another API key.")
        return value


class EventWebhookDeliverySerializer(serializers.ModelSerializer):
    """Read-only row of `GET /death-sync/webhook-deliveries/`.

    `payload_json` is deliberately absent: it is the envelope snapshot
    (soul ids, verdicts) and the admin tab needs the outcome, not the body.
    """

    webhook_url = serializers.CharField(source="webhook.url", read_only=True)

    class Meta:
        model = EventWebhookDelivery
        fields = [
            "id", "webhook", "webhook_url", "domain", "event_type", "status",
            "attempt", "response_status", "error", "delivered_at",
            "create_time", "update_time",
        ]
        read_only_fields = fields
