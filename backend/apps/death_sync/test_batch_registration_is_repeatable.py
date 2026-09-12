"""A second batch of death registrations must not 500 because a first one ran.

`process_batch` defaulted a missing `idempotency_key` to
`batch_{api_key.id}_{idx}` -- the same string for item 0 of every batch the
key ever sends. The second batch hit `uniq_death_reg_idempotency`, and the
`except Exception` inside `register_death`'s `atomic()` block then tried to
save the same row again, which Django refuses with
TransactionManagementError; `process_batch` caught that, saved a *third*
row under the same key, and the IntegrityError from that one reached the
view as a 500. Measured on the pre-fix tree: the first call below passes,
the second raises.

The same `except` also broke the single path: a replayed key raised
TransactionManagementError instead of IntegrityError, so the view's 409
branch never ran.
"""
import pytest
from rest_framework.test import APIClient

from apps.death_sync.models import (
    DeathRegistrationRequest,
    DeathRegistrationStatus,
    ExternalApiKey,
)
from apps.death_sync.services import DeathSyncService
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant


@pytest.fixture
def tenant(db):
    return Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN"})[0]


@pytest.fixture
def api_key(tenant):
    raw, key_hash, key_prefix = ExternalApiKey.generate_key()
    key = ExternalApiKey.objects.create(
        tenant=tenant, name="feed", system_type="HOSPITAL",
        key_hash=key_hash, key_prefix=key_prefix,
    )
    return key, raw


def _alive(tenant, name):
    return Soul.objects.create(name=name, tenant=tenant)


def _item(soul, **extra):
    return {"soul_lookup": {"soul_id": str(soul.id)}, "death_date": "2026-06-01", **extra}


@pytest.mark.django_db
class TestTwoBatchesWithoutKeys:
    def test_the_second_batch_is_processed_not_refused(self, tenant, api_key):
        key, _ = api_key
        first = DeathSyncService.process_batch(tenant, key, [_item(_alive(tenant, "a"))])
        second = DeathSyncService.process_batch(tenant, key, [_item(_alive(tenant, "b"))])
        assert first[0].status == DeathRegistrationStatus.PROCESSED
        assert second[0].status == DeathRegistrationStatus.PROCESSED
        assert first[0].idempotency_key != second[0].idempotency_key

    def test_through_the_view_the_second_batch_is_201_not_500(self, tenant, api_key):
        key, raw = api_key
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"ApiKey {raw}")
        body = lambda soul: {"batch": True, "registrations": [_item(soul)]}  # noqa: E731
        assert client.post(
            "/api/v1/death-sync/register/", body(_alive(tenant, "a")), format="json",
        ).status_code == 201
        resp = client.post(
            "/api/v1/death-sync/register/", body(_alive(tenant, "b")), format="json",
        )
        assert resp.status_code == 201, resp.content


@pytest.mark.django_db
class TestAClientSuppliedDuplicateKey:
    def test_within_one_batch_the_replay_returns_the_row_that_owns_the_key(self, tenant, api_key):
        key, _ = api_key
        a, b = _alive(tenant, "a"), _alive(tenant, "b")
        results = DeathSyncService.process_batch(
            tenant, key, [_item(a, idempotency_key="k1"), _item(b, idempotency_key="k1")],
        )
        assert results[0].status == DeathRegistrationStatus.PROCESSED
        assert results[1].pk == results[0].pk
        b.refresh_from_db()
        assert b.current_state == SoulState.ALIVE, "the replayed item must not have run"
        assert DeathRegistrationRequest.objects.filter(idempotency_key="k1").count() == 1

    def test_on_the_single_path_the_replay_is_a_409(self, tenant, api_key):
        key, raw = api_key
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"ApiKey {raw}")
        soul = _alive(tenant, "a")
        first = client.post(
            "/api/v1/death-sync/register/", _item(soul), format="json",
            HTTP_X_IDEMPOTENCY_KEY="single-1",
        )
        assert first.status_code == 201, first.content
        replay = client.post(
            "/api/v1/death-sync/register/", _item(soul), format="json",
            HTTP_X_IDEMPOTENCY_KEY="single-1",
        )
        assert replay.status_code == 409, replay.content
        assert replay.json()["registration_id"] == first.json()["registration_id"]


@pytest.mark.django_db
class TestBatchItemsAreValidated:
    def test_an_item_without_a_death_date_is_refused_before_anything_dies(self, tenant, api_key):
        key, _ = api_key
        soul = _alive(tenant, "a")
        results = DeathSyncService.process_batch(
            tenant, key, [{"soul_lookup": {"soul_id": str(soul.id)}}],
        )
        assert results[0].status == DeathRegistrationStatus.FAILED
        assert results[0].error_code == "VALIDATION_ERROR"
        assert "death_date" in results[0].error_message
        soul.refresh_from_db()
        assert soul.current_state == SoulState.ALIVE

    def test_a_non_object_item_is_a_validation_error_not_a_crash(self, tenant, api_key):
        key, _ = api_key
        results = DeathSyncService.process_batch(tenant, key, ["not an object"])
        assert results[0].status == DeathRegistrationStatus.FAILED
        assert results[0].error_code == "VALIDATION_ERROR"
