"""
Death Sync models — external death registration integration.
"""
import hashlib
import secrets
import uuid

from django.db import models
from django.utils import timezone

from apps.core.models import AuditUserFields
from apps.tenants.managers import TenantManager


class TudiGod(AuditUserFields, models.Model):
    """一位土地公(2026-10-28,只在地府):基层登记亡魂的一级,上面是城隍。

    docs/08 §五(城隍 →「土地公(乡镇级)」)、§七(土地公「管理一方土地和亡灵」)、§九(「基层管理员」);
    06 §二 第一站土地庙:「通报当地城隍,有新亡魂到来」「记录亡魂基本信息(死亡时间、死因)」。
    `regions` 是他管的地名(乡镇),只作展示与筛选;登记时报给 `city_god`(上级城隍),不再按出身地另配。
    `city_god` 可空:没填时按出身地配(与死亡同步一样);本殿连兜底城隍都没有就不开案,登记记为 FAILED
    `NO_CITY_GOD`(用户 2026-10-29,`city_gods.NoCityGodError`),设了兜底城隍后可重试。
    `officers` = 以这位土地公名义登记的官员(殿管理员也能登)。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("tenants.Tenant", on_delete=models.CASCADE, related_name="tudi_gods")
    name = models.CharField(max_length=100)
    regions = models.JSONField(default=list, blank=True)
    city_god = models.ForeignKey("judgment.CityGod", on_delete=models.SET_NULL, null=True, blank=True,
                                 related_name="tudi_gods")
    officers = models.ManyToManyField("authentication.User", blank=True, related_name="tudi_gods")

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["tenant", "name"], condition=models.Q(is_deleted=False),
                                    name="unique_tudi_god_name_per_hall"),
        ]

    def __str__(self):
        return self.name


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
    """ACCEPTED 与 PARTIAL 已删(2026-10-29 用户决定):历史上从来没有代码写过它们(按提交记录搜索为空),
    筛选里却列着。迁移 death_sync 的 drop_unwritten_statuses 把可能存在的旧行改成最接近的状态。"""
    PENDING = "PENDING", "Pending Validation"
    PROCESSED = "PROCESSED", "Processed Successfully"
    FAILED = "FAILED", "Processing Failed"
    DUPLICATE = "DUPLICATE", "Duplicate - Already Processed"


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
    # 土地公登记(2026-10-28,apps/death_sync/tudi.py):官员以一位土地公的名义登记的死亡,`api_key` 为空、
    # `source_system` 是 "TUDI"。与外部系统的登记同一张表、同一条处理(`DeathSyncService._process`)。
    tudi_god = models.ForeignKey(
        "death_sync.TudiGod",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="registrations",
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
                fields=["tenant", "source_system", "idempotency_key"],
                # Per tenant: two halls may send the same explicit X-Idempotency-Key.
                # Scoped to live rows. Without this, soft-deleting a row leaves
                # its key occupied by something no filtered queryset can see:
                # re-creating the same key then fails a uniqueness check
                # against a row that is invisible to every read path.
                # See tests/test_soft_delete_frees_unique_keys.py.
                condition=models.Q(is_deleted=False),
                name="uniq_death_reg_idempotency",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "status"]),
            models.Index(fields=["tenant", "source_system", "idempotency_key"]),
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
