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

    # Create a context manager that keeps thread-local set during API calls
    @contextlib.contextmanager
    def set_user_context():
        # Save original state
        old_user = getattr(rl_module._thread_locals, 'user', None)
        old_request = getattr(rl_module._thread_locals, 'request', None)

        # Set user for this context
        rl_module._thread_locals.user = admin_user
        rl_module._thread_locals.request = None

        try:
            yield
        finally:
            # Restore original state
            rl_module._thread_locals.user = old_user
            rl_module._thread_locals.request = old_request

    # Store context manager on the client for use in tests
    api_client.force_authenticate(user=admin_user)
    api_client.set_user_context = set_user_context

    # Also set thread-local at module level for direct model operations
    rl_module._thread_locals.user = admin_user
    rl_module._thread_locals.request = None

    yield api_client

    # Clear thread-local after test
    rl_module._thread_locals.user = None
    rl_module._thread_locals.request = None


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


@pytest.mark.django_db
class TestAuditLogSignals:
    """Test that AuditLog entries are created on model changes."""

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
