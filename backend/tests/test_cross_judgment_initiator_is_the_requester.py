"""Who opened a cross-tenant judgment is decided by the request, not the body.

`initiating_tenant` was a plain writable field and `perform_create` pinned
only `tenant`. The two columns are read by different things --
`get_queryset` filters on `initiating_tenant`, `TenantPermission
.has_object_permission` compares `tenant` -- so setting them to different
tenants produced a row that:

  * appears in the *other* tenant's list (it matches their initiating_tenant),
  * that tenant cannot open (403, because obj.tenant is the attacker's),
  * the creator cannot see either (404, because get_queryset filters on
    initiating_tenant and theirs does not match),
  * carries create_user NULL, because CrossTenantJudgmentViewSet does not
    apply AuditUserViewSetMixin,
  * and neither party can delete.

Measured 2026-08-29: a JUDGE in tenant B posted `initiating_tenant: <A>` and
got a 201. The victim tenant's list then showed count 1 for a record they
never created.

The fix stamps both columns from the same source in `perform_create`, so
they cannot disagree. These tests assert the write is refused *and* that the
stored row is attributed to the requester -- asserting only the 400 would
stay green if the field were merely ignored while `tenant` alone kept being
set, which is the state that produced the orphan row in the first place.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.dispatch.models import CrossTenantJudgment
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
def tenants(db):
    a = Tenant.objects.get_or_create(code="CJ_A", defaults={"display_name": "CJ A"})[0]
    b = Tenant.objects.get_or_create(code="CJ_B", defaults={"display_name": "CJ B"})[0]
    return a, b


@pytest.fixture
def judge_in_b(db, tenants):
    """JUDGE, not ADMIN -- ADMIN short-circuits the object-level tenant check."""
    _, b = tenants
    return User.objects.create_user(
        username="cj_judge_b", password="x", role="JUDGE", tenant=b
    )


@pytest.mark.django_db
def test_a_forged_initiating_tenant_does_not_land_in_the_victims_list(tenants, judge_in_b):
    tenant_a, tenant_b = tenants
    client = _jwt_client(judge_in_b, tenant_b)

    resp = client.post(
        f"{BASE}/cross-tenant-judgments/",
        {
            "title": "forged",
            "description": "planted by tenant B",
            "initiating_tenant": tenant_a.pk,
        },
        format="json",
    )
    assert resp.status_code == 201, resp.data

    row = CrossTenantJudgment.objects.get(pk=resp.data["id"])
    assert row.initiating_tenant_id == tenant_b.pk, (
        "the body decided who opened the judgment; it must be the requester"
    )
    assert row.tenant_id == tenant_b.pk
    assert row.initiating_tenant_id == row.tenant_id, (
        "the two tenant columns disagree -- that disagreement is exactly what "
        "produces a row one tenant can see and neither can open"
    )

    # And the creator can actually retrieve what they just made, which the
    # orphan row could not do.
    resp = client.get(f"{BASE}/cross-tenant-judgments/{row.pk}/")
    assert resp.status_code == 200, (
        f"creator got {resp.status_code} on their own judgment -- the orphan "
        f"shape is back"
    )


@pytest.mark.django_db
def test_patch_cannot_re_point_an_honest_judgment_at_another_tenant(tenants, judge_in_b):
    tenant_a, tenant_b = tenants
    client = _jwt_client(judge_in_b, tenant_b)

    resp = client.post(
        f"{BASE}/cross-tenant-judgments/",
        {"title": "honest", "description": "opened by B"},
        format="json",
    )
    assert resp.status_code == 201, resp.data
    pk = resp.data["id"]

    resp = client.patch(
        f"{BASE}/cross-tenant-judgments/{pk}/",
        {"initiating_tenant": tenant_a.pk},
        format="json",
    )
    assert resp.status_code == 400, (
        f"re-pointing initiating_tenant returned {resp.status_code}; a judgment "
        f"moved this way is lost to both tenants"
    )
    assert "initiating_tenant" in resp.data

    row = CrossTenantJudgment.objects.get(pk=pk)
    assert row.initiating_tenant_id == tenant_b.pk


@pytest.mark.django_db
def test_a_judgment_can_still_be_opened_and_edited(tenants, judge_in_b):
    """The positive control: the lock must not close the endpoint."""
    _, tenant_b = tenants
    client = _jwt_client(judge_in_b, tenant_b)

    resp = client.post(
        f"{BASE}/cross-tenant-judgments/",
        {"title": "ordinary", "description": "d"},
        format="json",
    )
    assert resp.status_code == 201, resp.data
    pk = resp.data["id"]

    resp = client.patch(
        f"{BASE}/cross-tenant-judgments/{pk}/", {"title": "renamed"}, format="json"
    )
    assert resp.status_code == 200, resp.data
    assert CrossTenantJudgment.objects.get(pk=pk).title == "renamed"
