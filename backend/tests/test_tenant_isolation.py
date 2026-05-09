"""
Tests for tenant isolation in API endpoints.
"""
import pytest
from rest_framework.test import APIClient
from apps.souls.models import Soul
from apps.tenants.models import Tenant


@pytest.mark.django_db
class TestTenantIsolationAPI:
    """Test tenant isolation at API level."""

    @pytest.fixture(autouse=True)
    def setup_tenants(self, db):
        self.cn = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "Chinese Diyu"}
        )[0]
        self.eu = Tenant.objects.get_or_create(
            code="EU_HEAVEN_HELL", defaults={"display_name": "European Heaven/Hell"}
        )[0]

    def _create_user(self, username, role, tenant, django_user_model):
        user = django_user_model.objects.create_user(
            username=username, password="testpass123", role=role
        )
        user.tenant = tenant
        user.save()
        return user

    def _create_soul(self, name, tenant):
        return Soul.objects.create(name=name, tenant=tenant)

    def _get_auth_headers(self, client, user):
        """Login and get auth headers."""
        resp = client.post("/api/v1/auth/login/", {
            "username": user.username,
            "password": "testpass123",
        })
        token = resp.data["access"]
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def test_soul_tenant_isolation(self, django_user_model):
        """Soul from tenant A cannot be accessed by tenant B."""
        # Create users for each tenant
        cn_user = self._create_user("cn_judge", "JUDGE", self.cn, django_user_model)
        eu_user = self._create_user("eu_judge", "JUDGE", self.eu, django_user_model)

        # Create souls for each tenant
        cn_soul = self._create_soul("CN Soul Alpha", self.cn)
        eu_soul = self._create_soul("EU Soul Beta", self.eu)

        # CN client setup
        cn_client = APIClient()
        cn_headers = self._get_auth_headers(cn_client, cn_user)

        # EU client setup
        eu_client = APIClient()
        eu_headers = self._get_auth_headers(eu_client, eu_user)

        # CN user should see only CN souls
        resp = cn_client.get("/api/v1/souls/", **cn_headers)
        assert resp.status_code == 200
        cn_soul_ids = [s["id"] for s in resp.data["results"]]
        assert str(cn_soul.id) in cn_soul_ids
        assert str(eu_soul.id) not in cn_soul_ids

        # EU user should see only EU souls
        resp = eu_client.get("/api/v1/souls/", **eu_headers)
        assert resp.status_code == 200
        eu_soul_ids = [s["id"] for s in resp.data["results"]]
        assert str(eu_soul.id) in eu_soul_ids
        assert str(cn_soul.id) not in eu_soul_ids

        # EU user cannot access CN soul detail
        resp = eu_client.get(f"/api/v1/souls/{cn_soul.id}/", **eu_headers)
        assert resp.status_code == 404

        # CN user cannot access EU soul detail
        resp = cn_client.get(f"/api/v1/souls/{eu_soul.id}/", **cn_headers)
        assert resp.status_code == 404

    def test_cross_tenant_karma_access_denied(self, django_user_model):
        """Karma endpoint denies access to soul from another tenant."""
        cn_user = self._create_user("cn_karma_user", "ADMIN", self.cn, django_user_model)
        eu_user = self._create_user("eu_karma_user", "ADMIN", self.eu, django_user_model)

        cn_soul = self._create_soul("CN Soul Karma", self.cn)

        # EU client trying to access CN soul karma
        eu_client = APIClient()
        eu_headers = self._get_auth_headers(eu_client, eu_user)

        # Soul is hidden due to tenant isolation - returns 404 (not 403)
        resp = eu_client.get(f"/api/v1/karma/balance/{cn_soul.id}/", **eu_headers)
        assert resp.status_code == 404

    def test_admin_can_access_own_tenant_souls(self, django_user_model):
        """Admin users can access souls from their own tenant."""
        admin = self._create_user("admin_user", "ADMIN", self.cn, django_user_model)
        soul = self._create_soul("Admin Soul", self.cn)

        client = APIClient()
        headers = self._get_auth_headers(client, admin)

        resp = client.get(f"/api/v1/souls/{soul.id}/", **headers)
        assert resp.status_code == 200
        assert resp.data["name"] == "Admin Soul"
