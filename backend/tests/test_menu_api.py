"""
Tests for Menu and MenuButton API endpoints.
"""
import pytest
from apps.menus.models import Menu, MenuButton


@pytest.mark.django_db
class TestMenuAPI:
    """Test /api/v1/menus/ endpoints."""

    def test_list_menus_authenticated(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/menus/ returns menus."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.get("/api/v1/menus/")
        assert response.status_code == 200

    def test_list_menus_unauthenticated(self, api_client):
        """GET /api/v1/menus/ without auth returns 401."""
        response = api_client.get("/api/v1/menus/")
        assert response.status_code == 401

    def test_create_menu(self, api_client, admin_user, cn_tenant):
        """POST /api/v1/menus/ creates a menu."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.post("/api/v1/menus/", {
            "name": "Test Menu",
            "path": "/test",
            "icon": "TestIcon",
            "order": 1,
            "is_active": True,
        }, format="json")
        assert response.status_code == 201
        assert Menu.objects.filter(name="Test Menu").exists()

    def test_get_menu_tree(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/menus/tree/ returns menu tree."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.get("/api/v1/menus/tree/")
        assert response.status_code == 200

    def test_get_all_menus(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/menus/all/ returns all menus."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.get("/api/v1/menus/all/")
        assert response.status_code == 200


@pytest.mark.django_db
class TestMenuButtonAPI:
    """Test /api/v1/menus/buttons/ endpoints."""

    def test_list_menu_buttons(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/menus/buttons/ returns buttons."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.get("/api/v1/menus/buttons/")
        assert response.status_code == 200

    def test_create_menu_button(self, api_client, admin_user, cn_tenant):
        """POST /api/v1/menus/buttons/ creates a button."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        menu = Menu.objects.create(name="Test", path="/test")
        response = api_client.post("/api/v1/menus/buttons/", {
            "name": "Create",
            "code": "create",
            "permission": "test.create",
            "order": 1,
            "is_active": True,
            "menu": menu.id,
        }, format="json")
        assert response.status_code == 201
        assert MenuButton.objects.filter(code="create").exists()

    def test_non_admin_cannot_create_menu(self, api_client, judge_user, cn_tenant):
        """Non-admin cannot create menus."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(judge_user)
        if judge_user.tenant:
            token["tenant_code"] = judge_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.post("/api/v1/menus/", {
            "name": "Test",
            "path": "/test",
        }, format="json")
        assert response.status_code in [403, 401]
