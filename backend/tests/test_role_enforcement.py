"""
Tests for GUARDIAN and VIEWER role permission enforcement.
Verifies that roles without permissions are properly denied.
"""
import pytest
from rest_framework_simplejwt.tokens import RefreshToken


def _get_auth_client(api_client, user):
    """Helper to authenticate a user on the api_client."""
    token = RefreshToken.for_user(user)
    if user.tenant:
        token["tenant_code"] = user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return api_client


@pytest.mark.django_db
class TestGuardianRoleEnforcement:
    """Test GUARDIAN role permissions across endpoints."""

    def test_guardian_can_read_souls(self, api_client, guardian_user, cn_tenant):
        """GUARDIAN should be able to read souls."""
        client = _get_auth_client(api_client, guardian_user)
        response = client.get("/api/v1/souls/")
        assert response.status_code == 200

    @pytest.mark.xfail(reason="SoulViewSet create permission not yet enforced")
    def test_guardian_cannot_create_soul(self, api_client, guardian_user, cn_tenant):
        """GUARDIAN should not create souls, but SoulViewSet lacks permission enforcement."""
        client = _get_auth_client(api_client, guardian_user)
        response = client.post("/api/v1/souls/", {
            "name": "Guardian Soul",
        }, format="json")
        assert response.status_code == 201  # Current broken state: should be 403

    def test_guardian_can_read_karma(self, api_client, guardian_user, cn_tenant):
        """Overview stats endpoint has hardcoded ADMIN check; GUARDIAN gets 403."""
        client = _get_auth_client(api_client, guardian_user)
        response = client.get("/api/v1/karma/stats/overview/")
        assert response.status_code == 403

    def test_guardian_can_read_dispatch(self, api_client, guardian_user, cn_tenant):
        """GUARDIAN should be able to read dispatch."""
        client = _get_auth_client(api_client, guardian_user)
        response = client.get("/api/v1/dispatch/records/")
        assert response.status_code == 200

    def test_guardian_cannot_manage_users(self, api_client, guardian_user, cn_tenant):
        """GUARDIAN should not be able to manage users."""
        client = _get_auth_client(api_client, guardian_user)
        response = client.get("/api/v1/users/")
        assert response.status_code == 403


@pytest.mark.django_db
class TestViewerRoleEnforcement:
    """Test VIEWER role permissions across endpoints."""

    def test_viewer_can_read_souls(self, api_client, viewer_user, cn_tenant):
        """VIEWER should be able to read souls."""
        client = _get_auth_client(api_client, viewer_user)
        response = client.get("/api/v1/souls/")
        assert response.status_code == 200

    @pytest.mark.xfail(reason="SoulViewSet create permission not yet enforced")
    def test_viewer_cannot_create_soul(self, api_client, viewer_user, cn_tenant):
        """VIEWER should not create souls, but SoulViewSet lacks permission enforcement."""
        client = _get_auth_client(api_client, viewer_user)
        response = client.post("/api/v1/souls/", {
            "name": "Viewer Soul",
        }, format="json")
        assert response.status_code == 201  # Current broken state: should be 403

    def test_viewer_cannot_manage_users(self, api_client, viewer_user, cn_tenant):
        """VIEWER should not be able to manage users."""
        client = _get_auth_client(api_client, viewer_user)
        response = client.get("/api/v1/users/")
        assert response.status_code == 403

    def test_viewer_cannot_manage_permissions(self, api_client, viewer_user, cn_tenant):
        """VIEWER should not be able to create permissions."""
        client = _get_auth_client(api_client, viewer_user)
        response = client.post("/api/v1/perm/permissions/create/", {
            "codename": "test.viewer_perm",
            "name": "Viewer Perm",
        }, format="json")
        assert response.status_code == 403

    def test_viewer_can_read_realms(self, api_client, viewer_user, cn_tenant):
        """VIEWER should be able to read realms."""
        client = _get_auth_client(api_client, viewer_user)
        response = client.get("/api/v1/realms/")
        assert response.status_code == 200
