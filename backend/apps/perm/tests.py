"""
Tests for perm app - RBAC permissions
"""
from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status

User = get_user_model()


class PermissionModelTest(TestCase):
    """Test Permission model"""

    def test_permission_str(self):
        from apps.perm.models import Permission
        perm = Permission.objects.create(
            codename="soul.read",
            name="View Soul",
            category="soul"
        )
        self.assertEqual(str(perm), "soul.read (View Soul)")


class RolePermissionModelTest(TestCase):
    """Test RolePermission model"""

    def test_role_permission_str(self):
        from apps.perm.models import Permission, RolePermission
        perm = Permission.objects.create(
            codename="soul.read",
            name="View Soul",
            category="soul"
        )
        rp = RolePermission.objects.create(
            role="ADMIN",
            permission=perm
        )
        self.assertEqual(str(rp), "ADMIN -> soul.read")

    def test_unique_together(self):
        from apps.perm.models import Permission, RolePermission
        perm = Permission.objects.create(
            codename="soul.create",
            name="Create Soul",
            category="soul"
        )
        RolePermission.objects.create(role="ADMIN", permission=perm)
        # 重复应该抛出异常
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            RolePermission.objects.create(role="ADMIN", permission=perm)


class PermissionAPITest(TestCase):
    """Test Permission API endpoints"""

    def setUp(self):
        self.client = APIClient()
        self.admin_user = User.objects.create_user(
            username="admin",
            password="admin123",
            role="ADMIN"
        )
        self.viewer_user = User.objects.create_user(
            username="viewer",
            password="viewer123",
            role="VIEWER"
        )
        # 初始化权限数据
        from apps.perm.models import DEFAULT_PERMISSIONS, Permission
        for codename, name, category in DEFAULT_PERMISSIONS:
            Permission.objects.get_or_create(codename=codename, defaults={"name": name, "category": category})

    def test_list_permissions_authenticated(self):
        """Authenticated user can list permissions"""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.get("/api/v1/perm/permissions/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_list_permissions_unauthenticated(self):
        """Unauthenticated user cannot list permissions"""
        response = self.client.get("/api/v1/perm/permissions/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_get_role_permissions_admin(self):
        """ADMIN role gets all permissions"""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.get("/api/v1/perm/role-permissions/", {"role": "ADMIN"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["role"], "ADMIN")
        self.assertIn("soul.read", data["permissions"])
        self.assertIn("system.settings", data["permissions"])

    def test_get_role_permissions_viewer(self):
        """VIEWER role gets limited permissions"""
        self.client.force_authenticate(user=self.viewer_user)
        response = self.client.get("/api/v1/perm/role-permissions/", {"role": "VIEWER"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["role"], "VIEWER")
        self.assertIn("soul.read", data["permissions"])
        self.assertNotIn("system.settings", data["permissions"])

    def test_init_permissions(self):
        """Admin can initialize permissions"""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.post("/api/v1/perm/init/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertGreater(data["total"], 0)

    def test_init_permissions_non_admin(self):
        """Non-admin cannot initialize permissions"""
        self.client.force_authenticate(user=self.viewer_user)
        response = self.client.post("/api/v1/perm/init/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
