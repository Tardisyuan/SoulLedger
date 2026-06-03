"""
Tests for Death Sync API.
"""
import pytest
import hashlib
from django.test import TestCase
from apps.death_sync.models import (
    ExternalApiKey, DeathRegistrationRequest, DeathRegistrationStatus,
    WebhookConfig, WebhookDeliveryLog,
)
from apps.death_sync.services import DeathSyncService
from apps.death_sync.authentication import APIKeyAuthentication
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant


@pytest.fixture
def cn_tenant(db):
    return Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "Chinese Diyu"})[0]


@pytest.fixture
def eu_tenant(db):
    return Tenant.objects.get_or_create(code="EU_HEAVEN_HELL", defaults={"display_name": "EU"})[0]


@pytest.fixture
def api_key(cn_tenant):
    raw_key, key_hash, key_prefix = ExternalApiKey.generate_key()
    return ExternalApiKey.objects.create(
        tenant=cn_tenant,
        name="Test API Key",
        system_type="HOSPITAL",
        key_hash=key_hash,
        key_prefix=key_prefix,
    ), raw_key


@pytest.fixture
def soul(cn_tenant):
    return Soul.objects.create(name="Test Soul", tenant=cn_tenant)


# ── Model Tests ──────────────────────────────────────────────────────

@pytest.mark.django_db
class TestExternalApiKeyModel:
    def test_generate_key_returns_tuple(self):
        raw, hashed, prefix = ExternalApiKey.generate_key()
        assert raw.startswith("slk_")
        assert len(hashed) == 64
        assert len(prefix) == 8

    def test_is_expired(self, cn_tenant):
        from django.utils import timezone
        from datetime import timedelta
        key = ExternalApiKey.objects.create(
            tenant=cn_tenant, name="Test", system_type="CUSTOM",
            key_hash="abc", key_prefix="slk_abc",
            expires_at=timezone.now() - timedelta(days=1),
        )
        assert key.is_expired is True

    def test_not_expired(self, cn_tenant):
        from django.utils import timezone
        from datetime import timedelta
        key = ExternalApiKey.objects.create(
            tenant=cn_tenant, name="Test", system_type="CUSTOM",
            key_hash="abc", key_prefix="slk_abc",
            expires_at=timezone.now() + timedelta(days=1),
        )
        assert key.is_expired is False


@pytest.mark.django_db
class TestDeathRegistrationRequestModel:
    def test_status_choices(self):
        assert DeathRegistrationStatus.PENDING == "PENDING"
        assert DeathRegistrationStatus.PROCESSED == "PROCESSED"

    def test_str_representation(self, cn_tenant, api_key):
        key, raw = api_key
        req = DeathRegistrationRequest.objects.create(
            tenant=cn_tenant,
            api_key=key,
            idempotency_key="test-123",
            source_system="HOSPITAL",
            source_payload={"test": True},
        )
        assert "HOSPITAL" in str(req)
        assert "test-123" in str(req)


# ── Service Tests ────────────────────────────────────────────────────

@pytest.mark.django_db
class TestDeathSyncService:
    def test_lookup_soul_by_id(self, cn_tenant, soul):
        result = DeathSyncService.lookup_soul(cn_tenant, {"soul_id": str(soul.id)})
        assert result is not None
        assert result.id == soul.id

    def test_lookup_soul_by_name(self, cn_tenant, soul):
        result = DeathSyncService.lookup_soul(cn_tenant, {"name": "Test Soul"})
        assert result is not None
        assert result.name == "Test Soul"

    def test_lookup_soul_not_found(self, cn_tenant):
        result = DeathSyncService.lookup_soul(cn_tenant, {"name": "Nonexistent"})
        assert result is None

    def test_register_death_success(self, cn_tenant, api_key, soul):
        key, raw = api_key
        result = DeathSyncService.register_death(
            tenant=cn_tenant,
            api_key=key,
            payload={
                "soul_lookup": {"soul_id": str(soul.id)},
                "death_date": "2026-06-01",
            },
            idempotency_key="test-reg-1",
        )
        assert result.status == DeathRegistrationStatus.PROCESSED
        assert result.soul is not None
        assert result.judgment is not None

    def test_register_death_soul_not_found(self, cn_tenant, api_key):
        key, raw = api_key
        result = DeathSyncService.register_death(
            tenant=cn_tenant,
            api_key=key,
            payload={
                "soul_lookup": {"name": "Nonexistent"},
                "death_date": "2026-06-01",
            },
            idempotency_key="test-reg-2",
        )
        assert result.status == DeathRegistrationStatus.FAILED
        assert result.error_code == "SOUL_NOT_FOUND"

    def test_register_death_soul_not_alive(self, cn_tenant, api_key, soul):
        key, raw = api_key
        soul.current_state = SoulState.JUDGING
        soul.save()
        result = DeathSyncService.register_death(
            tenant=cn_tenant,
            api_key=key,
            payload={
                "soul_lookup": {"soul_id": str(soul.id)},
                "death_date": "2026-06-01",
            },
            idempotency_key="test-reg-3",
        )
        assert result.status == DeathRegistrationStatus.FAILED
        assert result.error_code == "SOUL_NOT_ALIVE"


# ── Authentication Tests ─────────────────────────────────────────────

@pytest.mark.django_db
class TestAPIKeyAuthentication:
    def test_authenticate_valid_key(self, api_key, cn_tenant):
        from rest_framework.test import APIRequestFactory
        key, raw = api_key
        factory = APIRequestFactory()
        request = factory.get("/api/v1/death-sync/register/", HTTP_AUTHORIZATION=f"ApiKey {raw}")

        auth = APIKeyAuthentication()
        result = auth.authenticate(request)
        assert result is not None

    def test_authenticate_invalid_key(self, cn_tenant):
        from rest_framework.test import APIRequestFactory
        factory = APIRequestFactory()
        request = factory.get("/api/v1/death-sync/register/", HTTP_AUTHORIZATION="ApiKey invalid_key_here")

        auth = APIKeyAuthentication()
        with pytest.raises(Exception):
            auth.authenticate(request)

    def test_authenticate_expired_key(self, cn_tenant):
        from rest_framework.test import APIRequestFactory
        from django.utils import timezone
        from datetime import timedelta

        raw_key, key_hash, key_prefix = ExternalApiKey.generate_key()
        key = ExternalApiKey.objects.create(
            tenant=cn_tenant, name="Expired", system_type="CUSTOM",
            key_hash=key_hash, key_prefix=key_prefix,
            expires_at=timezone.now() - timedelta(days=1),
        )

        factory = APIRequestFactory()
        request = factory.get("/api/v1/death-sync/register/", HTTP_AUTHORIZATION=f"ApiKey {raw_key}")

        auth = APIKeyAuthentication()
        with pytest.raises(Exception):
            auth.authenticate(request)
