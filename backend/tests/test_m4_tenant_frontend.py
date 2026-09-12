"""
M4: Tenant-aware Frontend Integration Tests

Tests login response with tenant info, tenant isolation as the frontend sees
it, and the ledger balance endpoint.

Uses fixtures from conftest.py to avoid rate limiting on login.

Rewritten 2026-09-12. The previous version of this file had, measured:
two tests sending an ``X-Tenant-ID`` header that no backend code reads (the
only occurrence outside tests is the CORS allow-list — the frontend sends it,
the backend resolves the tenant from the JWT); two "isolation" tests that
looped over an empty result set (0 actors, 0 souls) and so executed zero
assertions; and one test whose two nested ``if``s were never entered. All of
them were green. What replaces them creates rows in both tenants, lists as a
non-ADMIN (ADMIN bypasses scoping), and asserts the other tenant's id is
*absent* — the assertion that would actually turn red on a leak.
"""
import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.actors.models import Actor
from apps.souls.models import Soul


def _as(api_client, user):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return api_client


@pytest.fixture
def eu_judge(db, django_user_model, eu_tenant):
    return django_user_model.objects.create_user(
        username="eu_judge_m4", password="judge123", role="JUDGE", tenant=eu_tenant
    )


class TestLoginTenantInfo:
    """Test that login endpoint returns tenant info for frontend redirect."""

    def test_login_returns_tenant_info(self, api_client, db, django_user_model):
        """Login response should include tenant code for frontend redirect."""
        # Create test user with tenant
        from apps.tenants.models import Tenant
        tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "地府"})
        django_user_model.objects.create_user(
            username="test_admin", password="admin123", role="ADMIN", tenant=tenant
        )
        resp = api_client.post(
            "/api/v1/auth/login/",
            {"username": "test_admin", "password": "admin123"},
            content_type="application/json",
        )
        assert resp.status_code == 200, f"Login failed with status {resp.status_code}: {resp.content}"
        data = resp.json()
        assert "user" in data
        user = data["user"]
        assert "tenant" in user
        assert user["tenant"] is not None, "Tenant should not be None for admin user"
        assert "code" in user["tenant"]
        assert "display_name" in user["tenant"]

    def test_login_response_has_access_token(self, api_client, db, django_user_model):
        """Login response should include access and refresh tokens."""
        from apps.tenants.models import Tenant
        tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "地府"})
        django_user_model.objects.create_user(
            username="test_admin2", password="admin123", role="ADMIN", tenant=tenant
        )
        resp = api_client.post(
            "/api/v1/auth/login/",
            {"username": "test_admin2", "password": "admin123"},
            content_type="application/json",
        )
        assert resp.status_code == 200, f"Login failed with status {resp.status_code}: {resp.content}"
        data = resp.json()
        assert "access" in data
        assert "refresh" in data


class TestLedgerStatsEndpoint:
    """Test ledger stats endpoint requires auth and returns data."""

    def test_ledger_stats_requires_auth(self, api_client, db):
        """Ledger stats endpoint should require authentication."""
        resp = api_client.get("/api/v1/ledger/stats/overview/")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    def test_ledger_stats_with_valid_token(self, api_client, db, auth_headers):
        """Ledger stats endpoint should work with valid token."""
        resp = api_client.get(
            "/api/v1/ledger/stats/overview/",
            HTTP_AUTHORIZATION=auth_headers["HTTP_AUTHORIZATION"],
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        # Should have stats data
        assert "total_souls" in data, f"Missing 'total_souls' in response: {data.keys()}"

    def test_ledger_stats_includes_tenant_breakdown(self, api_client, db, auth_headers):
        """Ledger stats should include per-tenant breakdown."""
        resp = api_client.get(
            "/api/v1/ledger/stats/overview/",
            HTTP_AUTHORIZATION=auth_headers["HTTP_AUTHORIZATION"],
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        # Should include tenants breakdown
        assert "tenants" in data, f"Missing 'tenants' in response: {data.keys()}"


class TestTenantIsolation:
    """The tenant comes from the JWT, not a header; a scoped role sees only its own rows."""

    def test_cn_actors_not_in_eu_results(self, api_client, cn_tenant, eu_tenant, eu_judge):
        cn = Actor.objects.create(name="判官", civilization="CHINESE", role="JUDGE", tenant=cn_tenant)
        eu = Actor.objects.create(name="Hades", civilization="EUROPEAN", role="JUDGE", tenant=eu_tenant)

        resp = _as(api_client, eu_judge).get("/api/v1/actors/")
        assert resp.status_code == 200, resp.content
        ids = {a["id"] for a in resp.json()["results"]}
        assert str(eu.id) in ids
        assert str(cn.id) not in ids, "CN actor leaked into EU results"

    def test_souls_filtered_by_tenant(self, api_client, cn_tenant, eu_tenant, judge_user):
        cn = Soul.objects.create(name="CN Soul", tenant=cn_tenant)
        eu = Soul.objects.create(name="EU Soul", tenant=eu_tenant)

        resp = _as(api_client, judge_user).get("/api/v1/souls/")
        assert resp.status_code == 200, resp.content
        ids = {s["id"] for s in resp.json()["results"]}
        assert str(cn.id) in ids
        assert str(eu.id) not in ids, "EU soul leaked into CN results"


class TestLedgerBalanceEndpoint:
    """``/ledger/balance/{soul}/`` answers for the caller's own soul and 404s for another tenant's."""

    def test_own_soul_has_a_balance(self, api_client, cn_tenant, auth_headers):
        soul = Soul.objects.create(name="Balanced", tenant=cn_tenant)
        resp = api_client.get(f"/api/v1/ledger/balance/{soul.id}/", **auth_headers)
        assert resp.status_code == 200, resp.content
        assert "karmic_balance" in resp.json()

    def test_other_tenants_soul_is_not_found(self, api_client, eu_tenant, auth_headers):
        soul = Soul.objects.create(name="Elsewhere", tenant=eu_tenant)
        resp = api_client.get(f"/api/v1/ledger/balance/{soul.id}/", **auth_headers)
        assert resp.status_code == 404, resp.content
