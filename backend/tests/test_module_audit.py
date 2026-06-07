"""
Tests for audit log creation across all modules.
Verifies that CRUD operations generate audit logs.

Note: Audit signals use transaction.on_commit() to create logs.
TransactionTestCase allows on_commit callbacks to fire.
"""
import pytest
from django.test import TransactionTestCase

from apps.audit.models import AuditAction, AuditLog
from apps.dispatch.models import DispatchRecord
from apps.judgment.models import Judgment, JudgmentMethod
from apps.karma.models import RecordType, SoulRecord
from apps.souls.models import Soul


@pytest.mark.django_db(transaction=True)
class TestSoulAudit(TransactionTestCase):
    """Test audit logs for Soul operations."""

    def test_create_soul_generates_audit(self):
        """Creating a soul should generate an audit log."""
        from apps.tenants.models import Tenant
        tenant = Tenant.objects.create(code="AUDIT_TEST", display_name="Audit Test")
        soul = Soul.objects.create(name="AuditSoul", tenant=tenant)
        audit = AuditLog.objects.filter(
            resource="soul",
            action=AuditAction.CREATE,
            resource_id=str(soul.id),
        ).first()
        assert audit is not None

    def test_update_soul_generates_audit(self):
        """Updating a soul should generate an audit log."""
        from apps.tenants.models import Tenant
        tenant = Tenant.objects.create(code="AUDIT_TEST2", display_name="Audit Test 2")
        soul = Soul.objects.create(name="AuditSoul", tenant=tenant)
        soul.name = "UpdatedSoul"
        soul.save()
        audit = AuditLog.objects.filter(
            resource="soul",
            action=AuditAction.UPDATE,
            resource_id=str(soul.id),
        ).first()
        assert audit is not None


@pytest.mark.django_db(transaction=True)
class TestJudgmentAudit(TransactionTestCase):
    """Test audit logs for Judgment operations."""

    def test_create_judgment_generates_audit(self):
        """Creating a judgment should generate an audit log."""
        from apps.tenants.models import Tenant
        tenant = Tenant.objects.create(code="AUDIT_JUDG", display_name="Audit Judgment")
        soul = Soul.objects.create(name="JudgSoul", tenant=tenant)
        judgment = Judgment.objects.create(
            soul=soul, tenant=tenant,
            civilization="CHINESE",
            judgment_method=JudgmentMethod.STANDARD,
        )
        audit = AuditLog.objects.filter(
            resource="judgment",
            action=AuditAction.CREATE,
            resource_id=str(judgment.id),
        ).first()
        assert audit is not None


@pytest.mark.django_db(transaction=True)
class TestKarmaAudit(TransactionTestCase):
    """Test audit logs for Karma operations."""

    def test_create_soul_record_generates_audit(self):
        """SoulRecord now inherits AuditUserFields, so audit log IS created."""
        import uuid

        from apps.tenants.models import Tenant
        tenant = Tenant.objects.create(code=f"AUDIT_KARMA_{uuid.uuid4().hex[:8]}", display_name="Audit Karma")
        soul = Soul.objects.create(name="KarmaSoul", tenant=tenant)
        SoulRecord.objects.create(
            soul=soul, tenant=tenant,
            record_type=RecordType.MERIT,
            description="Good deed",
            weight=10,
        )
        audit = AuditLog.objects.filter(
            resource="soulrecord",
            action=AuditAction.CREATE,
        ).first()
        assert audit is not None


@pytest.mark.django_db(transaction=True)
class TestDispatchAudit(TransactionTestCase):
    """Test audit logs for Dispatch operations."""

    def test_create_dispatch_generates_audit(self):
        """Creating a dispatch should generate an audit log."""
        from apps.tenants.models import Tenant
        cn = Tenant.objects.create(code="AUDIT_CN", display_name="Audit CN")
        eu = Tenant.objects.create(code="AUDIT_EU", display_name="Audit EU")
        soul = Soul.objects.create(name="DispatchSoul", tenant=cn)
        DispatchRecord.objects.create(
            source_tenant=cn,
            target_tenant=eu,
            soul=soul,
            reason="Test dispatch",
            tenant=cn,
        )
        audit = AuditLog.objects.filter(
            resource="dispatchrecord",
            action=AuditAction.CREATE,
        ).first()
        assert audit is not None


@pytest.mark.django_db(transaction=True)
class TestUserAudit(TransactionTestCase):
    """Test audit logs for User operations."""

    def test_create_user_generates_audit(self):
        """Creating a user should generate an audit log."""
        from apps.authentication.models import User
        from apps.tenants.models import Tenant
        tenant = Tenant.objects.create(code="AUDIT_USER", display_name="Audit User")
        user = User.objects.create_user(
            username="audituser", password="test123",
            role="VIEWER", tenant=tenant,
        )
        audit = AuditLog.objects.filter(
            resource="user",
            action=AuditAction.CREATE,
            resource_id=str(user.id),
        ).first()
        assert audit is not None


@pytest.mark.django_db(transaction=True)
class TestMenuAudit(TransactionTestCase):
    """Test audit logs for Menu operations."""

    def test_create_menu_generates_audit(self):
        """Creating a menu should generate an audit log."""
        from apps.menus.models import Menu
        menu = Menu.objects.create(name="Audit Menu", path="/audit-menu", order=1)
        audit = AuditLog.objects.filter(
            resource="menu",
            action=AuditAction.CREATE,
            resource_id=str(menu.id),
        ).first()
        assert audit is not None


@pytest.mark.django_db(transaction=True)
class TestWorkflowAudit(TransactionTestCase):
    """Test audit logs for Workflow operations."""

    def test_create_workflow_template_generates_audit(self):
        """Creating a workflow template should generate an audit log."""
        from apps.workflow.models import WorkflowTemplate
        template = WorkflowTemplate.objects.create(
            name="Audit Workflow",
            civilization="CHINESE",
            case_type="ROUTINE",
        )
        audit = AuditLog.objects.filter(
            resource="workflowtemplate",
            action=AuditAction.CREATE,
            resource_id=str(template.id),
        ).first()
        assert audit is not None


@pytest.mark.django_db(transaction=True)
class TestTenantAudit(TransactionTestCase):
    """Test audit logs for Tenant operations."""

    def test_create_tenant_generates_audit(self):
        """Creating a tenant should generate an audit log."""
        from apps.tenants.models import Tenant
        tenant = Tenant.objects.create(code="AUDIT_TENANT", display_name="Audit Tenant")
        audit = AuditLog.objects.filter(
            resource="tenant",
            action=AuditAction.CREATE,
            resource_id=str(tenant.id),
        ).first()
        assert audit is not None


@pytest.mark.django_db(transaction=True)
class TestNotificationAudit(TransactionTestCase):
    """Test audit logs for Notification operations."""

    def test_create_notification_generates_audit(self):
        """Creating a notification should generate an audit log."""
        from apps.authentication.models import User
        from apps.notifications.models import NotificationType, UserNotification
        from apps.tenants.models import Tenant
        tenant = Tenant.objects.create(code="AUDIT_NOTIF", display_name="Audit Notif")
        user = User.objects.create_user(
            username="notifuser", password="test123",
            role="VIEWER", tenant=tenant,
        )
        UserNotification.objects.create(
            user=user,
            title="Test Notification",
            message="Test message",
            notification_type=NotificationType.SYSTEM,
        )
        audit = AuditLog.objects.filter(
            resource="usernotification",
            action=AuditAction.CREATE,
        ).first()
        assert audit is not None
