"""
Tests for Webhook system.
"""

import pytest
from rest_framework import status
from rest_framework.test import APIClient

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


def _api_key_client(raw_key):
    """Return APIClient authenticated via APIKeyAuthentication's ApiKey scheme."""
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"ApiKey {raw_key}")
    return client


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


# ── C11: WebhookViewSet — the "every valid API key gets 403" bug ───────

@pytest.mark.django_db
class TestWebhookViewSetPermissionFix:
    """C11: like DeathRegistrationViewSet and DeathSyncHealthView,
    WebhookViewSet declared authentication_classes = [APIKeyAuthentication]
    with no permission_classes override, so it inherited the project-wide
    IsAuthenticated default and rejected every valid API key with 403 (see
    apps.core.permissions.HasValidApiKey for the full mechanism). Fixed the
    same way as the other two views.

    A positive "valid key gets 201" case for POST /webhooks/ isn't usable
    here: WebhookConfigSerializer.Meta.fields lists 'created_at', but
    WebhookConfig (via AuditUserFields) has 'create_time', not 'created_at'
    — apps/death_sync/views.py's own DeathSyncHealthView docstring already
    flags this exact created_at/create_time mismatch on
    WebhookDeliveryLog. That breaks every action that touches
    WebhookConfigSerializer (list, retrieve, create alike) with
    ImproperlyConfigured, regardless of this permission fix. That's a
    separate, already-flagged bug, out of scope here. DELETE (destroy)
    never builds a serializer — DRF's destroy() only needs get_object() and
    instance.delete() — so it's used below to prove the permission gate
    itself opened up without being confounded by that unrelated bug.
    """

    @pytest.fixture(autouse=True)
    def setup(self, db, cn_tenant):
        raw_key, key_hash, key_prefix = ExternalApiKey.generate_key()
        self.key = ExternalApiKey.objects.create(
            tenant=cn_tenant, name="C11 Webhook Key", system_type="HOSPITAL",
            key_hash=key_hash, key_prefix=key_prefix,
        )
        self.raw_key = raw_key
        self.webhook = WebhookConfig.objects.create(
            tenant=cn_tenant,
            api_key=self.key,
            url="https://example.com/webhook",
            signing_secret="c11_secret",
        )

    def test_valid_key_delete_is_not_403(self):
        resp = _api_key_client(self.raw_key).delete(f"/api/v1/death-sync/webhooks/{self.webhook.pk}/")
        assert resp.status_code == status.HTTP_204_NO_CONTENT
        assert not WebhookConfig.objects.filter(pk=self.webhook.pk).exists()

    def test_no_key_is_401_not_500(self):
        """No Authorization header: request.api_key never gets set.
        HasValidApiKey must deny this cleanly (AllowAny would have let it
        through with no request.api_key, and perform_create() reads
        self.request.api_key unconditionally)."""
        resp = APIClient().delete(f"/api/v1/death-sync/webhooks/{self.webhook.pk}/")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED
        assert WebhookConfig.objects.filter(pk=self.webhook.pk).exists()

    def test_invalid_key_is_401(self):
        resp = _api_key_client("not-a-real-key").delete(f"/api/v1/death-sync/webhooks/{self.webhook.pk}/")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    def test_inactive_key_is_401(self):
        self.key.is_active = False
        self.key.save()
        resp = _api_key_client(self.raw_key).delete(f"/api/v1/death-sync/webhooks/{self.webhook.pk}/")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED
        assert WebhookConfig.objects.filter(pk=self.webhook.pk).exists()
