"""
Death Sync models — external death registration integration.
"""
import uuid
import hashlib
import secrets
from django.db import models
from django.utils import timezone
from apps.core.models import AuditUserFields


class ExternalApiKey(AuditUserFields, models.Model):
    """
    API key for external system authentication.
    Each key is scoped to a single tenant.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='external_api_keys',
    )
    name = models.CharField(
        max_length=200,
        help_text="Human-readable label, e.g. 'Municipal Hospital Death Registry'",
    )
    system_type = models.CharField(
        max_length=30,
        choices=[
            ("GOVERNMENT", "Government Civil Registry"),
            ("HOSPITAL", "Hospital Death Certificate System"),
            ("POLICE", "Police Household Registration"),
            ("MESSAGE_BUS", "Message Bus Integration"),
            ("CUSTOM", "Custom Integration"),
        ],
    )
    key_hash = models.CharField(
        max_length=64,
        unique=True,
        db_index=True,
        help_text="SHA-256 hash of the raw API key",
    )
    key_prefix = models.CharField(
        max_length=8,
        help_text="First 8 chars of key for display/identification",
    )
    is_active = models.BooleanField(default=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    # Rate limiting config (per key)
    rate_limit_per_minute = models.IntegerField(default=60)
    rate_limit_per_hour = models.IntegerField(default=1000)

    # Security
    allowed_ips = models.JSONField(
        default=list,
        blank=True,
        help_text="List of allowed source IPs. Empty = allow all.",
    )
    allowed_sources = models.JSONField(
        default=list,
        blank=True,
        help_text="Source identifiers this key may use",
    )

    # Permissions
    can_register_death = models.BooleanField(default=True)
    can_query_status = models.BooleanField(default=True)
    can_manage_webhooks = models.BooleanField(default=False)

    last_used_at = models.DateTimeField(null=True, blank=True)
    usage_count = models.BigIntegerField(default=0)

    class Meta:
        ordering = ["-create_time"]
        verbose_name = "External API Key"
        verbose_name_plural = "External API Keys"
        indexes = [
            models.Index(fields=["tenant", "is_active"]),
            models.Index(fields=["key_hash"]),
        ]

    def __str__(self):
        return f"{self.name} ({self.system_type}) [{self.key_prefix}...]"

    @property
    def is_expired(self):
        if self.expires_at is None:
            return False
        return timezone.now() > self.expires_at

    @staticmethod
    def generate_key():
        """Generate a new API key. Returns (raw_key, key_hash, key_prefix)."""
        raw_key = f"slk_{secrets.token_urlsafe(32)}"
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
        key_prefix = raw_key[:8]
        return raw_key, key_hash, key_prefix


class DeathRegistrationStatus(models.TextChoices):
    PENDING = "PENDING", "Pending Validation"
    ACCEPTED = "ACCEPTED", "Accepted - Processing"
    PROCESSED = "PROCESSED", "Processed Successfully"
    FAILED = "FAILED", "Processing Failed"
    DUPLICATE = "DUPLICATE", "Duplicate - Already Processed"
    PARTIAL = "PARTIAL", "Partially Processed (batch)"


class DeathRegistrationRequest(AuditUserFields, models.Model):
    """
    Record of an inbound death registration from an external system.
    Immutable after creation. Used for idempotency, audit, and retry.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='death_registrations',
    )
    api_key = models.ForeignKey(
        'death_sync.ExternalApiKey',
        on_delete=models.SET_NULL,
        null=True,
        related_name='registrations',
    )

    # Idempotency
    idempotency_key = models.CharField(
        max_length=200,
        db_index=True,
        help_text="Client-provided idempotency key (unique per source system)",
    )
    source_system = models.CharField(
        max_length=50,
        help_text="Identifier of the source system",
    )

    # Source data
    source_reference_id = models.CharField(
        max_length=200,
        blank=True,
        help_text="Reference ID from source system",
    )
    # PII-sensitive payload (encrypted at rest)
    from apps.death_sync.encrypted_json import EncryptedJSONField
    source_payload = EncryptedJSONField(
        help_text="Original request payload (encrypted at rest)",
    )

    # Processing result
    status = models.CharField(
        max_length=20,
        choices=DeathRegistrationStatus.choices,
        default=DeathRegistrationStatus.PENDING,
    )
    soul = models.ForeignKey(
        'souls.Soul',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='death_registrations',
    )
    judgment = models.ForeignKey(
        'judgment.Judgment',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='death_registrations',
    )

    # Error tracking
    error_code = models.CharField(max_length=50, blank=True, default="")
    error_message = models.TextField(blank=True, default="")
    retry_count = models.IntegerField(default=0)
    max_retries = models.IntegerField(default=3)

    # Webhook delivery
    webhook_delivered = models.BooleanField(default=False)

    # Request metadata
    source_ip = models.GenericIPAddressField(null=True)
    request_timestamp = models.DateTimeField(auto_now_add=True)
    processing_duration_ms = models.IntegerField(null=True)

    class Meta:
        ordering = ["-request_timestamp"]
        verbose_name = "Death Registration Request"
        verbose_name_plural = "Death Registration Requests"
        constraints = [
            models.UniqueConstraint(
                fields=["source_system", "idempotency_key"],
                name="uniq_death_reg_idempotency",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "status"]),
            models.Index(fields=["source_system", "idempotency_key"]),
            models.Index(fields=["status", "request_timestamp"]),
            models.Index(fields=["soul"]),
        ]

    def __str__(self):
        return f"[{self.status}] {self.source_system}:{self.idempotency_key}"


class WebhookConfig(AuditUserFields, models.Model):
    """
    Registered webhook endpoint for receiving death event notifications.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='webhook_configs',
    )
    api_key = models.ForeignKey(
        'death_sync.ExternalApiKey',
        on_delete=models.CASCADE,
        related_name='webhooks',
    )
    url = models.URLField(
        max_length=500,
        help_text="Webhook callback URL (must be HTTPS in production)",
    )
    is_active = models.BooleanField(default=True)

    # Event filtering
    events = models.JSONField(
        default=list,
        help_text="Event types to subscribe to. Empty = all events.",
    )

    # Security (encrypted at rest)
    from apps.death_sync.fields import EncryptedCharField
    signing_secret = EncryptedCharField(
        max_length=500,
        help_text="HMAC-SHA256 signing secret for payload verification",
    )

    # Delivery config
    max_retries = models.IntegerField(default=5)
    timeout_seconds = models.IntegerField(default=10)

    class Meta:
        ordering = ["-create_time"]
        verbose_name = "Webhook Config"
        verbose_name_plural = "Webhook Configs"
        indexes = [
            models.Index(fields=["tenant", "is_active"]),
        ]

    def __str__(self):
        return f"{self.url} [{', '.join(self.events) or 'all'}]"


class WebhookDeliveryStatus(models.TextChoices):
    PENDING = "PENDING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    RETRYING = "RETRYING"


class WebhookDeliveryLog(AuditUserFields, models.Model):
    """
    Immutable log of webhook delivery attempts.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    webhook = models.ForeignKey(
        'death_sync.WebhookConfig',
        on_delete=models.CASCADE,
        related_name='delivery_logs',
    )
    registration = models.ForeignKey(
        'death_sync.DeathRegistrationRequest',
        on_delete=models.CASCADE,
        related_name='webhook_deliveries',
    )

    status = models.CharField(
        max_length=20,
        choices=WebhookDeliveryStatus.choices,
        default=WebhookDeliveryStatus.PENDING,
    )
    attempt = models.IntegerField(default=1)
    http_status_code = models.IntegerField(null=True)
    request_body = models.JSONField(default=dict)
    response_body = models.TextField(blank=True, default="")
    error_message = models.TextField(blank=True, default="")
    duration_ms = models.IntegerField(null=True)
    next_retry_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-create_time"]
        verbose_name = "Webhook Delivery Log"
        verbose_name_plural = "Webhook Delivery Logs"
        indexes = [
            models.Index(fields=["webhook", "status"]),
            models.Index(fields=["registration"]),
        ]
