"""
Tests for Soul CRUD API endpoints.
"""
import pytest
from rest_framework.test import APIClient
from apps.souls.models import Soul, SoulState


@pytest.mark.django_db
class TestSoulCRUD:
    """Test Soul CRUD operations via REST API."""

    @pytest.fixture(autouse=True)
    def setup(self, api_client, admin_user, cn_tenant):
        self.client = api_client
        self.admin_user = admin_user
        self.cn_tenant = cn_tenant
        # Authenticate
        self.client.force_authenticate(user=admin_user)

    def test_list_souls_authenticated(self):
        """GET /api/v1/souls/ with auth returns 200."""
        response = self.client.get("/api/v1/souls/")
        assert response.status_code == 200

    def test_create_soul_success(self, soul_data):
        """POST /api/v1/souls/ with name/civilization returns 201."""
        response = self.client.post("/api/v1/souls/", soul_data, format="json")
        assert response.status_code == 201
        assert response.data["name"] == soul_data["name"]
        assert "id" in response.data

    def test_create_soul_missing_name(self, soul_data):
        """POST with missing name returns 400."""
        data = soul_data.copy()
        del data["name"]
        response = self.client.post("/api/v1/souls/", data, format="json")
        assert response.status_code == 400

    def test_get_soul_detail(self, soul_data):
        """GET /api/v1/souls/{id}/ returns 200."""
        # Create a soul first
        create_resp = self.client.post("/api/v1/souls/", soul_data, format="json")
        soul_id = create_resp.data["id"]

        response = self.client.get(f"/api/v1/souls/{soul_id}/")
        assert response.status_code == 200
        assert response.data["name"] == soul_data["name"]

    def test_filter_by_state(self, soul_data):
        """GET /api/v1/souls/?current_state=ALIVE returns 200."""
        # Create a soul in ALIVE state
        self.client.post("/api/v1/souls/", soul_data, format="json")

        response = self.client.get("/api/v1/souls/?current_state=ALIVE")
        assert response.status_code == 200
        # All returned souls should have current_state == ALIVE
        for soul in response.data["results"]:
            assert soul["current_state"] == SoulState.ALIVE

    def test_create_soul_with_minimal_data(self):
        """POST with only name returns 201."""
        data = {"name": "Minimal Soul"}
        response = self.client.post("/api/v1/souls/", data, format="json")
        assert response.status_code == 201
        assert response.data["name"] == "Minimal Soul"

    def test_update_soul(self, soul_data):
        """PATCH /api/v1/souls/{id}/ returns 200."""
        create_resp = self.client.post("/api/v1/souls/", soul_data, format="json")
        soul_id = create_resp.data["id"]

        update_data = {"name": "Updated Name"}
        response = self.client.patch(f"/api/v1/souls/{soul_id}/", update_data, format="json")
        assert response.status_code == 200
        assert response.data["name"] == "Updated Name"

    def test_delete_soul(self, soul_data):
        """DELETE /api/v1/souls/{id}/ returns 204."""
        create_resp = self.client.post("/api/v1/souls/", soul_data, format="json")
        soul_id = create_resp.data["id"]

        response = self.client.delete(f"/api/v1/souls/{soul_id}/")
        assert response.status_code == 204

    def test_list_souls_pagination(self):
        """GET /api/v1/souls/ returns paginated results."""
        # Create multiple souls
        for i in range(25):
            Soul.objects.create(name=f"Soul {i}", tenant=self.cn_tenant)

        response = self.client.get("/api/v1/souls/")
        assert response.status_code == 200
        assert "results" in response.data
        assert "count" in response.data

    def test_search_souls(self, soul_data):
        """GET /api/v1/souls/?search= returns 200."""
        self.client.post("/api/v1/souls/", soul_data, format="json")

        response = self.client.get(f"/api/v1/souls/?search={soul_data['name']}")
        assert response.status_code == 200
