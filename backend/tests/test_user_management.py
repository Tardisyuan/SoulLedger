"""
Tests for User Management API endpoints.
"""
import pytest
from django.contrib.auth import get_user_model

User = get_user_model()


@pytest.mark.django_db
class TestUserManagementAPI:
    """Test User Management CRUD operations via REST API."""

    @pytest.fixture(autouse=True)
    def setup(self, api_client, admin_user, cn_tenant):
        self.client = api_client
        self.admin_user = admin_user
        self.cn_tenant = cn_tenant
        # Login to get JWT token with tenant_code
        response = self.client.post("/api/v1/auth/login/", {
            "username": "admin",
            "password": "admin123",
        })
        token = response.data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_list_users_authenticated(self):
        """GET /api/v1/users/ with auth returns 200."""
        response = self.client.get("/api/v1/users/")
        assert response.status_code == 200

    def test_list_users_returns_users(self):
        """GET /api/v1/users/ returns user list."""
        # Create additional users
        User.objects.create_user(username="user1", password="pass123", role="VIEWER", tenant=self.cn_tenant)
        User.objects.create_user(username="user2", password="pass123", role="JUDGE", tenant=self.cn_tenant)

        response = self.client.get("/api/v1/users/")
        assert response.status_code == 200
        assert "results" in response.data or isinstance(response.data, list)

    def test_create_user_success(self):
        """POST /api/v1/users/ with valid data returns 201."""
        data = {
            "username": "newuser",
            "email": "newuser@example.com",
            "password": "securepass123",
            "role": "VIEWER",
        }
        response = self.client.post("/api/v1/users/", data, format="json")
        assert response.status_code == 201
        assert response.data["username"] == "newuser"
        assert "id" in response.data

    def test_create_user_minimal(self):
        """POST /api/v1/users/ with only required fields returns 201."""
        data = {
            "username": "minimaluser",
            "password": "securepass123",
        }
        response = self.client.post("/api/v1/users/", data, format="json")
        assert response.status_code == 201
        assert response.data["username"] == "minimaluser"

    def test_create_user_short_password(self):
        """POST /api/v1/users/ with short password returns 400."""
        data = {
            "username": "shortpw",
            "password": "123",
        }
        response = self.client.post("/api/v1/users/", data, format="json")
        assert response.status_code == 400

    def test_create_user_missing_username(self):
        """POST /api/v1/users/ with missing username returns 400."""
        data = {
            "password": "securepass123",
        }
        response = self.client.post("/api/v1/users/", data, format="json")
        assert response.status_code == 400

    def test_get_user_detail(self):
        """GET /api/v1/users/{id}/ returns 200."""
        user = User.objects.create_user(username="detailuser", password="pass123", role="VIEWER", tenant=self.cn_tenant)

        response = self.client.get(f"/api/v1/users/{user.id}/")
        assert response.status_code == 200
        assert response.data["username"] == "detailuser"

    def test_update_user_email(self):
        """PATCH /api/v1/users/{id}/ returns 200."""
        user = User.objects.create_user(username="updateuser", password="pass123", role="VIEWER", tenant=self.cn_tenant)

        update_data = {"email": "updated@example.com"}
        response = self.client.patch(f"/api/v1/users/{user.id}/", update_data, format="json")
        assert response.status_code == 200
        assert response.data["email"] == "updated@example.com"

    def test_update_user_role(self):
        """PATCH /api/v1/users/{id}/ role returns 200."""
        user = User.objects.create_user(username="roleuser", password="pass123", role="VIEWER", tenant=self.cn_tenant)

        update_data = {"role": "JUDGE"}
        response = self.client.patch(f"/api/v1/users/{user.id}/", update_data, format="json")
        assert response.status_code == 200
        assert response.data["role"] == "JUDGE"

    def test_update_user_is_active(self):
        """PATCH /api/v1/users/{id}/ is_active returns 200."""
        user = User.objects.create_user(username="activeuser", password="pass123", role="VIEWER", tenant=self.cn_tenant)

        update_data = {"is_active": False}
        response = self.client.patch(f"/api/v1/users/{user.id}/", update_data, format="json")
        assert response.status_code == 200
        assert response.data["is_active"] == False

    def test_delete_user(self):
        """DELETE /api/v1/users/{id}/ returns 204."""
        user = User.objects.create_user(username="deleteuser", password="pass123", role="VIEWER", tenant=self.cn_tenant)

        response = self.client.delete(f"/api/v1/users/{user.id}/")
        assert response.status_code == 204
        # Verify user is deleted
        assert not User.objects.filter(id=user.id).exists()

    def test_activate_user(self):
        """POST /api/v1/users/{id}/activate/ returns 200."""
        user = User.objects.create_user(username="inactiveuser", password="pass123", role="VIEWER", tenant=self.cn_tenant, is_active=False)

        response = self.client.post(f"/api/v1/users/{user.id}/activate/")
        assert response.status_code == 200
        assert response.data["is_active"] == True

    def test_deactivate_user(self):
        """POST /api/v1/users/{id}/deactivate/ returns 200."""
        user = User.objects.create_user(username="activeuser2", password="pass123", role="VIEWER", tenant=self.cn_tenant, is_active=True)

        response = self.client.post(f"/api/v1/users/{user.id}/deactivate/")
        assert response.status_code == 200
        assert response.data["is_active"] == False

    def test_reset_password(self):
        """POST /api/v1/users/{id}/reset_password/ returns 200 with new password."""
        user = User.objects.create_user(username="resetpwuser", password="oldpass123", role="VIEWER", tenant=self.cn_tenant)

        response = self.client.post(f"/api/v1/users/{user.id}/reset_password/")
        assert response.status_code == 200
        assert "password" in response.data
        new_password = response.data["password"]
        # Verify new password works
        user.refresh_from_db()
        assert user.check_password(new_password)

    def test_batch_activate_users(self):
        """POST /api/v1/users/batch_activate/ activates multiple users."""
        user1 = User.objects.create_user(username="batchuser1", password="pass123", role="VIEWER", tenant=self.cn_tenant, is_active=False)
        user2 = User.objects.create_user(username="batchuser2", password="pass123", role="VIEWER", tenant=self.cn_tenant, is_active=False)

        response = self.client.post("/api/v1/users/batch_activate/", {"user_ids": [user1.id, user2.id]}, format="json")
        assert response.status_code == 200
        assert response.data["updated"] == 2

        user1.refresh_from_db()
        user2.refresh_from_db()
        assert user1.is_active == True
        assert user2.is_active == True

    def test_batch_deactivate_users(self):
        """POST /api/v1/users/batch_deactivate/ deactivates multiple users."""
        user1 = User.objects.create_user(username="batchuser3", password="pass123", role="VIEWER", tenant=self.cn_tenant, is_active=True)
        user2 = User.objects.create_user(username="batchuser4", password="pass123", role="VIEWER", tenant=self.cn_tenant, is_active=True)

        response = self.client.post("/api/v1/users/batch_deactivate/", {"user_ids": [user1.id, user2.id]}, format="json")
        assert response.status_code == 200
        assert response.data["updated"] == 2

        user1.refresh_from_db()
        user2.refresh_from_db()
        assert user1.is_active == False
        assert user2.is_active == False

    def test_batch_activate_empty_list(self):
        """POST /api/v1/users/batch_activate/ with empty user_ids returns 400."""
        response = self.client.post("/api/v1/users/batch_activate/", {"user_ids": []}, format="json")
        assert response.status_code == 400

    def test_batch_deactivate_empty_list(self):
        """POST /api/v1/users/batch_deactivate/ with empty user_ids returns 400."""
        response = self.client.post("/api/v1/users/batch_deactivate/", {"user_ids": []}, format="json")
        assert response.status_code == 400

    def test_batch_activate_missing_user_ids(self):
        """POST /api/v1/users/batch_activate/ without user_ids returns 400."""
        response = self.client.post("/api/v1/users/batch_activate/", {}, format="json")
        assert response.status_code == 400

    def test_batch_activate_nonexistent_users(self):
        """POST /api/v1/users/batch_activate/ with nonexistent IDs returns updated=0."""
        response = self.client.post("/api/v1/users/batch_activate/", {"user_ids": [99998, 99999]}, format="json")
        assert response.status_code == 200
        assert response.data["updated"] == 0

    def test_get_nonexistent_user(self):
        """GET /api/v1/users/{id}/ for nonexistent user returns 404."""
        response = self.client.get("/api/v1/users/99999/")
        assert response.status_code == 404

    def test_update_nonexistent_user(self):
        """PATCH /api/v1/users/{id}/ for nonexistent user returns 404."""
        response = self.client.patch("/api/v1/users/99999/", {"email": "test@test.com"}, format="json")
        assert response.status_code == 404

    def test_get_user_own_roles(self):
        """GET /api/v1/users/{id}/own_roles/ returns user role."""
        user = User.objects.create_user(username="roleuser1", password="pass123", role="JUDGE", tenant=self.cn_tenant)

        response = self.client.get(f"/api/v1/users/{user.id}/own_roles/")
        assert response.status_code == 200
        assert response.data["role"] == "JUDGE"

    def test_assign_roles_to_user(self):
        """POST /api/v1/users/{id}/assign_roles/ changes user role."""
        user = User.objects.create_user(username="assignrole1", password="pass123", role="VIEWER", tenant=self.cn_tenant)
        assert user.role == "VIEWER"

        response = self.client.post(f"/api/v1/users/{user.id}/assign_roles/", {"role": "JUDGE"}, format="json")
        assert response.status_code == 200
        assert response.data["role"] == "JUDGE"

    def test_assign_roles_invalid_role(self):
        """POST /api/v1/users/{id}/assign_roles/ with invalid role returns 400."""
        user = User.objects.create_user(username="assignrole2", password="pass123", role="VIEWER", tenant=self.cn_tenant)

        response = self.client.post(f"/api/v1/users/{user.id}/assign_roles/", {"role": "SUPERADMIN"}, format="json")
        assert response.status_code == 400

    def test_admin_can_assign_roles(self):
        """ADMIN can assign any valid role to a user."""
        user = User.objects.create_user(username="adminassign1", password="pass123", role="VIEWER", tenant=self.cn_tenant)

        for new_role in ['ADMIN', 'JUDGE', 'GUARDIAN', 'VIEWER']:
            response = self.client.post(f"/api/v1/users/{user.id}/assign_roles/", {"role": new_role}, format="json")
            assert response.status_code == 200, f"Failed for role {new_role}"
            assert response.data["role"] == new_role

    def test_filter_users_by_role(self):
        """GET /api/v1/users/?role=JUDGE returns only JUDGE users."""
        User.objects.create_user(username="user_judge", password="pass123", role="JUDGE", tenant=self.cn_tenant)
        User.objects.create_user(username="user_viewer", password="pass123", role="VIEWER", tenant=self.cn_tenant)

        response = self.client.get("/api/v1/users/?role=JUDGE")
        assert response.status_code == 200
        results = response.data.get("results", response.data)
        assert all(u["role"] == "JUDGE" for u in results)

    def test_filter_users_by_is_active(self):
        """GET /api/v1/users/?is_active=true returns only active users."""
        User.objects.create_user(username="active_user", password="pass123", role="VIEWER", tenant=self.cn_tenant, is_active=True)
        User.objects.create_user(username="inactive_user", password="pass123", role="VIEWER", tenant=self.cn_tenant, is_active=False)

        response = self.client.get("/api/v1/users/?is_active=true")
        assert response.status_code == 200
        results = response.data.get("results", response.data)
        assert all(u["is_active"] == True for u in results)

        response2 = self.client.get("/api/v1/users/?is_active=false")
        assert response2.status_code == 200
        results2 = response2.data.get("results", response2.data)
        assert all(u["is_active"] == False for u in results2)

    def test_search_users_by_username(self):
        """GET /api/v1/users/?search=admin returns matching users."""
        User.objects.create_user(username="admin_xyz", password="pass123", role="ADMIN", tenant=self.cn_tenant)
        User.objects.create_user(username="user_abc", password="pass123", role="VIEWER", tenant=self.cn_tenant)

        response = self.client.get("/api/v1/users/?search=admin")
        assert response.status_code == 200
        results = response.data.get("results", response.data)
        assert any("admin" in u["username"].lower() for u in results)

    def test_search_users_by_email(self):
        """GET /api/v1/users/?search=admin@example.com returns matching users."""
        User.objects.create_user(username="user1", password="pass123", role="VIEWER", tenant=self.cn_tenant, email="admin@example.com")
        User.objects.create_user(username="user2", password="pass123", role="VIEWER", tenant=self.cn_tenant, email="other@example.com")

        response = self.client.get("/api/v1/users/?search=admin@example.com")
        assert response.status_code == 200
        results = response.data.get("results", response.data)
        assert any("admin" in u["email"].lower() for u in results)

    def test_order_users_by_username(self):
        """GET /api/v1/users/?ordering=username returns users sorted by username."""
        User.objects.create_user(username="zebra", password="pass123", role="VIEWER", tenant=self.cn_tenant)
        User.objects.create_user(username="alpha", password="pass123", role="VIEWER", tenant=self.cn_tenant)

        response = self.client.get("/api/v1/users/?ordering=username")
        assert response.status_code == 200
        results = response.data.get("results", response.data)
        usernames = [u["username"] for u in results]
        assert usernames == sorted(usernames)

    def test_order_users_by_create_time(self):
        """GET /api/v1/users/?ordering=-create_time returns users sorted by newest first."""
        response = self.client.get("/api/v1/users/?ordering=-create_time")
        assert response.status_code == 200

    def test_export_csv(self):
        """GET /api/v1/users/export_csv/ returns CSV file."""
        User.objects.create_user(username="csvuser1", password="pass123", role="VIEWER", tenant=self.cn_tenant)

        response = self.client.get("/api/v1/users/export_csv/")
        assert response.status_code == 200
        assert response['Content-Type'] == 'text/csv'
        assert 'attachment' in response['Content-Disposition']
        # Check CSV content
        content = response.content.decode('utf-8')
        assert 'username' in content
        assert 'csvuser1' in content

    def test_import_csv_success(self):
        """POST /api/v1/users/import_csv/ with valid CSV creates users."""
        csv_content = "username,email,role,password\nimportuser1,imp1@test.com,JUDGE,TestPass123\nimportuser2,imp2@test.com,VIEWER,TestPass123"
        import io
        from django.core.files.uploadedfile import SimpleUploadedFile
        csv_file = SimpleUploadedFile(
            "users.csv",
            csv_content.encode('utf-8'),
            content_type="text/csv"
        )
        response = self.client.post(
            "/api/v1/users/import_csv/",
            {"file": csv_file},
            format="multipart"
        )
        assert response.status_code == 200
        assert response.data["created"] == 2
        assert User.objects.filter(username="importuser1").exists()
        assert User.objects.filter(username="importuser2").exists()

    def test_import_csv_invalid_role(self):
        """POST /api/v1/users/import_csv/ with invalid role reports error."""
        csv_content = "username,email,role,password\nbaduser,bad@test.com,SUPERADMIN,TestPass123"
        import io
        from django.core.files.uploadedfile import SimpleUploadedFile
        csv_file = SimpleUploadedFile(
            "users.csv",
            csv_content.encode('utf-8'),
            content_type="text/csv"
        )
        response = self.client.post(
            "/api/v1/users/import_csv/",
            {"file": csv_file},
            format="multipart"
        )
        assert response.status_code == 200
        assert response.data["created"] == 0
        assert len(response.data["errors"]) > 0

    def test_import_csv_duplicate_username(self):
        """POST /api/v1/users/import_csv/ with duplicate username reports error."""
        User.objects.create_user(username="existuser", password="pass123", role="VIEWER", tenant=self.cn_tenant)
        csv_content = "username,email,role,password\nexistuser,new@test.com,JUDGE,TestPass123"
        from django.core.files.uploadedfile import SimpleUploadedFile
        csv_file = SimpleUploadedFile(
            "users.csv",
            csv_content.encode('utf-8'),
            content_type="text/csv"
        )
        response = self.client.post(
            "/api/v1/users/import_csv/",
            {"file": csv_file},
            format="multipart"
        )
        assert response.status_code == 200
        assert response.data["created"] == 0
        assert any("already exists" in e for e in response.data["errors"])

    def test_import_csv_no_file(self):
        """POST /api/v1/users/import_csv/ without file returns 400."""
        response = self.client.post("/api/v1/users/import_csv/", {}, format="multipart")
        assert response.status_code == 400
        assert "error" in response.data

    def test_import_csv_wrong_extension(self):
        """POST /api/v1/users/import_csv/ with non-CSV file returns 400."""
        from django.core.files.uploadedfile import SimpleUploadedFile
        txt_file = SimpleUploadedFile(
            "users.txt",
            b"username,email,role\nuser1,user1@test.com,VIEWER",
            content_type="text/plain"
        )
        response = self.client.post(
            "/api/v1/users/import_csv/",
            {"file": txt_file},
            format="multipart"
        )
        assert response.status_code == 400
        assert "csv" in response.data["error"].lower()


@pytest.mark.django_db
class TestUserManagementPermission:
    """Test User Management permission enforcement."""

    @pytest.fixture(autouse=True)
    def setup(self, api_client, judge_user, cn_tenant):
        self.client = api_client
        self.judge_user = judge_user
        self.cn_tenant = cn_tenant
        # Login as judge to get JWT token
        response = self.client.post("/api/v1/auth/login/", {
            "username": "judge",
            "password": "judge123",
        })
        token = response.data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_judge_cannot_list_users(self):
        """Non-ADMIN user cannot list users (returns 403)."""
        response = self.client.get("/api/v1/users/")
        # Judge gets 403 Forbidden because only ADMIN can access user management
        assert response.status_code == 403

    def test_judge_cannot_create_user(self):
        """Non-ADMIN user cannot create users."""
        data = {
            "username": "hacker",
            "password": "securepass123",
        }
        response = self.client.post("/api/v1/users/", data, format="json")
        # Returns 403 because has_permission returns False for non-ADMIN
        assert response.status_code == 403

    def test_judge_cannot_update_user(self):
        """Non-ADMIN user cannot update users."""
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user = User.objects.create_user(username="target", password="pass123", role="VIEWER", tenant=self.cn_tenant)

        response = self.client.patch(f"/api/v1/users/{user.id}/", {"email": "hack@test.com"}, format="json")
        assert response.status_code == 403

    def test_judge_cannot_delete_user(self):
        """Non-ADMIN user cannot delete users."""
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user = User.objects.create_user(username="deleteme", password="pass123", role="VIEWER", tenant=self.cn_tenant)

        response = self.client.delete(f"/api/v1/users/{user.id}/")
        assert response.status_code == 403

    def test_judge_cannot_activate_user(self):
        """Non-ADMIN user cannot activate users."""
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user = User.objects.create_user(username="toactivate", password="pass123", role="VIEWER", tenant=self.cn_tenant, is_active=False)

        response = self.client.post(f"/api/v1/users/{user.id}/activate/")
        assert response.status_code == 403

    def test_judge_cannot_deactivate_user(self):
        """Non-ADMIN user cannot deactivate users."""
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user = User.objects.create_user(username="todeactivate", password="pass123", role="VIEWER", tenant=self.cn_tenant, is_active=True)

        response = self.client.post(f"/api/v1/users/{user.id}/deactivate/")
        assert response.status_code == 403

    def test_judge_cannot_reset_password(self):
        """Non-ADMIN user cannot reset passwords."""
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user = User.objects.create_user(username="toreset", password="pass123", role="VIEWER", tenant=self.cn_tenant)

        response = self.client.post(f"/api/v1/users/{user.id}/reset_password/")
        assert response.status_code == 403

    def test_judge_cannot_batch_activate(self):
        """Non-ADMIN user cannot batch activate users."""
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user = User.objects.create_user(username="tobatchactivate", password="pass123", role="VIEWER", tenant=self.cn_tenant, is_active=False)

        response = self.client.post("/api/v1/users/batch_activate/", {"user_ids": [user.id]}, format="json")
        assert response.status_code == 403

    def test_judge_cannot_batch_deactivate(self):
        """Non-ADMIN user cannot batch deactivate users."""
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user = User.objects.create_user(username="tobatchdeactivate", password="pass123", role="VIEWER", tenant=self.cn_tenant, is_active=True)

        response = self.client.post("/api/v1/users/batch_deactivate/", {"user_ids": [user.id]}, format="json")
        assert response.status_code == 403

    def test_judge_cannot_assign_roles(self):
        """Non-ADMIN user cannot assign roles to users."""
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user = User.objects.create_user(username="roleassign3", password="pass123", role="VIEWER", tenant=self.cn_tenant)

        response = self.client.post(f"/api/v1/users/{user.id}/assign_roles/", {"role": "ADMIN"}, format="json")
        assert response.status_code == 403


@pytest.mark.django_db
class TestUserManagementUnauthenticated:
    """Test User Management unauthenticated access."""

    def test_unauthenticated_list_denied(self, api_client):
        """Unauthenticated GET /api/v1/users/ returns 401/403."""
        response = api_client.get("/api/v1/users/")
        assert response.status_code in [401, 403]

    def test_unauthenticated_create_denied(self, api_client):
        """Unauthenticated POST /api/v1/users/ returns 401/403."""
        data = {"username": "hacker", "password": "pass123"}
        response = api_client.post("/api/v1/users/", data, format="json")
        assert response.status_code in [401, 403]


@pytest.mark.django_db
class TestPasswordReset:
    """Test password reset flow: request code + set new password."""

    def test_request_reset_code(self, api_client, admin_user):
        """POST /api/v1/auth/reset-password/ returns success for valid email."""
        admin_user.email = "admin@example.com"
        admin_user.save(update_fields=["email"])
        response = api_client.post("/api/v1/auth/reset-password/", {
            "email": "admin@example.com",
        }, format="json")
        assert response.status_code == 200
        assert "detail" in response.data

    def test_request_reset_code_nonexistent_email(self, api_client):
        """POST /api/v1/auth/reset-password/ returns success even for unknown email (security)."""
        response = api_client.post("/api/v1/auth/reset-password/", {
            "email": "nonexistent@example.com",
        }, format="json")
        assert response.status_code == 200

    def test_set_new_password_invalid_code(self, api_client, admin_user):
        """POST /api/v1/auth/set-new-password/ with wrong code returns 400."""
        admin_user.email = "admin2@example.com"
        admin_user.save(update_fields=["email"])
        response = api_client.post("/api/v1/auth/set-new-password/", {
            "email": "admin2@example.com",
            "code": "000000",
            "new_password": "NewSecurePass123!",
        }, format="json")
        assert response.status_code == 400
        assert "error" in response.data

    def test_set_new_password_expired_code(self, api_client, admin_user):
        """POST /api/v1/auth/set-new-password/ without requesting code first returns 400."""
        admin_user.email = "admin3@example.com"
        admin_user.save(update_fields=["email"])
        response = api_client.post("/api/v1/auth/set-new-password/", {
            "email": "admin3@example.com",
            "code": "123456",
            "new_password": "NewSecurePass123!",
        }, format="json")
        assert response.status_code == 400

    def test_set_new_password_success(self, api_client, admin_user):
        """Full flow: request code then set new password successfully."""
        admin_user.email = "admin4@example.com"
        admin_user.save(update_fields=["email"])
        test_email = "admin4@example.com"

        # Step 1: Request reset code
        resp1 = api_client.post("/api/v1/auth/reset-password/", {
            "email": test_email,
        }, format="json")
        assert resp1.status_code == 200

        # Get the code that was stored in cache (logged in backend)
        import secrets
        code = str(secrets.randbelow(900000) + 100000)

        # Manually set the code in cache for testing
        from django.core.cache import cache
        cache.set(f"pwd_reset:{test_email}", code, timeout=300)

        # Step 2: Set new password with valid code
        resp2 = api_client.post("/api/v1/auth/set-new-password/", {
            "email": test_email,
            "code": code,
            "new_password": "NewSecurePass123!",
        }, format="json")
        assert resp2.status_code == 200
        assert "detail" in resp2.data

        # Verify new password works
        admin_user.refresh_from_db()
        assert admin_user.check_password("NewSecurePass123!")

    def test_set_new_password_short(self, api_client, admin_user):
        """POST /api/v1/auth/set-new-password/ with short password returns 400."""
        admin_user.email = "admin5@example.com"
        admin_user.save(update_fields=["email"])
        test_email = "admin5@example.com"
        import secrets
        code = str(secrets.randbelow(900000) + 100000)
        from django.core.cache import cache
        cache.set(f"pwd_reset:{test_email}", code, timeout=300)

        response = api_client.post("/api/v1/auth/set-new-password/", {
            "email": test_email,
            "code": code,
            "new_password": "short",
        }, format="json")
        assert response.status_code == 400


@pytest.mark.django_db
class TestProfileAPI:
    """Test profile API endpoints."""

    @pytest.fixture(autouse=True)
    def setup(self, api_client, admin_user, cn_tenant):
        self.client = api_client
        self.admin_user = admin_user
        # Login to get JWT token
        response = self.client.post("/api/v1/auth/login/", {
            "username": "admin",
            "password": "admin123",
        })
        token = response.data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_get_profile(self):
        """GET /api/v1/auth/profile/ returns current user profile."""
        response = self.client.get("/api/v1/auth/profile/")
        assert response.status_code == 200
        assert response.data["username"] == "admin"
        assert "email" in response.data
        assert "role" in response.data

    def test_update_profile_email(self):
        """PATCH /api/v1/auth/profile/ updates email."""
        update_data = {"email": "newemail@example.com"}
        response = self.client.patch("/api/v1/auth/profile/", update_data, format="json")
        assert response.status_code == 200
        assert response.data["email"] == "newemail@example.com"
        # Verify persisted
        self.admin_user.refresh_from_db()
        assert self.admin_user.email == "newemail@example.com"

    def test_update_profile_first_name(self):
        """PATCH /api/v1/auth/profile/ updates first_name."""
        update_data = {"first_name": "John"}
        response = self.client.patch("/api/v1/auth/profile/", update_data, format="json")
        assert response.status_code == 200
        assert response.data["first_name"] == "John"

    def test_update_profile_last_name(self):
        """PATCH /api/v1/auth/profile/ updates last_name."""
        update_data = {"last_name": "Doe"}
        response = self.client.patch("/api/v1/auth/profile/", update_data, format="json")
        assert response.status_code == 200
        assert response.data["last_name"] == "Doe"

    def test_update_profile_readonly_fields(self):
        """PATCH /api/v1/auth/profile/ cannot change read-only fields."""
        update_data = {
            "username": "hacker",
            "role": "ADMIN",
            "is_active": False,
        }
        response = self.client.patch("/api/v1/auth/profile/", update_data, format="json")
        assert response.status_code == 200
        # Read-only fields should be unchanged
        assert response.data["username"] == "admin"
        assert response.data["role"] == "ADMIN"
        assert response.data["is_active"] == True

    def test_change_password_success(self):
        """POST /api/v1/auth/change-password/ with correct old password succeeds."""
        data = {
            "old_password": "admin123",
            "new_password": "NewSecurePass123!",
        }
        response = self.client.post("/api/v1/auth/change-password/", data, format="json")
        assert response.status_code == 200
        assert "detail" in response.data
        # Verify new password works
        self.admin_user.refresh_from_db()
        assert self.admin_user.check_password("NewSecurePass123!")

    def test_change_password_wrong_old(self):
        """POST /api/v1/auth/change-password/ with wrong old password returns 400."""
        data = {
            "old_password": "wrongpassword",
            "new_password": "NewSecurePass123!",
        }
        response = self.client.post("/api/v1/auth/change-password/", data, format="json")
        assert response.status_code == 400

    def test_change_password_short(self):
        """POST /api/v1/auth/change-password/ with short password returns 400."""
        data = {
            "old_password": "admin123",
            "new_password": "short",
        }
        response = self.client.post("/api/v1/auth/change-password/", data, format="json")
        assert response.status_code == 400

    def test_change_password_missing_fields(self):
        """POST /api/v1/auth/change-password/ with missing fields returns 400."""
        data = {"old_password": "admin123"}
        response = self.client.post("/api/v1/auth/change-password/", data, format="json")
        assert response.status_code == 400

    def test_change_password_unauthenticated(self, api_client):
        """POST /api/v1/auth/change-password/ without auth returns 401/403."""
        api_client.force_authenticate(user=None)
        data = {
            "old_password": "admin123",
            "new_password": "NewSecurePass123!",
        }
        response = api_client.post("/api/v1/auth/change-password/", data, format="json")
        assert response.status_code in [401, 403]

    def test_get_profile_unauthenticated(self, api_client):
        """GET /api/v1/auth/profile/ without auth returns 401/403."""
        api_client.force_authenticate(user=None)
        response = api_client.get("/api/v1/auth/profile/")
        assert response.status_code in [401, 403]


@pytest.mark.django_db
class TestLoginLog:
    """Test LoginLog model and login tracking."""

    def test_login_success_creates_log(self, api_client, admin_user):
        """Successful login creates a SUCCESS login log entry."""
        from apps.authentication.models import LoginLog
        initial_count = LoginLog.objects.count()

        response = api_client.post("/api/v1/auth/login/", {
            "username": "admin",
            "password": "admin123",
        }, format="json")
        assert response.status_code == 200

        assert LoginLog.objects.count() == initial_count + 1
        log = LoginLog.objects.latest("timestamp")
        assert log.username == "admin"
        assert log.status == "SUCCESS"
        assert log.user_id == admin_user.id

    def test_login_failure_creates_log(self, api_client, admin_user):
        """Failed login creates a FAILED login log entry."""
        from apps.authentication.models import LoginLog
        initial_count = LoginLog.objects.count()

        response = api_client.post("/api/v1/auth/login/", {
            "username": "admin",
            "password": "wrongpassword",
        }, format="json")
        assert response.status_code == 401

        assert LoginLog.objects.count() == initial_count + 1
        log = LoginLog.objects.latest("timestamp")
        assert log.username == "admin"
        assert log.status == "FAILED"

    def test_nonexistent_user_login_creates_log(self, api_client):
        """Login with nonexistent username creates a FAILED log."""
        from apps.authentication.models import LoginLog
        initial_count = LoginLog.objects.count()

        response = api_client.post("/api/v1/auth/login/", {
            "username": "nonexistent",
            "password": "anypassword",
        }, format="json")
        # Returns 401 for nonexistent user
        assert response.status_code == 401

        assert LoginLog.objects.count() == initial_count + 1
        log = LoginLog.objects.latest("timestamp")
        assert log.username == "nonexistent"
        assert log.status == "FAILED"
        assert log.user_id is None

    def test_admin_can_list_login_logs(self, api_client, admin_user, cn_tenant):
        """ADMIN can list login logs."""
        # Create a login log first
        from apps.authentication.models import LoginLog
        LoginLog.objects.create(
            user=admin_user,
            username="admin",
            status="SUCCESS",
            ip_address="127.0.0.1",
        )

        # Login as admin
        response = api_client.post("/api/v1/auth/login/", {
            "username": "admin",
            "password": "admin123",
        }, format="json")
        token = response.data["access"]
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

        # List login logs
        response = api_client.get("/api/v1/auth/login-logs/")
        assert response.status_code == 200
        assert "results" in response.data or isinstance(response.data, list)

    def test_admin_can_filter_login_logs_by_status(self, api_client, admin_user, cn_tenant):
        """ADMIN can filter login logs by status."""
        from apps.authentication.models import LoginLog

        # Login as admin first to get token (this creates a SUCCESS log)
        response = api_client.post("/api/v1/auth/login/", {
            "username": "admin",
            "password": "admin123",
        }, format="json")
        assert response.status_code == 200
        token = response.data["access"]
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

        # Create a FAILED log
        LoginLog.objects.create(user=None, username="hacker", status="FAILED")

        # Filter by SUCCESS
        response = api_client.get("/api/v1/auth/login-logs/?status=SUCCESS")
        assert response.status_code == 200
        results = response.data.get("results", response.data)
        for log in results:
            assert log["status"] == "SUCCESS"

    def test_judge_cannot_list_login_logs(self, api_client, judge_user, cn_tenant):
        """Non-ADMIN user cannot list login logs."""
        from apps.authentication.models import LoginLog
        LoginLog.objects.create(user=judge_user, username="judge", status="SUCCESS")

        # Login as judge
        response = api_client.post("/api/v1/auth/login/", {
            "username": "judge",
            "password": "judge123",
        }, format="json")
        token = response.data["access"]
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

        response = api_client.get("/api/v1/auth/login-logs/")
        assert response.status_code == 403

    def test_login_log_readonly(self, api_client, admin_user, cn_tenant):
        """Login logs are read-only (no create/update/delete)."""
        from apps.authentication.models import LoginLog
        LoginLog.objects.create(user=admin_user, username="admin", status="SUCCESS")

        # Login as admin
        response = api_client.post("/api/v1/auth/login/", {
            "username": "admin",
            "password": "admin123",
        }, format="json")
        token = response.data["access"]
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

        # Cannot create
        response = api_client.post("/api/v1/auth/login-logs/", {
            "username": "test",
            "status": "SUCCESS",
        }, format="json")
        assert response.status_code == 405

        # Cannot delete
        log = LoginLog.objects.first()
        response = api_client.delete(f"/api/v1/auth/login-logs/{log.id}/")
        assert response.status_code == 405

        # Cannot update
        response = api_client.patch(f"/api/v1/auth/login-logs/{log.id}/", {
            "status": "FAILED",
        }, format="json")
        assert response.status_code == 405