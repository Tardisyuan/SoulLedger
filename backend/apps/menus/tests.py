"""
Tests for menus app - Dynamic menu management
"""
from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status

User = get_user_model()


class MenuModelTest(TestCase):
    """Test Menu model"""

    def test_menu_str(self):
        from apps.menus.models import Menu
        menu = Menu.objects.create(
            name="Souls",
            path="/souls",
            roles=["ADMIN", "VIEWER"]
        )
        self.assertEqual(str(menu), "Souls")

    def test_menu_hierarchy(self):
        from apps.menus.models import Menu
        parent = Menu.objects.create(name="Souls", path="/souls", order=1)
        child = Menu.objects.create(
            name="Soul List",
            path="/souls/list",
            parent=parent,
            order=1
        )
        self.assertEqual(child.parent, parent)
        self.assertIn(child, parent.children.all())


class MenuAPITest(TestCase):
    """Test Menu API endpoints"""

    def setUp(self):
        from apps.tenants.models import Tenant
        self.client = APIClient()

        # 创建测试租户
        self.tenant = Tenant.objects.create(code="TEST", display_name="Test")

        self.admin_user = User.objects.create_user(
            username="admin",
            password="admin123",
            role="ADMIN",
            tenant=self.tenant
        )
        self.viewer_user = User.objects.create_user(
            username="viewer",
            password="viewer123",
            role="VIEWER",
            tenant=self.tenant
        )
        # 创建测试菜单
        from apps.menus.models import Menu
        self.admin_menu = Menu.objects.create(
            name="Admin Settings",
            path="/settings",
            roles=["ADMIN"]
        )
        self.public_menu = Menu.objects.create(
            name="Souls",
            path="/souls",
            roles=["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"]
        )

    def test_list_menus_admin(self):
        """Admin sees all menus"""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.get("/api/v1/menus/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertGreaterEqual(len(data), 2)

    def test_list_menus_viewer(self):
        """Viewer only sees public menus"""
        self.client.force_authenticate(user=self.viewer_user)
        response = self.client.get("/api/v1/menus/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        # Viewer 应该只能看到 roles 包含 VIEWER 的菜单
        menu_names = [m["name"] for m in data]
        self.assertIn("Souls", menu_names)
        self.assertNotIn("Admin Settings", menu_names)

    def test_list_menus_unauthenticated(self):
        """Unauthenticated user cannot list menus"""
        response = self.client.get("/api/v1/menus/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_create_menu_admin(self):
        """Admin can create menus"""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.post("/api/v1/menus/create/", {
            "name": "New Menu",
            "path": "/new-menu",
            "roles": ["ADMIN"],
            "order": 10
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_create_menu_non_admin(self):
        """Non-admin cannot create menus"""
        self.client.force_authenticate(user=self.viewer_user)
        response = self.client.post("/api/v1/menus/create/", {
            "name": "New Menu",
            "path": "/new-menu",
            "roles": ["ADMIN"]
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_update_menu_admin(self):
        """Admin can update menus"""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.put(f"/api/v1/menus/{self.admin_menu.id}/", {
            "name": "Updated Menu"
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.admin_menu.refresh_from_db()
        self.assertEqual(self.admin_menu.name, "Updated Menu")

    def test_delete_menu_admin(self):
        """Admin can delete menus"""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.delete(f"/api/v1/menus/{self.admin_menu.id}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        from apps.menus.models import Menu
        self.assertFalse(Menu.objects.filter(id=self.admin_menu.id).exists())
