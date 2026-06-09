"""
Tests for menus app - Dynamic menu management and tree structure.
Uses JWT auth with tenant_code so TenantMiddleware sets request.tenant.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.menus.models import Menu, MenuButton
from apps.tenants.models import Tenant

User = get_user_model()
BASE = "/api/v1/menus"


def _jwt_client(user, tenant):
    """Return APIClient authenticated via JWT with tenant_code claim."""
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
class TestMenuModel:
    """Menu model basics."""

    def test_menu_str(self):
        menu = Menu.objects.create(name="Souls", path="/souls", roles=["ADMIN", "VIEWER"])
        assert str(menu) == "[MENU] Souls"

    def test_menu_hierarchy(self):
        parent = Menu.objects.create(name="Souls", path="/souls", order=1)
        child = Menu.objects.create(name="Soul List", path="/souls/list", parent=parent, order=1)
        assert child.parent == parent
        assert child in parent.children.all()


@pytest.mark.django_db
class TestMenuCRUD:
    """Menu list, create, update, delete via ViewSet."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="MENU_T1", defaults={"display_name": "Menu Test Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="menu_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.viewer = User.objects.create_user(
            username="menu_viewer", password="test123", role="VIEWER", tenant=self.tenant
        )
        self.admin_client = _jwt_client(self.admin, self.tenant)
        self.viewer_client = _jwt_client(self.viewer, self.tenant)
        self.menu = Menu.objects.create(
            name="Admin Settings", path="/settings", roles=["ADMIN"], order=1
        )
        self.public_menu = Menu.objects.create(
            name="Souls", path="/souls", roles=["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"], order=2
        )

    def test_list_menus_admin(self):
        resp = self.admin_client.get(f"{BASE}/")
        assert resp.status_code == status.HTTP_200_OK

    def test_list_menus_viewer(self):
        resp = self.viewer_client.get(f"{BASE}/")
        assert resp.status_code == status.HTTP_200_OK

    def test_list_menus_unauthenticated(self):
        resp = APIClient().get(f"{BASE}/")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    def test_create_menu_admin(self):
        resp = self.admin_client.post(f"{BASE}/", {
            "name": "New Menu", "path": "/new-menu", "roles": ["ADMIN"], "order": 10
        }, format="json")
        assert resp.status_code == status.HTTP_201_CREATED

    def test_create_menu_viewer_forbidden(self):
        resp = self.viewer_client.post(f"{BASE}/", {
            "name": "Bad Menu", "path": "/bad", "roles": ["VIEWER"]
        }, format="json")
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_update_menu_admin(self):
        resp = self.admin_client.patch(f"{BASE}/{self.menu.pk}/", {
            "name": "Updated Menu"
        }, format="json")
        assert resp.status_code == status.HTTP_200_OK
        self.menu.refresh_from_db()
        assert self.menu.name == "Updated Menu"

    def test_delete_menu_admin(self):
        resp = self.admin_client.delete(f"{BASE}/{self.menu.pk}/")
        assert resp.status_code == status.HTTP_204_NO_CONTENT
        self.menu.refresh_from_db()
        assert self.menu.is_deleted

    def test_retrieve_menu(self):
        resp = self.admin_client.get(f"{BASE}/{self.menu.pk}/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["name"] == "Admin Settings"

    def test_menu_not_found(self):
        resp = self.admin_client.get(f"{BASE}/99999/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestMenuActions:
    """Menu tree, all, list-public actions."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="MENU_T2", defaults={"display_name": "Menu Actions Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="menuact_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.viewer = User.objects.create_user(
            username="menuact_viewer", password="test123", role="VIEWER", tenant=self.tenant
        )
        self.admin_client = _jwt_client(self.admin, self.tenant)
        self.viewer_client = _jwt_client(self.viewer, self.tenant)
        self.parent = Menu.objects.create(name="Root", path="/root", roles=["ADMIN", "VIEWER"], order=1)
        self.child = Menu.objects.create(
            name="Child", path="/root/child", parent=self.parent, roles=["ADMIN"], order=1
        )
        MenuButton.objects.create(
            menu=self.parent, name="Add", code="add", permission="soul.create", order=1
        )

    def test_tree_admin(self):
        resp = self.admin_client.get(f"{BASE}/tree/")
        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) >= 1

    def test_tree_viewer(self):
        resp = self.viewer_client.get(f"{BASE}/tree/")
        assert resp.status_code == status.HTTP_200_OK

    def test_all_admin(self):
        resp = self.admin_client.get(f"{BASE}/all/")
        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) >= 1

    def test_all_viewer_forbidden(self):
        resp = self.viewer_client.get(f"{BASE}/all/")
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_list_public(self):
        resp = self.viewer_client.get(f"{BASE}/list-public/")
        assert resp.status_code == status.HTTP_200_OK
        names = [m["name"] for m in resp.data]
        assert "Root" in names


@pytest.mark.django_db
class TestMenuButtonCRUD:
    """MenuButton CRUD operations."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="MENU_T3", defaults={"display_name": "Button Test Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="btn_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.viewer = User.objects.create_user(
            username="btn_viewer", password="test123", role="VIEWER", tenant=self.tenant
        )
        self.admin_client = _jwt_client(self.admin, self.tenant)
        self.viewer_client = _jwt_client(self.viewer, self.tenant)
        self.menu = Menu.objects.create(name="Test Menu", path="/test", roles=["ADMIN"], order=1)
        self.button = MenuButton.objects.create(
            menu=self.menu, name="Add", code="add", permission="soul.create", order=1
        )

    def test_list_buttons(self):
        resp = self.admin_client.get(f"{BASE}/buttons/")
        assert resp.status_code == status.HTTP_200_OK

    def test_retrieve_button(self):
        resp = self.admin_client.get(f"{BASE}/buttons/{self.button.pk}/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["name"] == "Add"

    def test_create_button_admin(self):
        resp = self.admin_client.post(f"{BASE}/buttons/", {
            "menu": self.menu.pk, "name": "Edit", "code": "edit",
            "permission": "soul.update", "order": 2
        }, format="json")
        assert resp.status_code == status.HTTP_201_CREATED

    def test_create_button_viewer_forbidden(self):
        resp = self.viewer_client.post(f"{BASE}/buttons/", {
            "menu": self.menu.pk, "name": "Bad", "code": "bad",
            "permission": "x", "order": 1
        }, format="json")
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_update_button_admin(self):
        resp = self.admin_client.patch(f"{BASE}/buttons/{self.button.pk}/", {
            "name": "Updated Btn"
        }, format="json")
        assert resp.status_code == status.HTTP_200_OK
        self.button.refresh_from_db()
        assert self.button.name == "Updated Btn"

    def test_delete_button_admin(self):
        resp = self.admin_client.delete(f"{BASE}/buttons/{self.button.pk}/")
        assert resp.status_code == status.HTTP_204_NO_CONTENT
        self.button.refresh_from_db()
        assert self.button.is_deleted

    def test_button_not_found(self):
        resp = self.admin_client.get(f"{BASE}/buttons/99999/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND
