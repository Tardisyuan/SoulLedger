"""The parties to a dispatch cannot be re-pointed after it is proposed.

WHAT THIS GUARDS. `DispatchRecordSerializer` used to expose `soul`,
`source_tenant` and `target_tenant` as plain writable fields. Every check the
approve/execute path runs reads `target_tenant`, so an attacker who controls
that column controls the check. The exploit measured on 2026-08-29 was four
requests, all 2xx, ending with a soul that belonged to tenant A owned by
tenant B:

    POST   /dispatch/records/   source=B target=B soul=<B's own soul>   201
    PATCH  /records/{id}/       {"soul": <A's soul>, "source_tenant": A} 200
    POST   /records/{id}/approve/                                       200
    POST   /records/{id}/execute/                                       200
    -> soul_a.tenant_id  1 -> 2

The self-dispatch in step one is not incidental. `TenantPermission
.has_object_permission` compares `obj.tenant`, which `propose()` stamps from
`source_tenant`; seeding B->B is what keeps that column pointing at the
attacker's own tenant so the object-level check keeps passing while `soul`
and `source_tenant` move underneath it.

WHY THE ORIGINAL REASONING MISSED IT. The serializer's docstring argues at
length about `status` and `dispatched_by`, and it is correct about them.
Locking down how a record's state moves says nothing about *which* record it
is. `DispatchService.propose()` validates `soul.tenant_id == source_tenant.id`
and is the only place that link is ever checked -- the invariant lived in the
create path, and the update path was never told about it.

WHY THESE TESTS USE A REAL JWT. `force_authenticate` does not run
TenantMiddleware, so `request.tenant` is None and `TenantPermission
.has_permission` refuses before any tenant comparison happens. A test written
that way gets a 403 for the wrong reason and would pass against the
vulnerable code. Six tests in this suite were found doing exactly that.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

User = get_user_model()
BASE = "/api/v1/dispatch"


def _jwt_client(user, tenant):
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def two_tenants(db):
    a = Tenant.objects.get_or_create(code="PF_A", defaults={"display_name": "Parties A"})[0]
    b = Tenant.objects.get_or_create(code="PF_B", defaults={"display_name": "Parties B"})[0]
    return a, b


@pytest.fixture
def attacker(db, two_tenants):
    """A MODERATOR in tenant B.

    Deliberately not ADMIN: ADMIN short-circuits `TenantPermission
    .has_object_permission`, so an exploit demonstrated as ADMIN proves
    nothing about tenant isolation. MODERATOR holds `dispatch.manage`, which
    is what the PATCH route requires.
    """
    _, b = two_tenants
    return User.objects.create_user(
        username="pf_attacker", password="x", role="MODERATOR", tenant=b
    )


@pytest.mark.django_db
def test_the_four_request_soul_theft_chain_is_broken(two_tenants, attacker):
    """The chain that moved a soul across tenants, replayed end to end."""
    tenant_a, tenant_b = two_tenants
    victim = Soul.objects.create(
        name="VictimSoul", current_state=SoulState.ALIVE, tenant=tenant_a
    )
    own = Soul.objects.create(
        name="AttackerSoul", current_state=SoulState.ALIVE, tenant=tenant_b
    )
    client = _jwt_client(attacker, tenant_b)

    # Step 1: a self-dispatch, which is legitimate and must keep working.
    resp = client.post(
        f"{BASE}/records/",
        {
            "source_tenant": tenant_b.pk,
            "target_tenant": tenant_b.pk,
            "soul": str(own.pk),
            "reason": "seed",
        },
        format="json",
    )
    assert resp.status_code == 201, resp.data
    record_id = resp.data["id"]

    # Step 2: the step that used to return 200.
    resp = client.patch(
        f"{BASE}/records/{record_id}/",
        {"soul": str(victim.pk), "source_tenant": tenant_a.pk},
        format="json",
    )
    assert resp.status_code == 400, (
        f"Re-pointing a proposed dispatch at another tenant's soul returned "
        f"{resp.status_code}. Every downstream tenant check reads "
        f"`target_tenant`, which this same request can set -- so once this "
        f"succeeds, approve() and execute() are decoration."
    )

    record = DispatchRecord.objects.get(pk=record_id)
    assert record.soul_id == own.pk, "the soul on the record moved"
    assert record.source_tenant_id == tenant_b.pk, "the source tenant moved"

    victim.refresh_from_db()
    assert victim.tenant_id == tenant_a.pk, (
        "the victim soul changed hands -- the whole point of the chain"
    )


@pytest.mark.django_db
def test_each_party_field_is_refused_on_its_own(two_tenants, attacker):
    """One field at a time, so a partial fix cannot look like a whole one.

    Asserting only the combined payload would stay green if, say, `soul` were
    locked down and `source_tenant` were not.
    """
    tenant_a, tenant_b = two_tenants
    own = Soul.objects.create(
        name="SoloSoul", current_state=SoulState.ALIVE, tenant=tenant_b
    )
    other = Soul.objects.create(
        name="OtherSoul", current_state=SoulState.ALIVE, tenant=tenant_a
    )
    client = _jwt_client(attacker, tenant_b)

    resp = client.post(
        f"{BASE}/records/",
        {
            "source_tenant": tenant_b.pk,
            "target_tenant": tenant_b.pk,
            "soul": str(own.pk),
            "reason": "seed",
        },
        format="json",
    )
    assert resp.status_code == 201, resp.data
    record_id = resp.data["id"]

    for field, value in (
        ("soul", str(other.pk)),
        ("source_tenant", tenant_a.pk),
        ("target_tenant", tenant_a.pk),
    ):
        resp = client.patch(
            f"{BASE}/records/{record_id}/", {field: value}, format="json"
        )
        assert resp.status_code == 400, (
            f"PATCH of `{field}` alone returned {resp.status_code}; "
            f"it must be refused on its own, not only alongside the others."
        )
        assert field in resp.data, (
            f"the 400 for `{field}` does not name the field it refused"
        )


@pytest.mark.django_db
def test_a_dispatch_can_still_be_proposed_and_its_reason_edited(two_tenants, attacker):
    """The lock must not be a lock on the whole endpoint.

    `soul`/`source_tenant`/`target_tenant` are deliberately absent from
    `read_only_fields`: `DispatchRecordViewSet.create()` reads them out of
    `validated_data` to call `DispatchService.propose()`, and marking them
    read-only strips them before create() sees them -- every proposal then
    400s with "soul is required". This test is the one that catches that
    over-correction.
    """
    tenant_a, tenant_b = two_tenants
    soul = Soul.objects.create(
        name="EditableSoul", current_state=SoulState.ALIVE, tenant=tenant_b
    )
    client = _jwt_client(attacker, tenant_b)

    resp = client.post(
        f"{BASE}/records/",
        {
            "source_tenant": tenant_b.pk,
            "target_tenant": tenant_a.pk,
            "soul": str(soul.pk),
            "reason": "original reason",
        },
        format="json",
    )
    assert resp.status_code == 201, resp.data
    record_id = resp.data["id"]
    # `resp.data["soul"]` is the UUID object DRF put back, not a string.
    assert str(resp.data["soul"]) == str(soul.pk)
    assert resp.data["target_tenant"] == tenant_a.pk

    resp = client.patch(
        f"{BASE}/records/{record_id}/", {"reason": "revised reason"}, format="json"
    )
    assert resp.status_code == 200, resp.data
    record = DispatchRecord.objects.get(pk=record_id)
    assert record.reason == "revised reason"
    assert record.status == DispatchStatus.PROPOSED
