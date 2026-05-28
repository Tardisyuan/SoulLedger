"""
Tests for audit functionality: auto create_user/update_user and AuditLog signals.
"""
import os
import pytest
from unittest.mock import patch

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")


@pytest.fixture
def api_client():
    from rest_framework.test import APIClient
    return APIClient()


@pytest.fixture
def cn_tenant(db):
    """Create a tenant for testing."""
    from apps.tenants.models import Tenant
    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "Chinese Diyu"})
    return tenant


@pytest.fixture
def admin_user(db, django_user_model, cn_tenant):
    """Create admin user with tenant."""
    user = django_user_model.objects.create_user(
        username="audit_admin", password="admin123", role="ADMIN", tenant=cn_tenant
    )
    return user


@pytest.fixture
def auth_client(api_client, admin_user):
    """APIClient authenticated as admin_user."""
    import contextlib
    from apps.core import request_local as rl_module

    # Create a context manager that keeps contextvar set during API calls
    @contextlib.contextmanager
    def set_user_context():
        # Save original state
        old_user = rl_module.get_current_user()
        old_request = rl_module.get_current_request()

        # Set user for this context
        rl_module.set_current_user(admin_user)
        rl_module.set_current_request(None)

        try:
            yield
        finally:
            # Restore original state
            rl_module.clear_current_user()
            if old_user:
                rl_module.set_current_user(old_user)
            if old_request:
                rl_module.set_current_request(old_request)

    # Store context manager on the client for use in tests
    api_client.force_authenticate(user=admin_user)
    api_client.set_user_context = set_user_context

    # Also set contextvar at module level for direct model operations
    rl_module.set_current_user(admin_user)
    rl_module.set_current_request(None)

    yield api_client

    # Clear contextvar after test
    rl_module.clear_current_user()


@pytest.mark.django_db
class TestAuditUserFields:
    """Test that create_user/update_user are auto-populated."""

    def test_create_user_set_on_soul_via_api(self, auth_client):
        """When creating a soul via API, create_user should be auto-filled."""
        from apps.souls.models import Soul

        response = auth_client.post("/api/v1/souls/", {
            "name": "Audit Test Soul",
            "birth_date": "1990-01-01",
            "origin_location": "Test Location",
        })

        assert response.status_code == 201, f"Got: {response.data}"
        soul_id = response.data["id"]
        soul = Soul.objects.get(pk=soul_id)

        assert soul.create_user is not None, "create_user should be auto-filled"
        assert soul.create_user.username == "audit_admin"

    def test_update_user_set_on_soul_via_api(self, auth_client):
        """When updating a soul via API, update_user should be auto-filled."""
        from apps.souls.models import Soul

        # Create first
        response = auth_client.post("/api/v1/souls/", {
            "name": "Audit Update Test",
            "birth_date": "1990-01-01",
        })
        soul_id = response.data["id"]

        # Update
        auth_client.patch(f"/api/v1/souls/{soul_id}/", {"name": "Updated Name"})

        soul = Soul.objects.get(pk=soul_id)
        assert soul.update_user is not None, "update_user should be auto-filled on update"
        assert soul.update_user.username == "audit_admin"

    def test_create_user_null_for_anonymous(self, db, cn_tenant):
        """Anonymous model saves should have null create_user."""
        from apps.souls.models import Soul

        # civilization is a property derived from tenant, not a settable field
        soul = Soul.objects.create(
            tenant=cn_tenant,
            name="Anonymous Soul",
        )
        assert soul.create_user is None, "Anonymous save should have null create_user"


@pytest.mark.django_db(transaction=True)
class TestAuditLogSignals:
    """Test that AuditLog entries are created on model changes.

    Uses transaction=True so that transaction.on_commit() callbacks fire.
    """

    def test_audit_log_created_on_soul_create(self, auth_client):
        """Creating a soul should log an AuditLog entry."""
        from apps.audit.models import AuditLog

        initial_count = AuditLog.objects.count()

        response = auth_client.post("/api/v1/souls/", {
            "name": "Audit Log Test",
            "birth_date": "1990-01-01",
        })

        assert response.status_code == 201
        # Due to perform_create doing serializer.save() + soul.save(update_fields=['tenant']),
        # we may create multiple audit logs, so just check we created at least one
        assert AuditLog.objects.count() >= initial_count + 1, "Should create at least 1 audit log entry"

        log = AuditLog.objects.filter(
            resource="soul", resource_id=str(response.data["id"]), action="CREATE"
        ).order_by("-timestamp").first()
        assert log is not None, "Should have a CREATE audit log"
        assert log.user is not None
        assert log.user.username == "audit_admin"

    def test_audit_log_created_on_soul_update(self, auth_client):
        """Updating a soul should log an AuditLog entry."""
        from apps.audit.models import AuditLog

        # Create
        response = auth_client.post("/api/v1/souls/", {
            "name": "Audit Update Test",
            "birth_date": "1990-01-01",
        })
        soul_id = response.data["id"]
        create_log_count = AuditLog.objects.count()

        # Update
        auth_client.patch(f"/api/v1/souls/{soul_id}/", {"name": "New Name"})

        # Should have at least one more audit log (UPDATE signal)
        assert AuditLog.objects.count() >= create_log_count + 1, "Should create audit log on update"

        # Find the UPDATE log
        update_log = AuditLog.objects.filter(
            resource="soul", resource_id=str(soul_id), action="UPDATE"
        ).order_by("-timestamp").first()
        assert update_log is not None, "Should have an UPDATE audit log"
        assert update_log.user is not None

    def test_audit_log_created_on_soul_delete(self, auth_client):
        """Deleting a soul should log an AuditLog entry."""
        from apps.audit.models import AuditLog

        # Create
        response = auth_client.post("/api/v1/souls/", {
            "name": "Audit Delete Test",
            "birth_date": "1990-01-01",
        })
        soul_id = response.data["id"]
        create_log_count = AuditLog.objects.count()

        # Delete
        auth_client.delete(f"/api/v1/souls/{soul_id}/")

        # Should have at least one more audit log
        assert AuditLog.objects.count() >= create_log_count + 1, "Should create audit log on delete"

        # Find the DELETE log
        delete_log = AuditLog.objects.filter(
            resource="soul", resource_id=str(soul_id), action="DELETE"
        ).order_by("-timestamp").first()
        assert delete_log is not None, "Should have a DELETE audit log"

    def test_audit_log_captures_ip_and_user_agent(self, auth_client):
        """AuditLog should capture IP address and user agent."""
        from apps.audit.models import AuditLog

        create_count = AuditLog.objects.count()

        auth_client.post("/api/v1/souls/", {
            "name": "IP Test Soul",
            "birth_date": "1990-01-01",
        }, HTTP_USER_AGENT="TestClient/1.0", HTTP_X_FORWARDED_FOR="192.168.1.1")

        # Should have at least one more audit log
        assert AuditLog.objects.count() >= create_count + 1

        log = AuditLog.objects.order_by("-timestamp").first()
        assert log.ip_address == "192.168.1.1", f"Should capture IP from X-Forwarded-For, got: {log.ip_address}"
        assert log.user_agent == "TestClient/1.0", "Should capture User-Agent"

    def test_audit_log_anonymous_action(self, db, cn_tenant):
        """Anonymous operations (no user) should still create audit logs."""
        from apps.audit.models import AuditLog
        from apps.souls.models import Soul

        initial_count = AuditLog.objects.count()

        # Anonymous creates should still log but with null user
        Soul.objects.create(tenant=cn_tenant, name="Anonymous Soul")

        assert AuditLog.objects.count() == initial_count + 1
        log = AuditLog.objects.order_by("-timestamp").first()
        assert log.action == "CREATE"
        assert log.user is None


@pytest.mark.django_db
class TestPermissionChangeAuditLog:
    """Test that permission changes create audit logs."""

    def test_permission_change_on_role_permission_create(self, auth_client):
        """Adding a permission to a role should create a PERMISSION_CHANGE audit log."""
        from apps.audit.models import AuditLog, AuditAction
        from apps.perm.models import Permission, RolePermission, Role

        # Ensure we have a role and permission
        role, _ = Role.objects.get_or_create(name="TEST_ROLE", defaults={"display_name": "Test Role"})
        perm, _ = Permission.objects.get_or_create(codename="test.permission", defaults={"name": "Test Permission", "category": "test"})

        initial_count = AuditLog.objects.filter(action=AuditAction.PERMISSION_CHANGE).count()

        # Add permission to role
        RolePermission.objects.create(role=role, permission=perm)

        # Should have a new PERMISSION_CHANGE audit log
        assert AuditLog.objects.filter(action=AuditAction.PERMISSION_CHANGE).count() == initial_count + 1

        log = AuditLog.objects.filter(
            action=AuditAction.PERMISSION_CHANGE,
            resource="RolePermission"
        ).order_by("-timestamp").first()
        assert log is not None, "Should have a PERMISSION_CHANGE audit log for RolePermission"
        assert log.changes is not None
        assert log.changes["permissions"]["old"] == []
        assert "test.permission" in log.changes["permissions"]["new"]

    def test_permission_change_on_role_permission_delete(self, auth_client):
        """Removing a permission from a role should create a PERMISSION_CHANGE audit log."""
        from apps.audit.models import AuditLog, AuditAction
        from apps.perm.models import Permission, RolePermission, Role

        # Ensure we have a role and permission
        role, _ = Role.objects.get_or_create(name="TEST_ROLE_DEL", defaults={"display_name": "Test Role Del"})
        perm, _ = Permission.objects.get_or_create(codename="test.permission.del", defaults={"name": "Test Permission Del", "category": "test"})

        # Create a role permission to delete
        rp = RolePermission.objects.create(role=role, permission=perm)

        initial_count = AuditLog.objects.filter(action=AuditAction.PERMISSION_CHANGE).count()

        # Delete the role permission
        rp.delete()

        # Should have a new PERMISSION_CHANGE audit log
        assert AuditLog.objects.filter(action=AuditAction.PERMISSION_CHANGE).count() == initial_count + 1

        log = AuditLog.objects.filter(
            action=AuditAction.PERMISSION_CHANGE,
            resource="RolePermission"
        ).order_by("-timestamp").first()
        assert log is not None, "Should have a PERMISSION_CHANGE audit log for RolePermission deletion"
        assert log.changes is not None
        assert "test.permission.del" in log.changes["permissions"]["old"]
        assert log.changes["permissions"]["new"] == []

    def test_permission_change_captures_user(self, auth_client):
        """Permission change audit log should capture the user who made the change."""
        from apps.audit.models import AuditLog, AuditAction
        from apps.perm.models import Permission, RolePermission, Role

        # Ensure we have a role and permission
        role, _ = Role.objects.get_or_create(name="TEST_ROLE_USER", defaults={"display_name": "Test Role User"})
        perm, _ = Permission.objects.get_or_create(codename="test.permission.user", defaults={"name": "Test Permission User", "category": "test"})

        # Create role permission
        RolePermission.objects.create(role=role, permission=perm)

        log = AuditLog.objects.filter(
            action=AuditAction.PERMISSION_CHANGE,
            resource="RolePermission"
        ).order_by("-timestamp").first()

        assert log is not None
        assert log.user is not None, "Should capture the user who made the change"
        assert log.user.username == "audit_admin"


@pytest.mark.django_db(transaction=True)
class TestAuditLogViewSet:
    """Test AuditLog ViewSet with filtering support.

    Uses transaction=True so that transaction.on_commit() callbacks fire.
    """

    def test_list_audit_logs(self, auth_client):
        """GET /api/v1/audit-logs/ returns paginated audit logs."""
        from apps.audit.models import AuditLog, AuditAction
        from apps.souls.models import Soul

        # Create a soul to generate audit logs
        response = auth_client.post("/api/v1/souls/", {
            "name": "ViewSet Test Soul",
            "birth_date": "1990-01-01",
        })
        assert response.status_code == 201

        # List audit logs
        response = auth_client.get("/api/v1/audit-logs/")
        assert response.status_code == 200
        assert "results" in response.data
        assert len(response.data["results"]) > 0

    def test_filter_by_action(self, auth_client):
        """GET /api/v1/audit-logs/?action=CREATE filters by action type."""
        from apps.souls.models import Soul

        # Create a soul
        response = auth_client.post("/api/v1/souls/", {
            "name": "Filter Test Soul",
            "birth_date": "1990-01-01",
        })
        assert response.status_code == 201

        # Filter by CREATE action
        response = auth_client.get("/api/v1/audit-logs/?action=CREATE")
        assert response.status_code == 200
        for log in response.data["results"]:
            assert log["action"] == "CREATE"

    def test_filter_by_resource(self, auth_client):
        """GET /api/v1/audit-logs/?resource=soul filters by resource type."""
        response = auth_client.get("/api/v1/audit-logs/?resource=soul")
        assert response.status_code == 200
        for log in response.data["results"]:
            assert "soul" in log["resource"].lower()

    def test_filter_by_user_id(self, auth_client, admin_user):
        """GET /api/v1/audit-logs/?user_id=<id> filters by user."""
        response = auth_client.get(f"/api/v1/audit-logs/?user_id={admin_user.id}")
        assert response.status_code == 200
        for log in response.data["results"]:
            assert str(log.get("user")) == str(admin_user.id) or log.get("user_display") == admin_user.username

    def test_actions_endpoint(self, auth_client):
        """GET /api/v1/audit-logs/actions/ returns all action types."""
        response = auth_client.get("/api/v1/audit-logs/actions/")
        assert response.status_code == 200
        actions = [a["value"] for a in response.data]

        # Verify new action types are present
        assert "VIEW" in actions
        assert "EXPORT" in actions
        assert "IMPORT" in actions
        assert "BATCH_CREATE" in actions
        assert "BATCH_UPDATE" in actions
        assert "BATCH_DELETE" in actions

    def test_resources_endpoint(self, auth_client):
        """GET /api/v1/audit-logs/resources/ returns distinct resource types."""
        response = auth_client.get("/api/v1/audit-logs/resources/")
        assert response.status_code == 200
        assert isinstance(response.data, list)

    def test_stats_endpoint_admin_only(self, auth_client, admin_user):
        """GET /api/v1/audit-logs/stats/ requires admin role."""
        response = auth_client.get("/api/v1/audit-logs/stats/")
        assert response.status_code == 200
        assert "action_distribution" in response.data
        assert "total_logs" in response.data


@pytest.mark.django_db
class TestBatchAuditLog:
    """Test batch operation audit logging."""

    def test_batch_audit_log_creation(self, auth_client, admin_user):
        """Test create_batch_audit_log creates a proper batch audit entry."""
        from apps.audit.models import AuditLog, AuditAction
        from apps.audit.signals import create_batch_audit_log
        from apps.souls.models import Soul

        # Create some souls for batch operation
        souls = []
        for i in range(3):
            soul = Soul.objects.create(
                tenant=admin_user.tenant,
                name=f"Batch Soul {i}"
            )
            souls.append(soul)

        initial_count = AuditLog.objects.filter(action=AuditAction.BATCH_DELETE).count()

        # Call batch audit log
        create_batch_audit_log(
            action=AuditAction.BATCH_DELETE,
            instances=souls,
            changes={"reason": "test batch delete"}
        )

        assert AuditLog.objects.filter(action=AuditAction.BATCH_DELETE).count() == initial_count + 1

        log = AuditLog.objects.filter(
            action=AuditAction.BATCH_DELETE
        ).order_by("-timestamp").first()

        assert log is not None
        assert log.changes is not None
        assert log.changes["batch_operation"] is True
        assert log.changes["resource_count"] == 3
        assert len(log.changes["resources"]) == 3


@pytest.mark.django_db
class TestNewAuditActionTypes:
    """Test new audit action types (VIEW, EXPORT, IMPORT)."""

    def test_view_action_exists(self):
        """AuditAction should have VIEW type."""
        from apps.audit.models import AuditAction
        assert hasattr(AuditAction, "VIEW")
        assert AuditAction.VIEW == "VIEW"

    def test_export_action_exists(self):
        """AuditAction should have EXPORT type."""
        from apps.audit.models import AuditAction
        assert hasattr(AuditAction, "EXPORT")
        assert AuditAction.EXPORT == "EXPORT"

    def test_import_action_exists(self):
        """AuditAction should have IMPORT type."""
        from apps.audit.models import AuditAction
        assert hasattr(AuditAction, "IMPORT")
        assert AuditAction.IMPORT == "IMPORT"

    def test_log_view_action(self, auth_client, admin_user):
        """Manually logging a VIEW action should work."""
        from apps.audit.models import AuditLog, AuditAction
        from apps.souls.models import Soul

        soul = Soul.objects.create(
            tenant=admin_user.tenant,
            name="View Action Test"
        )

        initial_count = AuditLog.objects.count()

        AuditLog.objects.create(
            tenant=admin_user.tenant,
            user=admin_user,
            action=AuditAction.VIEW,
            resource="soul",
            resource_id=str(soul.id),
            description=f"View soul {soul.name}"
        )

        assert AuditLog.objects.count() == initial_count + 1
        log = AuditLog.objects.order_by("-timestamp").first()
        assert log.action == "VIEW"

    def test_log_export_action(self, auth_client, admin_user):
        """Manually logging an EXPORT action should work."""
        from apps.audit.models import AuditLog, AuditAction

        initial_count = AuditLog.objects.count()

        AuditLog.objects.create(
            tenant=admin_user.tenant,
            user=admin_user,
            action=AuditAction.EXPORT,
            resource="soul",
            resource_id="bulk",
            description="Export all souls to CSV"
        )

        assert AuditLog.objects.count() == initial_count + 1
        log = AuditLog.objects.order_by("-timestamp").first()
        assert log.action == "EXPORT"

    def test_log_import_action(self, auth_client, admin_user):
        """Manually logging an IMPORT action should work."""
        from apps.audit.models import AuditLog, AuditAction

        initial_count = AuditLog.objects.count()

        AuditLog.objects.create(
            tenant=admin_user.tenant,
            user=admin_user,
            action=AuditAction.IMPORT,
            resource="soul",
            resource_id="bulk",
            description="Import souls from CSV"
        )

        assert AuditLog.objects.count() == initial_count + 1
        log = AuditLog.objects.order_by("-timestamp").first()
        assert log.action == "IMPORT"


@pytest.mark.django_db(transaction=True)
class TestAuditApiEndpoint:
    """Test the /api/v1/audit-logs/ endpoint.

    Uses transaction=True so that transaction.on_commit() callbacks fire.
    """

    def test_list_audit_returns_paginated_results(self, auth_client):
        """GET /api/v1/audit-logs/ returns paginated results."""
        from apps.souls.models import Soul

        # Create a soul to generate an audit log
        response = auth_client.post("/api/v1/souls/", {
            "name": "Pagination Test Soul",
            "birth_date": "1990-01-01",
        })
        assert response.status_code == 201

        # List audit logs via /api/v1/audit-logs/
        response = auth_client.get("/api/v1/audit-logs/")
        assert response.status_code == 200
        assert "results" in response.data
        assert "count" in response.data
        assert isinstance(response.data["results"], list)
        assert len(response.data["results"]) > 0

    def test_filter_by_action(self, auth_client):
        """GET /api/v1/audit-logs/?action=CREATE filters by action type."""
        from apps.souls.models import Soul

        # Create a soul
        response = auth_client.post("/api/v1/souls/", {
            "name": "Action Filter Test",
            "birth_date": "1990-01-01",
        })
        assert response.status_code == 201

        # Filter by CREATE action
        response = auth_client.get("/api/v1/audit-logs/?action=CREATE")
        assert response.status_code == 200
        for log in response.data["results"]:
            assert log["action"] == "CREATE"

    def test_filter_by_resource(self, auth_client):
        """GET /api/v1/audit-logs/?resource=soul filters by resource type."""
        from apps.souls.models import Soul

        # Create a soul
        response = auth_client.post("/api/v1/souls/", {
            "name": "Resource Filter Test",
            "birth_date": "1990-01-01",
        })
        assert response.status_code == 201

        # Filter by resource
        response = auth_client.get("/api/v1/audit-logs/?resource=soul")
        assert response.status_code == 200
        for log in response.data["results"]:
            assert "soul" in log["resource"].lower()

    def test_filter_by_date_range(self, auth_client):
        """GET /api/v1/audit-logs/?date_from=&date_to= filters by date range."""
        from datetime import date, timedelta

        today = date.today()
        yesterday = today - timedelta(days=1)
        tomorrow = today + timedelta(days=1)

        # Filter with date range that should include today
        response = auth_client.get(
            f"/api/v1/audit-logs/?date_from={yesterday}&date_to={tomorrow}"
        )
        assert response.status_code == 200
        assert "results" in response.data

    def test_filter_combined(self, auth_client):
        """GET /api/v1/audit-logs/ with combined filters works correctly."""
        from apps.souls.models import Soul

        # Create a soul
        response = auth_client.post("/api/v1/souls/", {
            "name": "Combined Filter Test",
            "birth_date": "1990-01-01",
        })
        assert response.status_code == 201

        # Apply combined filters
        response = auth_client.get(
            "/api/v1/audit-logs/?action=CREATE&resource=soul"
        )
        assert response.status_code == 200
        for log in response.data["results"]:
            assert log["action"] == "CREATE"
            assert "soul" in log["resource"].lower()

    def test_non_admin_cannot_access(self, db, cn_tenant):
        """Non-admin users cannot access /api/v1/audit-logs/ without tenant context."""
        from django.contrib.auth import get_user_model
        from django.test import RequestFactory
        from rest_framework.test import force_authenticate

        User = get_user_model()
        non_admin = User.objects.create_user(
            username="non_admin_user",
            password="test123",
            role="JUDGE",  # Not ADMIN
            tenant=cn_tenant
        )

        # Without tenant context → 403 (TenantPermission enforced)
        factory = RequestFactory()
        request = factory.get("/api/v1/audit-logs/")
        force_authenticate(request, user=non_admin)
        # No request.tenant set — simulates missing middleware context

        from apps.audit.views import AuditLogViewSet
        view = AuditLogViewSet.as_view({"get": "list"})
        response = view(request)
        response.render()
        # TenantPermission denies access when tenant is None for non-ADMIN
        assert response.status_code == 403

    def test_non_admin_with_tenant_can_access(self, db, cn_tenant):
        """Non-admin users with tenant context can access audit logs (tenant-scoped)."""
        from django.contrib.auth import get_user_model
        from django.test import RequestFactory
        from rest_framework.test import force_authenticate

        User = get_user_model()
        non_admin = User.objects.create_user(
            username="non_admin_tenant_user",
            password="test123",
            role="JUDGE",
            tenant=cn_tenant
        )

        factory = RequestFactory()
        request = factory.get("/api/v1/audit-logs/")
        force_authenticate(request, user=non_admin)
        request.tenant = cn_tenant  # Inject tenant context

        from apps.audit.views import AuditLogViewSet
        view = AuditLogViewSet.as_view({"get": "list"})
        response = view(request)
        response.render()
        # Non-admin with tenant context should get 200 (tenant-scoped results)
        assert response.status_code == 200

    def test_unauthenticated_cannot_access(self, api_client):
        """Unauthenticated users cannot access /api/v1/audit-logs/ endpoint."""
        response = api_client.get("/api/v1/audit-logs/")
        assert response.status_code == 401
