"""Two halls may send the same explicit X-Idempotency-Key.

`uniq_death_reg_idempotency` used to be (source_system, idempotency_key) over
every tenant, and the single-path IntegrityError handler looked the "existing"
row up without a tenant: tenant B replaying tenant A's key got A's
registration_id and status back as a 409.
"""
import pytest
from rest_framework.test import APIClient

from apps.death_sync.models import DeathRegistrationRequest, ExternalApiKey
from apps.souls.models import Soul
from apps.tenants.models import Tenant


def _client(tenant):
    raw, key_hash, key_prefix = ExternalApiKey.generate_key()
    ExternalApiKey.objects.create(
        tenant=tenant, name="feed", system_type="HOSPITAL", key_hash=key_hash, key_prefix=key_prefix,
    )
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"ApiKey {raw}")
    return c


def _body(tenant, name):
    soul = Soul.objects.create(name=name, tenant=tenant)
    return {"soul_lookup": {"soul_id": str(soul.id)}, "death_date": "2026-06-01"}


@pytest.mark.django_db
def test_the_same_key_in_two_tenants_registers_twice_and_never_leaks_across():
    a = Tenant.objects.create(code="IDEM_A", display_name="A")
    b = Tenant.objects.create(code="IDEM_B", display_name="B")
    ca, cb = _client(a), _client(b)
    url = "/api/v1/death-sync/register/"
    ra = ca.post(url, _body(a, "sa"), format="json", HTTP_X_IDEMPOTENCY_KEY="shared")
    rb = cb.post(url, _body(b, "sb"), format="json", HTTP_X_IDEMPOTENCY_KEY="shared")
    assert ra.status_code == 201, ra.content
    assert rb.status_code == 201, rb.content
    assert ra.json()["registration_id"] != rb.json()["registration_id"]
    assert DeathRegistrationRequest.objects.get(id=rb.json()["registration_id"]).tenant_id == b.id
    # a replay inside one tenant still answers with that tenant's own row
    again = cb.post(url, _body(b, "sb2"), format="json", HTTP_X_IDEMPOTENCY_KEY="shared")
    assert again.status_code == 409
    assert again.json()["registration_id"] == rb.json()["registration_id"]
