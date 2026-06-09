"""
Tests for perm app - RBAC permissions and views.
"""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from apps.org.models import Organization
from apps.perm.models import DEFAULT_PERMISSIONS, Permission, Role, RolePermission

User = get_user_model()


# ── Model tests ────────────────────────────────────────────────────────


class PermissionModelTest(TestCase):
    """Test Permission model"""

    def test_permission_str(self):
        perm = Permission.objects.create(
            codename="soul.read", name="View Soul", category="soul"
        )
        self.assertEqual(str(perm), "soul.read (View Soul)")


class RoleModelTest(TestCase):
    """Test Role model with scope and organization - M7"""

    @classmethod
    def setUpTestData(cls):
        cls.diyu = Organization.objects.create(
            name="中国地府", code="DIYU", category="CHINESE", level=0
        )

    def test_role_global_scope(self):
        role = Role.objects.create(name="ADMIN", display_name="Administrator", scope="GLOBAL")
        self.assertEqual(role.scope, "GLOBAL")
        self.assertIsNone(role.organization)

    def test_role_org_scope(self):
        role = Role.objects.create(
            name="DIYU_JUDGE", display_name="第一殿审判官", scope="ORG", organization=self.diyu
        )
        self.assertEqual(role.scope, "ORG")
        self.assertEqual(role.organization, self.diyu)

    def test_role_scope_choices(self):
        self.assertIn("GLOBAL", dict(Role.SCOPE_CHOICES).keys())
        self.assertIn("ORG", dict(Role.SCOPE_CHOICES).keys())

    def test_role_parent_inheritance(self):
        parent_role = Role.objects.create(name="PARENT_ROLE", display_name="Parent Role", scope="GLOBAL")
        child_role = Role.objects.create(name="CHILD_ROLE", display_name="Child Role", scope="GLOBAL", parent=parent_role)
        self.assertEqual(child_role.parent, parent_role)
        self.assertIsInstance(child_role.get_inherited_permissions(), set)

    def test_role_get_ancestors(self):
        parent = Role.objects.create(name="PARENT", display_name="Parent", scope="GLOBAL")
        child = Role.objects.create(name="CHILD", display_name="Child", scope="GLOBAL", parent=parent)
        grandchild = Role.objects.create(name="GRANDCHILD", display_name="Grandchild", scope="GLOBAL", parent=child)
        ancestors = grandchild.get_ancestors()
        self.assertEqual(len(ancestors), 2)
        self.assertEqual(ancestors[0], child)
        self.assertEqual(ancestors[1], parent)

    def test_role_str_representation(self):
        role = Role.objects.create(name="ADMIN", display_name="Administrator")
        self.assertEqual(str(role), "ADMIN (Administrator)")


class RolePermissionModelTest(TestCase):
    """Test RolePermission model"""

    def test_role_permission_str(self):
        perm = Permission.objects.create(codename="soul.read", name="View Soul", category="soul")
        role = Role.objects.create(name="ADMIN", display_name="Administrator")
        rp = RolePermission.objects.create(role=role, permission=perm)
        self.assertEqual(str(rp), "ADMIN -> soul.read")

    def test_unique_together(self):
        perm = Permission.objects.create(codename="soul.create", name="Create Soul", category="soul")
        role = Role.objects.create(name="ADMIN", display_name="Administrator")
        RolePermission.objects.create(role=role, permission=perm)
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            RolePermission.objects.create(role=role, permission=perm)


# ── API view tests ────────────────────────────────────────────────────


class PermissionAPITest(TestCase):
    """Test Permission API endpoints"""

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="admin", password="admin123", role="ADMIN")
        self.viewer = User.objects.create_user(username="viewer", password="viewer123", role="VIEWER")
        for codename, name, category in DEFAULT_PERMISSIONS:
            Permission.objects.get_or_create(codename=codename, defaults={"name": name, "category": category})

    # -- list_permissions --

    def test_list_permissions_authenticated(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/v1/perm/permissions/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_list_permissions_unauthenticated(self):
        response = self.client.get("/api/v1/perm/permissions/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    # -- create_permission --

    def test_create_permission_admin(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/permissions/create/", {
            "codename": "custom.perm", "name": "Custom Perm", "category": "custom"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["codename"], "custom.perm")

    def test_create_permission_duplicate(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/permissions/create/", {
            "codename": "soul.read", "name": "Dup", "category": "soul"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_permission_non_admin(self):
        self.client.force_authenticate(user=self.viewer)
        response = self.client.post("/api/v1/perm/permissions/create/", {
            "codename": "test.x", "name": "Test", "category": "test"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    # -- update_delete_permission --

    def test_update_permission(self):
        perm = Permission.objects.create(codename="test.update", name="Update Me", category="test")
        self.client.force_authenticate(user=self.admin)
        response = self.client.put(f"/api/v1/perm/permissions/{perm.pk}/", {
            "codename": "test.updated", "name": "Updated", "category": "test"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        perm.refresh_from_db()
        self.assertEqual(perm.name, "Updated")

    def test_delete_permission(self):
        perm = Permission.objects.create(codename="test.delete", name="Delete Me", category="test")
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(f"/api/v1/perm/permissions/{perm.pk}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        perm.refresh_from_db()
        self.assertTrue(perm.is_deleted)

    def test_update_permission_not_found(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.put("/api/v1/perm/permissions/99999/", {
            "codename": "x", "name": "X", "category": "x"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    # -- get_role_permissions --

    def test_get_role_permissions_admin(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/v1/perm/role-permissions/", {"role": "ADMIN"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["role"], "ADMIN")
        self.assertIn("soul.read", data["permissions"])
        self.assertIn("system.settings", data["permissions"])

    def test_get_role_permissions_viewer(self):
        self.client.force_authenticate(user=self.viewer)
        response = self.client.get("/api/v1/perm/role-permissions/", {"role": "VIEWER"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["role"], "VIEWER")
        self.assertIn("soul.read", data["permissions"])
        self.assertNotIn("system.settings", data["permissions"])

    # -- assign_role_permissions --

    def test_assign_role_permissions(self):
        perm = Permission.objects.create(codename="test.assign", name="Assign", category="test")
        role, _ = Role.objects.get_or_create(name="VIEWER", defaults={"display_name": "Viewer"})
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/role-permissions/assign/", {
            "role": "VIEWER", "permission_ids": [perm.pk]
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["assigned_count"], 1)

    def test_assign_role_permissions_invalid_role(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/role-permissions/assign/", {
            "role": "NONEXISTENT", "permission_ids": []
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_assign_role_permissions_invalid_perm_ids(self):
        Role.objects.get_or_create(name="VIEWER", defaults={"display_name": "Viewer"})
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/role-permissions/assign/", {
            "role": "VIEWER", "permission_ids": [99999]
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    # -- init endpoints --

    def test_init_permissions(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/init/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreater(response.json()["total"], 0)

    def test_init_permissions_non_admin(self):
        self.client.force_authenticate(user=self.viewer)
        response = self.client.post("/api/v1/perm/init/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_init_roles(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/roles/init/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreater(response.json()["total"], 0)

    def test_init_role_permissions(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/role-permissions/init/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("roles", response.json())


class RoleAPITest(TestCase):
    """Test Role CRUD API endpoints"""

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="admin2", password="admin123", role="ADMIN")
        self.viewer = User.objects.create_user(username="viewer2", password="viewer123", role="VIEWER")

    def test_list_roles(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/v1/perm/roles/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_create_role(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/roles/create/", {
            "name": "TESTER", "display_name": "Tester"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["name"], "TESTER")

    def test_create_role_duplicate(self):
        self.client.force_authenticate(user=self.admin)
        Role.objects.create(name="ADMIN", display_name="Admin")
        response = self.client.post("/api/v1/perm/roles/create/", {
            "name": "ADMIN", "display_name": "Admin Dup"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_role_non_admin(self):
        self.client.force_authenticate(user=self.viewer)
        response = self.client.post("/api/v1/perm/roles/create/", {
            "name": "TESTER", "display_name": "Tester"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_update_role(self):
        role = Role.objects.create(name="UPDATABLE", display_name="Old")
        self.client.force_authenticate(user=self.admin)
        response = self.client.put(f"/api/v1/perm/roles/{role.pk}/", {
            "name": "UPDATABLE", "display_name": "New Name"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        role.refresh_from_db()
        self.assertEqual(role.display_name, "New Name")

    def test_delete_role(self):
        role = Role.objects.create(name="DELETABLE", display_name="Delete Me")
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(f"/api/v1/perm/roles/{role.pk}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        role.refresh_from_db()
        self.assertTrue(role.is_deleted)

    def test_role_not_found(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.put("/api/v1/perm/roles/99999/", {
            "name": "X", "display_name": "X"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
