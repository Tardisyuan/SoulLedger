"""
Tests for Permission API endpoints.
Covers: Permission CRUD, Role CRUD, RolePermission assignment, import/export.

Six tests here absorbed a same-named twin from ``apps/perm/tests.py``
(2026-09-13; the "7 + 5 duplicate tests" finding of the 2026-09-12 audit). The twins were not interchangeable: one side asserted
the response body, the other the database row; one asked as a JUDGE, the other
as a VIEWER; one as an ADMIN carrying a tenant claim, the other as an ADMIN with
no tenant at all. Each merged test says which half came from where.
``test_list_permissions_unauthenticated`` still has its twin there: the two are
the same request and the same assertion, so no mutation can tell them apart,
and the rule for this merge was "no proof, no deletion".
"""
import pytest
from rest_framework.test import APIClient

from apps.perm.models import Permission, Role, RolePermission


def _tenantless_admin_client(django_user_model):
    """An ADMIN with no tenant, session-authenticated -- the caller the
    ``apps/perm/tests.py`` twins used. ``admin_user`` always has CN_DIYU."""
    user = django_user_model.objects.create_user(
        username="tenantless_admin", password="x", role="ADMIN"
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
class TestPermissionAPI:
    """Test /api/v1/perm/permissions/ endpoints."""

    def test_list_permissions_authenticated(
        self, api_client, admin_user, cn_tenant, django_user_model
    ):
        """GET /api/v1/perm/permissions/ returns permissions.

        Merged: the second request is the ``apps/perm/tests.py`` twin's caller,
        an ADMIN with no tenant.
        """
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.get("/api/v1/perm/permissions/")
        assert response.status_code == 200

        response = _tenantless_admin_client(django_user_model).get("/api/v1/perm/permissions/")
        assert response.status_code == 200

    def test_list_permissions_unauthenticated(self, api_client):
        """GET /api/v1/perm/permissions/ without auth returns 401."""
        response = api_client.get("/api/v1/perm/permissions/")
        assert response.status_code == 401

    def test_create_permission_admin(self, api_client, admin_user, cn_tenant):
        """POST /api/v1/perm/permissions/create/ creates a permission.

        Merged: the row exists (this file) and the response echoes it
        (``apps/perm/tests.py``).
        """
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
        assert response.data["codename"] == "test.create"

    def test_create_permission_non_admin(
        self, api_client, judge_user, viewer_user, cn_tenant
    ):
        """POST /api/v1/perm/permissions/create/ as non-admin returns 403.

        Merged: JUDGE (this file) and VIEWER (``apps/perm/tests.py``).
        """
        from rest_framework_simplejwt.tokens import RefreshToken
        for user in (judge_user, viewer_user):
            token = RefreshToken.for_user(user)
            if user.tenant:
                token["tenant_code"] = user.tenant.code
            api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
            response = api_client.post("/api/v1/perm/permissions/create/", {
                "codename": "test.create",
                "name": "Test Create",
            }, format="json")
            assert response.status_code == 403, user.role


@pytest.mark.django_db
class TestRoleAPI:
    """Test /api/v1/perm/roles/ endpoints."""

    def test_list_roles(self, api_client, admin_user, cn_tenant, django_user_model):
        """GET /api/v1/perm/roles/ returns roles.

        Merged: the second request is the ``apps/perm/tests.py`` twin's caller,
        an ADMIN with no tenant.
        """
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.get("/api/v1/perm/roles/")
        assert response.status_code == 200

        response = _tenantless_admin_client(django_user_model).get("/api/v1/perm/roles/")
        assert response.status_code == 200

    def test_create_role(self, api_client, admin_user, cn_tenant):
        """POST /api/v1/perm/roles/create/ creates a role.

        Merged: the row exists (this file) and the response echoes it
        (``apps/perm/tests.py``).
        """
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
        assert response.data["name"] == "TEST_ROLE"


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
        """POST /api/v1/perm/role-permissions/init/ initializes default permissions.

        Merged: the per-role report is present (``apps/perm/tests.py``).
        """
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.post("/api/v1/perm/role-permissions/init/")
        assert response.status_code == 200
        assert "roles" in response.json()


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
