"""`X-Source-System` and `ExternalApiKey.allowed_sources` (2026-11-26 用户决定).

The field was stored and never read. Now a registration may declare its source in `X-Source-System`; the key
must have been granted it (`allowed_sources`, empty = its own `system_type` only). Without the header the source
is `system_type`, as before. `uniq_death_reg_idempotency` is (tenant, source_system, idempotency_key), so the
grant is also what decides whose idempotency space a key may write into.
"""
from io import StringIO

import pytest
from django.core.management import CommandError, call_command
from rest_framework.test import APIClient

from apps.death_sync.models import DeathRegistrationRequest, ExternalApiKey
from apps.souls.models import Soul
from apps.tenants.models import Tenant

URL = "/api/v1/death-sync/register/"


@pytest.fixture
def hall(db):
    return Tenant.objects.create(code="SRC_HALL", display_name="Source hall")


def _client(hall, allowed_sources=(), system_type="MESSAGE_BUS"):
    raw, key_hash, key_prefix = ExternalApiKey.generate_key()
    ExternalApiKey.objects.create(
        tenant=hall, name="relay", system_type=system_type, key_hash=key_hash, key_prefix=key_prefix,
        allowed_sources=list(allowed_sources),
    )
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"ApiKey {raw}")
    return c


def _body(hall, name):
    soul = Soul.objects.create(name=name, tenant=hall)
    return {"soul_lookup": {"soul_id": str(soul.id)}, "death_date": "2026-06-01"}


def _post(client, hall, name, **headers):
    return client.post(URL, _body(hall, name), format="json", **headers)


def test_without_the_header_the_source_is_the_keys_system_type(hall):
    r = _post(_client(hall, ["HOSPITAL"]), hall, "a")
    assert r.status_code == 201, r.content
    assert DeathRegistrationRequest.objects.get(id=r.json()["registration_id"]).source_system == "MESSAGE_BUS"


def test_a_granted_source_passes_and_is_recorded(hall):
    r = _post(_client(hall, ["HOSPITAL", "POLICE"]), hall, "a", HTTP_X_SOURCE_SYSTEM="POLICE")
    assert r.status_code == 201, r.content
    row = DeathRegistrationRequest.objects.get(id=r.json()["registration_id"])
    assert row.source_system == "POLICE"
    assert row.source_system != "MESSAGE_BUS"


def test_a_source_outside_the_grant_is_refused_and_nothing_is_written(hall):
    r = _post(_client(hall, ["HOSPITAL"]), hall, "a", HTTP_X_SOURCE_SYSTEM="GOVERNMENT")
    assert r.status_code == 403, r.content
    assert r.json()["code"] == "KEY_SOURCE_NOT_ALLOWED"
    assert r["Content-Type"].startswith("application/problem+json")
    assert not DeathRegistrationRequest.objects.exists()


def test_a_non_empty_grant_does_not_add_system_type_implicitly(hall):
    r = _post(_client(hall, ["HOSPITAL"]), hall, "a", HTTP_X_SOURCE_SYSTEM="MESSAGE_BUS")
    assert r.status_code == 403
    assert r.json()["code"] == "KEY_SOURCE_NOT_ALLOWED"


def test_an_empty_grant_allows_only_system_type(hall):
    client = _client(hall)
    ok = _post(client, hall, "a", HTTP_X_SOURCE_SYSTEM="MESSAGE_BUS")
    assert ok.status_code == 201, ok.content
    refused = _post(client, hall, "b", HTTP_X_SOURCE_SYSTEM="HOSPITAL")
    assert refused.status_code == 403
    assert refused.json()["code"] == "KEY_SOURCE_NOT_ALLOWED"
    assert DeathRegistrationRequest.objects.count() == 1


def test_the_batch_path_is_refused_too(hall):
    client = _client(hall, ["HOSPITAL"])
    r = client.post(URL, {"batch": True, "registrations": [_body(hall, "a")]}, format="json",
                    HTTP_X_SOURCE_SYSTEM="POLICE")
    assert r.status_code == 403
    assert not DeathRegistrationRequest.objects.exists()
    ok = client.post(URL, {"batch": True, "registrations": [_body(hall, "b")]}, format="json",
                     HTTP_X_SOURCE_SYSTEM="HOSPITAL")
    assert ok.status_code == 201, ok.content
    assert DeathRegistrationRequest.objects.get().source_system == "HOSPITAL"


@pytest.mark.parametrize("value", ["", "hospital", "HOSPITAL SYSTEM", "1HOSPITAL", "H" * 51, "TUDI"])
def test_a_malformed_or_reserved_source_is_400(hall, value):
    allowed = ["TUDI"] if value == "TUDI" else []  # even a (direct-to-DB) grant cannot reach 土地公 rows
    r = _post(_client(hall, allowed), hall, "a", HTTP_X_SOURCE_SYSTEM=value)
    assert r.status_code == 400, r.content
    assert r.json()["code"] == "INVALID_SOURCE_SYSTEM"
    assert not DeathRegistrationRequest.objects.exists()


def test_idempotency_is_per_source(hall):
    client = _client(hall, ["HOSPITAL", "POLICE"])
    h = _post(client, hall, "a", HTTP_X_SOURCE_SYSTEM="HOSPITAL", HTTP_X_IDEMPOTENCY_KEY="k1")
    p = _post(client, hall, "b", HTTP_X_SOURCE_SYSTEM="POLICE", HTTP_X_IDEMPOTENCY_KEY="k1")
    assert h.status_code == 201 and p.status_code == 201, (h.content, p.content)
    assert h.json()["registration_id"] != p.json()["registration_id"]
    again = _post(client, hall, "c", HTTP_X_SOURCE_SYSTEM="HOSPITAL", HTTP_X_IDEMPOTENCY_KEY="k1")
    assert again.status_code == 409
    assert again.json()["registration_id"] == h.json()["registration_id"]


def test_a_key_cannot_reach_another_systems_idempotency_space(hall):
    """A HOSPITAL key's explicit key is not answered (409 + its row) to a key not granted HOSPITAL."""
    hospital = _client(hall, system_type="HOSPITAL")
    first = _post(hospital, hall, "a", HTTP_X_IDEMPOTENCY_KEY="shared")
    assert first.status_code == 201
    other = _client(hall, ["POLICE"])
    refused = _post(other, hall, "b", HTTP_X_SOURCE_SYSTEM="HOSPITAL", HTTP_X_IDEMPOTENCY_KEY="shared")
    assert refused.status_code == 403
    assert "registration_id" not in refused.json()
    own = _post(other, hall, "c", HTTP_X_SOURCE_SYSTEM="POLICE", HTTP_X_IDEMPOTENCY_KEY="shared")
    assert own.status_code == 201
    assert own.json()["registration_id"] != first.json()["registration_id"]


# --- writing the grant ---------------------------------------------------------------------------------------

@pytest.mark.django_db
def test_the_key_serializer_writes_and_validates_allowed_sources():
    from apps.death_sync.serializers import ExternalApiKeySerializer

    good = ExternalApiKeySerializer(data={"name": "n", "system_type": "CUSTOM",
                                          "allowed_sources": ["HOSPITAL", "POLICE", "HOSPITAL"]})
    assert good.is_valid(), good.errors
    assert good.validated_data["allowed_sources"] == ["HOSPITAL", "POLICE"]
    for bad in (["hospital"], ["TUDI"], ["A B"], "HOSPITAL"):
        s = ExternalApiKeySerializer(data={"name": "n", "system_type": "CUSTOM", "allowed_sources": bad})
        assert not s.is_valid()
        assert "allowed_sources" in s.errors


def test_create_api_key_takes_allowed_sources(hall):
    call_command("create_api_key", "relay", "--tenant", hall.code, "--allowed-source", "HOSPITAL",
                 "--allowed-source", "POLICE", stdout=StringIO())
    assert ExternalApiKey.objects.get(name="relay").allowed_sources == ["HOSPITAL", "POLICE"]
    with pytest.raises(CommandError):
        call_command("create_api_key", "bad", "--tenant", hall.code, "--allowed-source", "tudi", stdout=StringIO())
    assert not ExternalApiKey.objects.filter(name="bad").exists()
