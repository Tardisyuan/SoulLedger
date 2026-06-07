"""
Tests for Permission API endpoints.
Covers: Permission CRUD, Role CRUD, RolePermission assignment, import/export.
"""
import pytest

from apps.perm.models import Permission, Role, RolePermission


@pytest.mark.django_db
class TestPermissionAPI:
    """Test /api/v1/perm/permissions/ endpoints."""

    def test_list_permissions_authenticated(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/perm/permissions/ returns permissions."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.get("/api/v1/perm/permissions/")
        assert response.status_code == 200

    def test_list_permissions_unauthenticated(self, api_client):
        """GET /api/v1/perm/permissions/ without auth returns 401."""
        response = api_client.get("/api/v1/perm/permissions/")
        assert response.status_code == 401

    def test_create_permission_admin(self, api_client, admin_user, cn_tenant):
        """POST /api/v1/perm/permissions/create/ creates a permission."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.post("/api/v1/perm/permissions/create/", {
            "codename": "test.create",
            "name": "Test Create",
            "category": "test",
        }, format="json")
        assert response.status_code == 201
        assert Permission.objects.filter(codename="test.create").exists()

    def test_create_permission_non_admin(self, api_client, judge_user, cn_tenant):
        """POST /api/v1/perm/permissions/create/ as non-admin returns 403."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(judge_user)
        if judge_user.tenant:
            token["tenant_code"] = judge_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.post("/api/v1/perm/permissions/create/", {
            "codename": "test.create",
            "name": "Test Create",
        }, format="json")
        assert response.status_code == 403


@pytest.mark.django_db
class TestRoleAPI:
    """Test /api/v1/perm/roles/ endpoints."""

    def test_list_roles(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/perm/roles/ returns roles."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.get("/api/v1/perm/roles/")
        assert response.status_code == 200

    def test_create_role(self, api_client, admin_user, cn_tenant):
        """POST /api/v1/perm/roles/create/ creates a role."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.post("/api/v1/perm/roles/create/", {
            "name": "TEST_ROLE",
            "display_name": "Test Role",
        }, format="json")
        assert response.status_code == 201
        assert Role.objects.filter(name="TEST_ROLE").exists()


@pytest.mark.django_db
class TestRolePermissionAPI:
    """Test /api/v1/perm/role-permissions/ endpoints."""

    def test_assign_permissions_to_role(self, api_client, admin_user, cn_tenant):
        """POST /api/v1/perm/role-permissions/assign/ assigns permissions."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        role = Role.objects.create(name="TEST", display_name="Test")
        perm = Permission.objects.create(codename="test.read", name="Test Read")
        response = api_client.post("/api/v1/perm/role-permissions/assign/", {
            "role": role.name,
            "permission_ids": [perm.id],
        }, format="json")
        assert response.status_code == 200
        assert RolePermission.objects.filter(role=role, permission=perm).exists()

    def test_init_role_permissions(self, api_client, admin_user, cn_tenant):
        """POST /api/v1/perm/role-permissions/init/ initializes default permissions."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.post("/api/v1/perm/role-permissions/init/")
        assert response.status_code == 200


@pytest.mark.django_db
class TestPermissionExportImport:
    """Test permission export/import endpoints."""

    def test_export_permissions(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/perm/export/ exports permissions as JSON."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.get("/api/v1/perm/export/")
        assert response.status_code == 200


@pytest.mark.django_db
class TestPermissionRoleMatrix:
    """Test permission enforcement across roles."""

    def test_admin_can_manage_permissions(self, api_client, admin_user, cn_tenant):
        """ADMIN role can access permission management endpoints."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.get("/api/v1/perm/permissions/")
        assert response.status_code == 200

    def test_judge_cannot_manage_permissions(self, api_client, judge_user, cn_tenant):
        """JUDGE role cannot create permissions."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(judge_user)
        if judge_user.tenant:
            token["tenant_code"] = judge_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.post("/api/v1/perm/permissions/create/", {
            "codename": "test.create",
            "name": "Test",
        }, format="json")
        assert response.status_code == 403
