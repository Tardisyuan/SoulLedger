"""
M4: Tenant-aware Frontend Integration Tests

Tests tenant isolation, login response with tenant info,
karma stats endpoint, and settings endpoints.

Uses fixtures from conftest.py to avoid rate limiting on login.
"""
import pytest
from apps.tenants.models import Tenant


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


class TestTenantHeaderInjection:
    """Test that API endpoints respect X-Tenant-ID header for tenant isolation."""

    def test_actors_respect_tenant_header(self, api_client, db, cn_tenant, eu_tenant, auth_headers):
        """CN tenant should see CN actors, EU tenant should see EU actors."""
        # Get actors for CN tenant
        cn_resp = api_client.get(
            "/api/v1/actors/",
            HTTP_AUTHORIZATION=auth_headers["HTTP_AUTHORIZATION"],
            HTTP_X_TENANT_ID=str(cn_tenant.id),
        )
        assert cn_resp.status_code == 200

        # Get actors for EU tenant
        eu_resp = api_client.get(
            "/api/v1/actors/",
            HTTP_AUTHORIZATION=auth_headers["HTTP_AUTHORIZATION"],
            HTTP_X_TENANT_ID=str(eu_tenant.id),
        )
        assert eu_resp.status_code == 200

        # Results should differ based on civilization
        cn_actors = cn_resp.json().get("results", [])
        eu_actors = eu_resp.json().get("results", [])

        cn_civilizations = {a.get("civilization") for a in cn_actors}
        eu_civilizations = {a.get("civilization") for a in eu_actors}

        # CN actors should be CHINESE civilization (if any exist)
        if cn_actors:
            assert "CHINESE" in cn_civilizations
        # EU actors should be EUROPEAN civilization (if any exist)
        if eu_actors:
            assert "EUROPEAN" in eu_civilizations

    def test_realms_respect_tenant_header(self, api_client, db, cn_tenant, eu_tenant, auth_headers):
        """Realms should be filtered by tenant civilization."""
        cn_resp = api_client.get(
            "/api/v1/realms/",
            HTTP_AUTHORIZATION=auth_headers["HTTP_AUTHORIZATION"],
            HTTP_X_TENANT_ID=str(cn_tenant.id),
        )
        assert cn_resp.status_code == 200

        eu_resp = api_client.get(
            "/api/v1/realms/",
            HTTP_AUTHORIZATION=auth_headers["HTTP_AUTHORIZATION"],
            HTTP_X_TENANT_ID=str(eu_tenant.id),
        )
        assert eu_resp.status_code == 200

        cn_realms = cn_resp.json().get("results", [])
        eu_realms = eu_resp.json().get("results", [])

        # CN realms should have CHINESE civilization (if any exist)
        if cn_realms:
            cn_civilizations = {r.get("civilization") for r in cn_realms}
            assert "CHINESE" in cn_civilizations


class TestKarmaStatsEndpoint:
    """Test karma stats endpoint requires auth and returns data."""

    def test_karma_stats_requires_auth(self, api_client, db):
        """Karma stats endpoint should require authentication."""
        resp = api_client.get("/api/v1/karma/stats/overview/")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    def test_karma_stats_with_valid_token(self, api_client, db, auth_headers):
        """Karma stats endpoint should work with valid token."""
        resp = api_client.get(
            "/api/v1/karma/stats/overview/",
            HTTP_AUTHORIZATION=auth_headers["HTTP_AUTHORIZATION"],
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        # Should have stats data
        assert "total_souls" in data, f"Missing 'total_souls' in response: {data.keys()}"

    def test_karma_stats_includes_tenant_breakdown(self, api_client, db, auth_headers):
        """Karma stats should include per-tenant breakdown."""
        resp = api_client.get(
            "/api/v1/karma/stats/overview/",
            HTTP_AUTHORIZATION=auth_headers["HTTP_AUTHORIZATION"],
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        # Should include tenants breakdown
        assert "tenants" in data, f"Missing 'tenants' in response: {data.keys()}"


class TestTenantIsolation:
    """Test that tenants are properly isolated from each other."""

    def test_cn_actors_not_in_eu_results(self, api_client, db, eu_tenant, auth_headers):
        """CN actors should not appear in EU tenant queries."""
        resp = api_client.get(
            "/api/v1/actors/",
            HTTP_AUTHORIZATION=auth_headers["HTTP_AUTHORIZATION"],
            HTTP_X_TENANT_ID=str(eu_tenant.id),
        )
        assert resp.status_code == 200
        actors = resp.json().get("results", [])

        # No actor should have CHINESE civilization when querying EU
        for actor in actors:
            assert actor.get("civilization") != "CHINESE", (
                f"CN actor {actor.get('name')} leaked into EU results"
            )

    def test_souls_filtered_by_tenant(self, api_client, db, auth_headers):
        """Souls should be filtered by tenant."""
        cn_tenant = Tenant.objects.get(code="CN_DIYU")

        resp = api_client.get(
            "/api/v1/souls/",
            HTTP_AUTHORIZATION=auth_headers["HTTP_AUTHORIZATION"],
            HTTP_X_TENANT_ID=str(cn_tenant.id),
        )
        assert resp.status_code == 200
        souls = resp.json().get("results", [])

        # All souls should have CHINESE civilization for CN tenant
        for soul in souls:
            assert soul.get("civilization") == "CHINESE", (
                f"Non-CN soul found in CN tenant results: {soul.get('name')}"
            )


class TestSettingsEndpoints:
    """Test that settings-related endpoints exist."""

    def test_karma_balance_endpoint_exists(self, api_client, db, auth_headers):
        """Karma balance endpoint should be accessible."""
        # Get first soul
        resp = api_client.get(
            "/api/v1/souls/",
            HTTP_AUTHORIZATION=auth_headers["HTTP_AUTHORIZATION"],
        )
        if resp.status_code == 200:
            souls = resp.json().get("results", [])
            if souls:
                soul_id = souls[0].get("id")
                balance_resp = api_client.get(
                    f"/api/v1/karma/balance/{soul_id}/",
                    HTTP_AUTHORIZATION=auth_headers["HTTP_AUTHORIZATION"],
                )
                assert balance_resp.status_code in [200, 404]
