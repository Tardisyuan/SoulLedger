"""
Tests for Webhook system.
"""

import pytest

from apps.death_sync.models import (
    DeathRegistrationRequest,
    DeathRegistrationStatus,
    ExternalApiKey,
    WebhookConfig,
    WebhookDeliveryLog,
    WebhookDeliveryStatus,
)
from apps.death_sync.signing import is_timestamp_fresh, sign_payload, verify_signature
from apps.death_sync.webhook_service import WebhookService
from apps.souls.models import Soul
from apps.tenants.models import Tenant


@pytest.fixture
def cn_tenant(db):
    return Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "Chinese Diyu"})[0]


@pytest.fixture
def api_key(cn_tenant):
    raw_key, key_hash, key_prefix = ExternalApiKey.generate_key()
    return ExternalApiKey.objects.create(
        tenant=cn_tenant, name="Test Key", system_type="HOSPITAL",
        key_hash=key_hash, key_prefix=key_prefix,
    )


@pytest.fixture
def webhook_config(cn_tenant, api_key):
    return WebhookConfig.objects.create(
        tenant=cn_tenant,
        api_key=api_key,
        url="https://example.com/webhook",
        signing_secret="test_secret_123",
        is_active=True,
    )


@pytest.fixture
def registration(cn_tenant, api_key):
    soul = Soul.objects.create(name="Webhook Soul", tenant=cn_tenant)
    return DeathRegistrationRequest.objects.create(
        tenant=cn_tenant,
        api_key=api_key,
        idempotency_key="webhook-test-1",
        source_system="HOSPITAL",
        source_payload={"test": True},
        status=DeathRegistrationStatus.PROCESSED,
        soul=soul,
    )


# ── Signing Tests ────────────────────────────────────────────────────

@pytest.mark.django_db
class TestSigning:
    def test_sign_payload(self):
        payload = b'{"test": true}'
        secret = "my_secret"
        timestamp = "1234567890"
        sig = sign_payload(payload, secret, timestamp)
        assert len(sig) == 64  # SHA-256 hex digest

    def test_verify_signature_valid(self):
        payload = b'{"test": true}'
        secret = "my_secret"
        timestamp = "1234567890"
        sig = sign_payload(payload, secret, timestamp)
        assert verify_signature(payload, secret, timestamp, f"sha256={sig}") is True

    def test_verify_signature_invalid(self):
        payload = b'{"test": true}'
        assert verify_signature(payload, "secret", "123", "sha256=invalid") is False

    def test_is_timestamp_fresh(self):
        import time
        assert is_timestamp_fresh(str(int(time.time())), max_age_seconds=300) is True
        assert is_timestamp_fresh("1000000000", max_age_seconds=300) is False

    def test_is_timestamp_fresh_invalid(self):
        assert is_timestamp_fresh("not_a_number") is False


# ── Webhook Service Tests ────────────────────────────────────────────

@pytest.mark.django_db
class TestWebhookService:
    def test_deliver_webhook_creates_log(self, cn_tenant, api_key, registration):
        """Webhook delivery creates a delivery log."""
        # Use a non-routable URL that will fail
        webhook = WebhookConfig.objects.create(
            tenant=cn_tenant,
            api_key=api_key,
            url="http://192.0.2.1:99999/webhook",
            signing_secret="test_secret",
            timeout_seconds=1,
        )
        WebhookService.deliver_webhook(webhook, registration)

        # Check that a delivery log was created
        log = WebhookDeliveryLog.objects.filter(
            webhook=webhook,
            registration=registration,
        ).first()
        assert log is not None
        assert log.status == WebhookDeliveryStatus.FAILED

    def test_schedule_retry(self, webhook_config, registration):
        """Retry scheduling increments attempt and sets next_retry_at."""
        log = WebhookDeliveryLog.objects.create(
            webhook=webhook_config,
            registration=registration,
            status=WebhookDeliveryStatus.FAILED,
            attempt=1,
        )
        updated = WebhookService.schedule_retry(log)
        assert updated.attempt == 2
        assert updated.status == WebhookDeliveryStatus.RETRYING
        assert updated.next_retry_at is not None

    def test_max_retries_exceeded(self, webhook_config, registration):
        """After max retries, delivery is marked FAILED."""
        log = WebhookDeliveryLog.objects.create(
            webhook=webhook_config,
            registration=registration,
            status=WebhookDeliveryStatus.FAILED,
            attempt=5,  # max_retries = 5
        )
        updated = WebhookService.schedule_retry(log)
        assert updated.status == WebhookDeliveryStatus.FAILED


# ── Webhook Config Tests ────────────────────────────────────────────

@pytest.mark.django_db
class TestWebhookConfig:
    def test_create_webhook(self, cn_tenant, api_key):
        """Create a webhook configuration."""
        webhook = WebhookConfig.objects.create(
            tenant=cn_tenant,
            api_key=api_key,
            url="https://test.example.com/hooks",
            signing_secret="secret123",
            events=["DEATH_REGISTERED"],
        )
        assert webhook.pk is not None
        assert webhook.is_active is True

    def test_str_representation(self, cn_tenant, api_key):
        webhook = WebhookConfig.objects.create(
            tenant=cn_tenant,
            api_key=api_key,
            url="https://test.example.com/hooks",
            signing_secret="secret123",
            events=["DEATH_REGISTERED"],
        )
        assert "test.example.com" in str(webhook)
        assert "DEATH_REGISTERED" in str(webhook)


# ── Health Check Tests ───────────────────────────────────────────────

@pytest.mark.django_db
class TestHealthCheck:
    def test_health_check_requires_auth(self):
        """Health check requires API key authentication."""
        from rest_framework.test import APIRequestFactory

        from apps.death_sync.views import DeathSyncHealthView

        factory = APIRequestFactory()
        request = factory.get("/api/v1/death-sync/health/")
        view = DeathSyncHealthView.as_view()
        response = view(request)
        # Without auth, should return 401
        assert response.status_code == 401
