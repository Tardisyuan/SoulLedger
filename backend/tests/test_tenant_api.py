"""
Tenant API tests — M3.4a
"""
import pytest
from rest_framework.test import APIClient
from apps.tenants.models import Tenant


@pytest.mark.django_db
class TestTenantAPI:
    @pytest.fixture(autouse=True)
    def setup_tenants(self):
        """Ensure 3 tenants exist in test database."""
        Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "Chinese Afterlife"}
        )
        Tenant.objects.get_or_create(
            code="EU_HEAVEN_HELL", defaults={"display_name": "European Afterlife"}
        )
        Tenant.objects.get_or_create(
            code="EG_DUAT", defaults={"display_name": "Egyptian Afterlife"}
        )

    def test_list_tenants_returns_all(self, django_user_model):
        """Tenant list returns all 3 tenants."""
        client = APIClient()
        user = django_user_model.objects.create_user(
            username="admin", password="test", role="ADMIN"
        )
        client.force_authenticate(user=user)
        resp = client.get("/api/v1/tenants/")
        assert resp.status_code == 200
        assert resp.data["count"] == 3
        assert len(resp.data["results"]) == 3

    def test_tenant_detail_by_code(self, django_user_model):
        """GET /tenants/CN_DIYU/ returns single tenant."""
        client = APIClient()
        user = django_user_model.objects.create_user(
            username="admin2", password="test", role="ADMIN"
        )
        client.force_authenticate(user=user)
        resp = client.get("/api/v1/tenants/CN_DIYU/")
        assert resp.status_code == 200
        assert resp.data["code"] == "CN_DIYU"
        assert resp.data["display_name"] == "Chinese Afterlife"
