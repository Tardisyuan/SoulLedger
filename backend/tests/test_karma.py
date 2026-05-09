"""
Tests for authentication endpoints.
"""
import pytest
from rest_framework.test import APIClient


@pytest.mark.django_db
class TestAuth:
    """Test authentication endpoints."""

    @pytest.fixture(autouse=True)
    def setup(self, api_client, admin_user):
        self.client = api_client
        self.admin_user = admin_user

    def test_login_success(self, admin_user):
        """POST /api/v1/auth/login/ with admin/admin123 returns 200 and tokens."""
        response = self.client.post("/api/v1/auth/login/", {
            "username": "admin",
            "password": "admin123",
        })
        assert response.status_code == 200
        assert "access" in response.data
        assert "refresh" in response.data
        assert "user" in response.data
        assert response.data["user"]["username"] == "admin"

    def test_login_wrong_password(self, admin_user):
        """POST with wrong password returns 400 or 401."""
        response = self.client.post("/api/v1/auth/login/", {
            "username": "admin",
            "password": "wrongpassword",
        })
        assert response.status_code in [400, 401]

    def test_login_nonexistent_user(self):
        """POST with nonexistent user returns 400 or 401."""
        response = self.client.post("/api/v1/auth/login/", {
            "username": "nonexistent",
            "password": "somepassword",
        })
        assert response.status_code in [400, 401]

    def test_logout(self, admin_user):
        """POST /api/v1/auth/logout/ returns 200 or 204."""
        # First login to get tokens
        login_resp = self.client.post("/api/v1/auth/login/", {
            "username": "admin",
            "password": "admin123",
        })
        access_token = login_resp.data["access"]
        refresh_token = login_resp.data["refresh"]

        # Then logout
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
        response = self.client.post("/api/v1/auth/logout/", {
            "refresh": refresh_token,
        }, format="json")
        assert response.status_code in [200, 204]

    def test_profile_authenticated(self, admin_user):
        """GET /api/v1/auth/profile/ with auth returns user info."""
        self.client.force_authenticate(user=admin_user)
        response = self.client.get("/api/v1/auth/profile/")
        assert response.status_code == 200
        assert response.data["username"] == "admin"

    def test_profile_unauthenticated(self):
        """GET /api/v1/auth/profile/ without auth returns 401."""
        client = APIClient()
        response = client.get("/api/v1/auth/profile/")
        assert response.status_code == 401
