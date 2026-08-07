"""
Tests for Death Sync API.
"""

import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient

from apps.death_sync.authentication import APIKeyAuthentication
from apps.death_sync.models import (
    DeathRegistrationRequest,
    DeathRegistrationStatus,
    ExternalApiKey,
)
from apps.death_sync.services import DeathSyncService
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

User = get_user_model()


def _jwt_client(user, tenant):
    """Return APIClient authenticated via JWT with tenant_code claim."""
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _api_key_client(raw_key):
    """Return APIClient authenticated via APIKeyAuthentication's ApiKey scheme."""
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"ApiKey {raw_key}")
    return client


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
        from datetime import timedelta

        from django.utils import timezone
        key = ExternalApiKey.objects.create(
            tenant=cn_tenant, name="Test", system_type="CUSTOM",
            key_hash="abc", key_prefix="slk_abc",
            expires_at=timezone.now() - timedelta(days=1),
        )
        assert key.is_expired is True

    def test_not_expired(self, cn_tenant):
        from datetime import timedelta

        from django.utils import timezone
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
        from datetime import timedelta

        from django.utils import timezone
        from rest_framework.test import APIRequestFactory

        raw_key, key_hash, key_prefix = ExternalApiKey.generate_key()
        ExternalApiKey.objects.create(
            tenant=cn_tenant, name="Expired", system_type="CUSTOM",
            key_hash=key_hash, key_prefix=key_prefix,
            expires_at=timezone.now() - timedelta(days=1),
        )

        factory = APIRequestFactory()
        request = factory.get("/api/v1/death-sync/register/", HTTP_AUTHORIZATION=f"ApiKey {raw_key}")

        auth = APIKeyAuthentication()
        with pytest.raises(Exception):
            auth.authenticate(request)


# ── Batch Registration Tests ──────────────────────────────────────────

@pytest.mark.django_db
class TestBatchRegistration:
    def test_batch_registration(self, cn_tenant, api_key, soul):
        """Batch registration processes multiple deaths."""
        key, raw = api_key
        results = DeathSyncService.process_batch(
            tenant=cn_tenant,
            api_key=key,
            registrations=[
                {"soul_lookup": {"soul_id": str(soul.id)}, "death_date": "2026-06-01"},
            ],
        )
        assert len(results) == 1
        assert results[0].status == DeathRegistrationStatus.PROCESSED


# ── Idempotency Tests ────────────────────────────────────────────────

@pytest.mark.django_db
class TestIdempotency:
    def test_duplicate_idempotency_key_raises(self, cn_tenant, api_key, soul):
        """Duplicate idempotency keys should raise IntegrityError."""
        key, raw = api_key
        DeathSyncService.register_death(
            tenant=cn_tenant,
            api_key=key,
            payload={"soul_lookup": {"soul_id": str(soul.id)}, "death_date": "2026-06-01"},
            idempotency_key="idempotent-test-1",
        )
        with pytest.raises(Exception):  # IntegrityError wraps to generic Exception
            DeathSyncService.register_death(
                tenant=cn_tenant,
                api_key=key,
                payload={"soul_lookup": {"soul_id": str(soul.id)}, "death_date": "2026-06-01"},
                idempotency_key="idempotent-test-1",
            )


# ── C9: ExternalApiKeyViewSet permission gate ──────────────────────────

@pytest.mark.django_db
class TestExternalApiKeyPermissions:
    """C9: ExternalApiKeyViewSet must gate by role == 'ADMIN', not Django
    is_staff.

    Pre-fix (`permission_classes = [IsAdminUser]`), every role — role='ADMIN'
    included — got 403, because IsAdminUser checks Django's `is_staff` flag,
    which SoulLedger's user model never sets for role='ADMIN' (see
    apps/perm/test_matrix_snapshot.py's "GET .../api-keys/ is 403 for ADMIN
    too" note, and tests/test_perm_write_snapshot_outside_matrix.py's
    DEATH_SYNC_API_KEY_CREATE = ALL_403, both of which this fix intentionally
    moves). Post-fix, role='ADMIN' succeeds and every other role is still
    denied — the same shape as every other admin-gated endpoint in this
    codebase (IsAdminPermission).
    """

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="EAK_T1", defaults={"display_name": "API Key Perm Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="eakadmin", password="test123", role="ADMIN", tenant=self.tenant,
        )
        self.viewer = User.objects.create_user(
            username="eakviewer", password="test123", role="VIEWER", tenant=self.tenant,
        )
        self.admin_client = _jwt_client(self.admin, self.tenant)
        self.viewer_client = _jwt_client(self.viewer, self.tenant)

    def test_admin_role_can_list(self):
        resp = self.admin_client.get("/api/v1/death-sync/api-keys/")
        assert resp.status_code == status.HTTP_200_OK

    def test_admin_role_can_create(self):
        resp = self.admin_client.post(
            "/api/v1/death-sync/api-keys/",
            {"name": "New Key", "system_type": "HOSPITAL"}, format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        assert ExternalApiKey.objects.filter(name="New Key", tenant=self.tenant).exists()

    def test_non_admin_role_forbidden(self):
        resp = self.viewer_client.get("/api/v1/death-sync/api-keys/")
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_unauthenticated_rejected(self):
        resp = APIClient().get("/api/v1/death-sync/api-keys/")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
class TestExternalApiKeyQuerysetScoping:
    """C9 (defense-in-depth): get_queryset() scopes non-ADMIN callers by
    tenant, even though IsAdminPermission means role='ADMIN' is the only role
    that can reach this view via HTTP today. ADMIN is this codebase's one
    intentionally-global role (TenantPermission/DataScopeViewSetMixin bypass
    it everywhere), and this endpoint is already ADMIN-only after the C9
    permission fix, so tenant-scoping the queryset changes nothing for
    today's only caller. It is added anyway, matching the
    DataScopeViewSetMixin idiom used throughout this codebase, so the
    queryset fails safe rather than open if a future change ever grants a
    non-ADMIN role access to this viewset. Exercised directly against
    get_queryset() rather than through HTTP, since HTTP cannot reach the
    non-ADMIN branch today.
    """

    @pytest.fixture(autouse=True)
    def setup(self, db, cn_tenant, eu_tenant):
        self.cn_tenant = cn_tenant
        self.eu_tenant = eu_tenant
        _, cn_hash, cn_prefix = ExternalApiKey.generate_key()
        self.cn_key = ExternalApiKey.objects.create(
            tenant=cn_tenant, name="CN Key", system_type="HOSPITAL",
            key_hash=cn_hash, key_prefix=cn_prefix,
        )
        _, eu_hash, eu_prefix = ExternalApiKey.generate_key()
        self.eu_key = ExternalApiKey.objects.create(
            tenant=eu_tenant, name="EU Key", system_type="HOSPITAL",
            key_hash=eu_hash, key_prefix=eu_prefix,
        )

    def _queryset_for(self, role, tenant):
        from types import SimpleNamespace

        from apps.death_sync.views import ExternalApiKeyViewSet

        view = ExternalApiKeyViewSet()
        view.request = SimpleNamespace(user=SimpleNamespace(role=role), tenant=tenant)
        return view.get_queryset()

    def test_non_admin_queryset_excludes_other_tenant_key(self):
        qs = self._queryset_for("VIEWER", self.cn_tenant)
        assert list(qs) == [self.cn_key]

    def test_admin_queryset_sees_every_tenant(self):
        qs = self._queryset_for("ADMIN", self.cn_tenant)
        assert set(qs) == {self.cn_key, self.eu_key}


# ── C10: DeathSyncHealthView tenant-scoped counts ──────────────────────

@pytest.mark.django_db
class TestDeathSyncHealthTenantIsolation:
    """DeathSyncHealthView's three counts must be scoped to the caller's
    tenant (C10).

    Pre-fix, all three queries (`pending_count`, `failed_count`,
    `failed_webhooks`) ran with no tenant filter at all — `getattr(request,
    'tenant', None)` was computed and immediately discarded — so any valid
    API key saw pending/failed volumes aggregated across every tenant.

    The view's permission wiring is unrelated to this fix and, independently
    of it, currently rejects every request made through the real URL:
    APIKeyAuthentication authenticates successfully but returns AnonymousUser
    as request.user (see apps/death_sync/authentication.py), so the view's
    inherited default IsAuthenticated denies every valid key with a 403. That
    is a separate, pre-existing bug outside the four findings this pass
    fixes — flagged separately rather than folded in here. To test the
    tenant-scoping logic itself without being blocked by that unrelated bug,
    this drives APIKeyAuthentication directly (exactly as
    TestAPIKeyAuthentication above does) and then calls the view's get()
    method directly, bypassing only the permission layer.
    """

    @pytest.fixture(autouse=True)
    def setup(self, db, cn_tenant, eu_tenant):
        from apps.death_sync.models import WebhookConfig, WebhookDeliveryLog, WebhookDeliveryStatus

        self.cn_tenant = cn_tenant
        self.eu_tenant = eu_tenant

        raw_cn, cn_hash, cn_prefix = ExternalApiKey.generate_key()
        self.cn_key = ExternalApiKey.objects.create(
            tenant=cn_tenant, name="CN Key", system_type="HOSPITAL",
            key_hash=cn_hash, key_prefix=cn_prefix,
        )
        self.raw_cn_key = raw_cn

        raw_eu, eu_hash, eu_prefix = ExternalApiKey.generate_key()
        self.eu_key = ExternalApiKey.objects.create(
            tenant=eu_tenant, name="EU Key", system_type="HOSPITAL",
            key_hash=eu_hash, key_prefix=eu_prefix,
        )
        self.raw_eu_key = raw_eu

        # CN tenant has no registrations or failed webhooks of its own.
        # EU tenant has one pending, one failed, and one failed webhook.
        DeathRegistrationRequest.objects.create(
            tenant=eu_tenant, api_key=self.eu_key, idempotency_key="eu-pending",
            source_system="HOSPITAL", source_payload={}, status=DeathRegistrationStatus.PENDING,
        )
        DeathRegistrationRequest.objects.create(
            tenant=eu_tenant, api_key=self.eu_key, idempotency_key="eu-failed",
            source_system="HOSPITAL", source_payload={}, status=DeathRegistrationStatus.FAILED,
        )
        eu_webhook = WebhookConfig.objects.create(
            tenant=eu_tenant, api_key=self.eu_key, url="https://example.com/eu",
            signing_secret="eu_secret",
        )
        eu_registration = DeathRegistrationRequest.objects.create(
            tenant=eu_tenant, api_key=self.eu_key, idempotency_key="eu-webhook-src",
            source_system="HOSPITAL", source_payload={}, status=DeathRegistrationStatus.PROCESSED,
        )
        WebhookDeliveryLog.objects.create(
            webhook=eu_webhook, registration=eu_registration, status=WebhookDeliveryStatus.FAILED,
        )

    def _call_health_view(self, raw_key):
        from rest_framework.test import APIRequestFactory

        from apps.death_sync.views import DeathSyncHealthView

        factory = APIRequestFactory()
        request = factory.get("/api/v1/death-sync/health/", HTTP_AUTHORIZATION=f"ApiKey {raw_key}")
        APIKeyAuthentication().authenticate(request)  # sets request.api_key / request.tenant
        return DeathSyncHealthView().get(request)

    def test_cn_caller_does_not_see_eu_tenant_counts(self):
        response = self._call_health_view(self.raw_cn_key)
        assert response.data["system"]["pending_registrations_24h"] == 0
        assert response.data["system"]["failed_registrations_24h"] == 0
        assert response.data["system"]["failed_webhooks_24h"] == 0

    def test_eu_caller_sees_only_its_own_counts(self):
        response = self._call_health_view(self.raw_eu_key)
        assert response.data["system"]["pending_registrations_24h"] == 1
        assert response.data["system"]["failed_registrations_24h"] == 1
        assert response.data["system"]["failed_webhooks_24h"] == 1


# ── C11: HasValidApiKey — the "every valid API key gets 403" bug ───────

@pytest.mark.django_db
class TestDeathRegistrationPermissionFix:
    """C11: DeathRegistrationViewSet declared authentication_classes =
    [APIKeyAuthentication] but never overrode permission_classes, so it
    inherited the project-wide default (IsAuthenticated). APIKeyAuthentication
    authenticates a valid key successfully by returning AnonymousUser as
    request.user (see its docstring — there is no real Django user for an
    external system's credential); AnonymousUser.is_authenticated is always
    False, so IsAuthenticated rejected every request bearing a perfectly
    valid API key with 403 before the view ever ran. There was no way to
    reach this endpoint over real HTTP. Fixed by
    apps.core.permissions.HasValidApiKey (checks request.api_key, which
    APIKeyAuthentication sets only on success, instead of request.user).

    Two of the paths this bug touches (POST with a fully valid payload,
    i.e. a real 201) run into an unrelated, pre-existing bug:
    apps/death_sync/encrypted_json.py's EncryptedJSONField.get_prep_value()
    calls plain stdlib json.dumps() (no DjangoJSONEncoder) on
    source_payload, which contains a python `date` object once
    DeathRegistrationCreateSerializer validates death_date — so a *valid*
    single registration 500s over HTTP regardless of this permission fix.
    That is a separate, already-flagged bug and out of scope here. This
    class proves the permission gate itself using paths that do not depend
    on it: GET list (200), and a POST payload that fails serializer
    validation before source_payload is ever built (400) — both prove the
    request reached the view, which is what the permission fix owns.
    """

    @pytest.fixture(autouse=True)
    def setup(self, db, cn_tenant):
        self.tenant = cn_tenant
        raw_key, key_hash, key_prefix = ExternalApiKey.generate_key()
        self.key = ExternalApiKey.objects.create(
            tenant=cn_tenant, name="C11 Key", system_type="HOSPITAL",
            key_hash=key_hash, key_prefix=key_prefix, can_register_death=True,
        )
        self.raw_key = raw_key

    def test_valid_key_list_is_not_403(self):
        resp = _api_key_client(self.raw_key).get("/api/v1/death-sync/register/")
        assert resp.status_code == status.HTTP_200_OK

    def test_valid_key_invalid_payload_is_400_not_403(self):
        """Missing the required death_date fails serializer validation
        inside the view — a 403 here would mean the request never got that
        far, i.e. the pre-fix bug is back."""
        resp = _api_key_client(self.raw_key).post(
            "/api/v1/death-sync/register/", {"soul_lookup": {"name": "x"}}, format="json",
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST

    def test_no_key_is_401_not_500(self):
        """No Authorization header at all: APIKeyAuthentication.authenticate()
        returns None (this authenticator does not apply — distinct from
        rejecting a bad key), so request.api_key is never set. HasValidApiKey
        must still deny this: AllowAny would have let it through with no
        request.api_key set, and create() reads request.api_key
        unconditionally — an AttributeError (500) instead of a clean denial."""
        resp = APIClient().get("/api/v1/death-sync/register/")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    def test_invalid_key_is_401(self):
        """Confirms the permission change doesn't weaken
        APIKeyAuthentication's own AuthenticationFailed handling."""
        resp = _api_key_client("not-a-real-key").get("/api/v1/death-sync/register/")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    def test_inactive_key_is_401(self):
        self.key.is_active = False
        self.key.save()
        resp = _api_key_client(self.raw_key).get("/api/v1/death-sync/register/")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    def test_expired_key_is_401(self):
        from datetime import timedelta

        from django.utils import timezone
        self.key.expires_at = timezone.now() - timedelta(days=1)
        self.key.save()
        resp = _api_key_client(self.raw_key).get("/api/v1/death-sync/register/")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
class TestDeathRegistrationEncryptedJSONFieldDateFix:
    """The unrelated bug TestDeathRegistrationPermissionFix's docstring
    flagged and routed around: DeathRegistrationCreateSerializer.death_date
    is a DateField, so serializer.validated_data["death_date"] is a real
    python `date` object by the time DeathRegistrationViewSet.create()
    passes it through as source_payload. EncryptedJSONField.get_prep_value()
    used plain stdlib json.dumps() with no DjangoJSONEncoder, so saving that
    payload raised TypeError — every *valid* single registration 500'd,
    regardless of the permission fix. TestDeathSyncService.
    test_register_death_success (above) never caught this because it calls
    DeathSyncService.register_death() directly with a string death_date,
    bypassing the serializer's DateField conversion entirely — this class
    goes through the real HTTP endpoint instead, the only path that
    actually produces a date object in the payload.
    """

    @pytest.fixture(autouse=True)
    def setup(self, db, cn_tenant, soul):
        self.tenant = cn_tenant
        self.soul = soul
        raw_key, key_hash, key_prefix = ExternalApiKey.generate_key()
        self.key = ExternalApiKey.objects.create(
            tenant=cn_tenant, name="Date Fix Key", system_type="HOSPITAL",
            key_hash=key_hash, key_prefix=key_prefix, can_register_death=True,
        )
        self.raw_key = raw_key

    def test_a_valid_registration_succeeds_over_http_not_500(self):
        resp = _api_key_client(self.raw_key).post(
            "/api/v1/death-sync/register/",
            {"soul_lookup": {"soul_id": str(self.soul.id)}, "death_date": "2026-06-01"},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        assert resp.data["status"] == "accepted"

    def test_the_saved_request_record_is_processed_and_soul_is_dead(self):
        """Confirms the fix isn't just "doesn't crash" — the write actually
        completes and the domain transition happens, not just a 201 with a
        half-saved row.

        Deliberately not asserting on source_payload's decoded shape here:
        EncryptedJSONField.from_db_value round-trips it back to a string
        rather than a dict under this test's SQLite override (a separate,
        pre-existing wrinkle in how this custom field composes with
        SQLite's own JSONField handling — unrelated to the date-encoding
        TypeError this test class exists to cover, and out of scope here).
        """
        resp = _api_key_client(self.raw_key).post(
            "/api/v1/death-sync/register/",
            {"soul_lookup": {"soul_id": str(self.soul.id)}, "death_date": "2026-06-01"},
            format="json",
        )
        record = DeathRegistrationRequest.objects.get(id=resp.data["registration_id"])
        assert record.status == DeathRegistrationStatus.PROCESSED
        self.soul.refresh_from_db()
        assert self.soul.current_state != SoulState.ALIVE


@pytest.mark.django_db
class TestDeathSyncHealthPermissionFix:
    """C11 (same fix, third view): DeathSyncHealthView over real HTTP, not
    the direct view.get() call TestDeathSyncHealthTenantIsolation above uses
    to sidestep this exact bug. This class is the full round trip: it fails
    with 403 pre-fix and succeeds post-fix, unlike the registration/webhook
    views this view has no unrelated serializer/encryption bug blocking it,
    so it is verified end to end with a real 200.
    """

    @pytest.fixture(autouse=True)
    def setup(self, db, cn_tenant):
        raw_key, key_hash, key_prefix = ExternalApiKey.generate_key()
        self.key = ExternalApiKey.objects.create(
            tenant=cn_tenant, name="C11 Health Key", system_type="HOSPITAL",
            key_hash=key_hash, key_prefix=key_prefix,
        )
        self.raw_key = raw_key

    def test_valid_key_gets_real_response(self):
        resp = _api_key_client(self.raw_key).get("/api/v1/death-sync/health/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["api_key"]["is_active"] is True

    def test_no_key_is_401(self):
        resp = APIClient().get("/api/v1/death-sync/health/")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    def test_invalid_key_is_401(self):
        resp = _api_key_client("not-a-real-key").get("/api/v1/death-sync/health/")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED
