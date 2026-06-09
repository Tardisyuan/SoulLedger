"""
Tests for audit app - AuditLog views.
Uses JWT auth with tenant_code so TenantMiddleware sets request.tenant.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditAction, AuditLog
from apps.tenants.models import Tenant

User = get_user_model()
BASE = "/api/v1/audit-logs"


def _jwt_client(user, tenant):
    """Return APIClient authenticated via JWT with tenant_code claim."""
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
class TestAuditLogModel:
    """AuditLog model basics."""

    def test_audit_log_str(self):
        tenant = Tenant.objects.create(code="AUD_M", display_name="Audit Model T")
        user = User.objects.create_user(username="aud_m_user", password="test123", role="ADMIN", tenant=tenant)
        log = AuditLog.objects.create(
            tenant=tenant, user=user, action=AuditAction.CREATE,
            resource="soul", resource_id="123", description="Created a soul"
        )
        assert "CREATE" in str(log)
        assert "soul" in str(log)


@pytest.mark.django_db
class TestAuditLogListRetrieve:
    """AuditLog list and retrieve endpoints."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="AUD_T1", defaults={"display_name": "Audit Test Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="aud_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.viewer = User.objects.create_user(
            username="aud_viewer", password="test123", role="VIEWER", tenant=self.tenant
        )
        self.admin_client = _jwt_client(self.admin, self.tenant)
        self.viewer_client = _jwt_client(self.viewer, self.tenant)
        self.log1 = AuditLog.objects.create(
            tenant=self.tenant, user=self.admin, action=AuditAction.CREATE,
            resource="soul", description="Test log 1"
        )
        self.log2 = AuditLog.objects.create(
            tenant=self.tenant, user=self.admin, action=AuditAction.UPDATE,
            resource="judgment", description="Test log 2"
        )

    def test_list_audit_logs_admin(self):
        resp = self.admin_client.get(f"{BASE}/")
        assert resp.status_code == status.HTTP_200_OK

    def test_list_audit_logs_unauthenticated(self):
        resp = APIClient().get(f"{BASE}/")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    def test_retrieve_audit_log(self):
        resp = self.admin_client.get(f"{BASE}/{self.log1.pk}/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["resource"] == "soul"

    def test_retrieve_not_found(self):
        resp = self.admin_client.get(f"{BASE}/99999/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_filter_by_resource(self):
        resp = self.admin_client.get(f"{BASE}/", {"resource": "soul"})
        assert resp.status_code == status.HTTP_200_OK

    def test_filter_by_action(self):
        resp = self.admin_client.get(f"{BASE}/", {"action": "CREATE"})
        assert resp.status_code == status.HTTP_200_OK

    def test_filter_by_user_id(self):
        resp = self.admin_client.get(f"{BASE}/", {"user_id": self.admin.pk})
        assert resp.status_code == status.HTTP_200_OK


@pytest.mark.django_db
class TestAuditLogActions:
    """AuditLog custom actions: actions, resources, stats, timeline, by_trace."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="AUD_T2", defaults={"display_name": "Audit Actions Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="audact_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.admin_client = _jwt_client(self.admin, self.tenant)
        AuditLog.objects.create(
            tenant=self.tenant, user=self.admin, action=AuditAction.CREATE,
            resource="soul", description="log a", trace_id="trace-abc"
        )
        AuditLog.objects.create(
            tenant=self.tenant, user=self.admin, action=AuditAction.UPDATE,
            resource="soul", description="log b", trace_id="trace-abc"
        )
        AuditLog.objects.create(
            tenant=self.tenant, user=self.admin, action=AuditAction.DELETE,
            resource="judgment", description="log c", trace_id="trace-other"
        )

    def test_actions_endpoint(self):
        resp = self.admin_client.get(f"{BASE}/actions/")
        assert resp.status_code == status.HTTP_200_OK
        assert isinstance(resp.data, list)
        assert any(a["value"] == "CREATE" for a in resp.data)

    def test_resources_endpoint(self):
        resp = self.admin_client.get(f"{BASE}/resources/")
        assert resp.status_code == status.HTTP_200_OK
        assert "soul" in resp.data
        assert "judgment" in resp.data

    def test_stats_endpoint(self):
        resp = self.admin_client.get(f"{BASE}/stats/")
        assert resp.status_code == status.HTTP_200_OK
        assert "action_distribution" in resp.data
        assert "total_logs" in resp.data

    def test_timeline_endpoint(self):
        resp = self.admin_client.get(f"{BASE}/timeline/")
        assert resp.status_code == status.HTTP_200_OK

    def test_timeline_with_resource_filter(self):
        resp = self.admin_client.get(f"{BASE}/timeline/", {"resource": "soul"})
        assert resp.status_code == status.HTTP_200_OK

    def test_by_trace_endpoint(self):
        resp = self.admin_client.get(f"{BASE}/trace/trace-abc/")
        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) == 2

    def test_by_trace_not_found(self):
        resp = self.admin_client.get(f"{BASE}/trace/nonexistent/")
        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) == 0
