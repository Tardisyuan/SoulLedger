"""
Tests for Karma API endpoints.
"""
import pytest
from rest_framework.test import APIClient
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant


@pytest.mark.django_db
class TestKarmaAPI:
    """Test karma endpoints."""

    @pytest.fixture(autouse=True)
    def setup(self, api_client, admin_user, cn_tenant):
        self.client = api_client
        self.admin_user = admin_user
        self.cn_tenant = cn_tenant
        self.client.force_authenticate(user=admin_user)

    def test_karma_balance_via_soul_endpoint(self, soul_data):
        """GET /api/v1/souls/{soul_id}/karma/ returns 200."""
        # Create a soul
        create_resp = self.client.post("/api/v1/souls/", soul_data, format="json")
        soul_id = create_resp.data["id"]

        # Get karma via soul endpoint
        response = self.client.get(f"/api/v1/souls/{soul_id}/karma/")
        assert response.status_code == 200
        assert "merit_score" in response.data
        assert "demerit_score" in response.data
        assert "karmic_balance" in response.data

    def test_karma_balance_via_karma_endpoint(self, soul_data):
        """GET /api/v1/karma/balance/{soul_id}/ returns 200."""
        # Create a soul
        create_resp = self.client.post("/api/v1/souls/", soul_data, format="json")
        soul_id = create_resp.data["id"]

        # Get karma via dedicated karma endpoint
        response = self.client.get(f"/api/v1/karma/balance/{soul_id}/")
        assert response.status_code == 200
        assert "merit_score" in response.data
        assert "demerit_score" in response.data
        assert "karmic_balance" in response.data

    def test_karma_nonexistent_soul(self):
        """GET karma for nonexistent soul returns 404."""
        import uuid
        fake_id = uuid.uuid4()
        response = self.client.get(f"/api/v1/karma/balance/{fake_id}/")
        assert response.status_code == 404

    def test_karma_recalculate(self, soul_data):
        """POST /api/v1/karma/calculate/{soul_id}/ returns 200."""
        # Create a soul
        create_resp = self.client.post("/api/v1/souls/", soul_data, format="json")
        soul_id = create_resp.data["id"]

        # Recalculate karma
        response = self.client.post(f"/api/v1/karma/calculate/{soul_id}/")
        assert response.status_code == 200
