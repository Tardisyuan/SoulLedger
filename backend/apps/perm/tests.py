"""
Tests for perm app - RBAC permissions
"""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from apps.org.models import Organization

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


class RoleModelTest(TestCase):
    """Test Role model with scope and organization - M7"""

    @classmethod
    def setUpTestData(cls):
        cls.diyu = Organization.objects.create(
            name="中国地府",
            code="DIYU",
            category="CHINESE",
            level=0,
        )

    def test_role_global_scope(self):
        """测试全局角色"""
        from apps.perm.models import Role
        role = Role.objects.create(
            name="ADMIN",
            display_name="Administrator",
            scope="GLOBAL",
        )
        self.assertEqual(role.scope, "GLOBAL")
        self.assertIsNone(role.organization)

    def test_role_org_scope(self):
        """测试组织级角色"""
        from apps.perm.models import Role
        role = Role.objects.create(
            name="DIYU_JUDGE",
            display_name="第一殿审判官",
            scope="ORG",
            organization=self.diyu,
        )
        self.assertEqual(role.scope, "ORG")
        self.assertEqual(role.organization, self.diyu)

    def test_role_scope_choices(self):
        """测试角色作用域选项"""
        from apps.perm.models import Role
        self.assertIn("GLOBAL", dict(Role.SCOPE_CHOICES).keys())
        self.assertIn("ORG", dict(Role.SCOPE_CHOICES).keys())

    def test_role_parent_inheritance(self):
        """测试角色继承关系"""
        from apps.perm.models import Role
        parent_role = Role.objects.create(
            name="PARENT_ROLE",
            display_name="Parent Role",
            scope="GLOBAL",
        )
        child_role = Role.objects.create(
            name="CHILD_ROLE",
            display_name="Child Role",
            scope="GLOBAL",
            parent=parent_role,
        )
        self.assertEqual(child_role.parent, parent_role)
        # 验证继承的权限方法
        child_perms = child_role.get_inherited_permissions()
        self.assertIsInstance(child_perms, set)

    def test_role_get_ancestors(self):
        """测试获取祖先角色"""
        from apps.perm.models import Role
        parent = Role.objects.create(name="PARENT", display_name="Parent", scope="GLOBAL")
        child = Role.objects.create(name="CHILD", display_name="Child", scope="GLOBAL", parent=parent)
        grandchild = Role.objects.create(name="GRANDCHILD", display_name="Grandchild", scope="GLOBAL", parent=child)

        ancestors = grandchild.get_ancestors()
        self.assertEqual(len(ancestors), 2)
        self.assertEqual(ancestors[0], child)
        self.assertEqual(ancestors[1], parent)

    def test_role_str_representation(self):
        """测试角色字符串表示"""
        from apps.perm.models import Role
        role = Role.objects.create(
            name="ADMIN",
            display_name="Administrator",
        )
        self.assertEqual(str(role), "ADMIN (Administrator)")


class RolePermissionModelTest(TestCase):
    """Test RolePermission model"""

    def test_role_permission_str(self):
        from apps.perm.models import Permission, Role, RolePermission
        perm = Permission.objects.create(
            codename="soul.read",
            name="View Soul",
            category="soul"
        )
        role = Role.objects.create(name="ADMIN", display_name="Administrator")
        rp = RolePermission.objects.create(
            role=role,
            permission=perm
        )
        self.assertEqual(str(rp), "ADMIN -> soul.read")

    def test_unique_together(self):
        from apps.perm.models import Permission, Role, RolePermission
        perm = Permission.objects.create(
            codename="soul.create",
            name="Create Soul",
            category="soul"
        )
        role = Role.objects.create(name="ADMIN", display_name="Administrator")
        RolePermission.objects.create(role=role, permission=perm)
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            RolePermission.objects.create(role=role, permission=perm)


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
