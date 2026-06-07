"""
Tests for audit app - Audit logging
"""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

User = get_user_model()


class AuditLogModelTest(TestCase):
    """Test AuditLog model"""

    def test_audit_log_str(self):
        from apps.audit.models import AuditAction, AuditLog
        from apps.tenants.models import Tenant

        tenant = Tenant.objects.create(code="TEST", display_name="Test")
        user = User.objects.create_user(
            username="testuser",
            password="test123",
            role="ADMIN",
            tenant=tenant
        )
        log = AuditLog.objects.create(
            tenant=tenant,
            user=user,
            action=AuditAction.CREATE,
            resource="soul",
            resource_id="123",
            description="Created a soul"
        )
        self.assertIn("CREATE", str(log))
        self.assertIn("soul", str(log))


class AuditLogAPITest(TestCase):
    """Test AuditLog API endpoints"""

    def setUp(self):
        self.client = APIClient()
        from apps.tenants.models import Tenant

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
        # 创建测试审计日志
        from apps.audit.models import AuditAction, AuditLog

        AuditLog.objects.create(
            tenant=self.tenant,
            user=self.admin_user,
            action=AuditAction.CREATE,
            resource="soul",
            description="Test log"
        )

    def test_list_audit_logs_admin(self):
        """Admin can list audit logs"""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.get("/api/v1/audit-logs/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_list_audit_logs_non_admin(self):
        """Non-admin cannot list audit logs"""
        self.client.force_authenticate(user=self.viewer_user)
        response = self.client.get("/api/v1/audit-logs/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_list_audit_logs_unauthenticated(self):
        """Unauthenticated user cannot list audit logs"""
        response = self.client.get("/api/v1/audit-logs/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_filter_audit_logs_by_resource(self):
        """Can filter audit logs by resource"""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.get("/api/v1/audit-logs/", {"resource": "soul"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
