"""
Tests for audit log creation across all modules.
Verifies that CRUD operations generate audit logs.

Note: Audit signals use transaction.on_commit() to create logs.
TransactionTestCase allows on_commit callbacks to fire.
"""
import pytest
from django.test import TransactionTestCase
from apps.audit.models import AuditLog, AuditAction
from apps.souls.models import Soul, SoulState
from apps.judgment.models import Judgment, JudgmentMethod
from apps.karma.models import SoulRecord, RecordType
from apps.reincarnation.models import Reincarnation
from apps.dispatch.models import DispatchRecord, DispatchStatus


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

    def test_create_soul_record_no_audit(self):
        """SoulRecord does not inherit AuditUserFields, so no audit log is created.
        This documents the gap — SoulRecord should inherit AuditUserFields."""
        import uuid
        from apps.tenants.models import Tenant
        tenant = Tenant.objects.create(code=f"AUDIT_KARMA_{uuid.uuid4().hex[:8]}", display_name="Audit Karma")
        soul = Soul.objects.create(name="KarmaSoul", tenant=tenant)
        record = SoulRecord.objects.create(
            soul=soul, tenant=tenant,
            record_type=RecordType.MERIT,
            description="Good deed",
            weight=10,
        )
        # SoulRecord does not inherit AuditUserFields — no audit log generated
        audit = AuditLog.objects.filter(resource="soulrecord").first()
        assert audit is None  # Documents the gap


@pytest.mark.django_db(transaction=True)
class TestDispatchAudit(TransactionTestCase):
    """Test audit logs for Dispatch operations."""

    def test_create_dispatch_generates_audit(self):
        """Creating a dispatch should generate an audit log."""
        from apps.tenants.models import Tenant
        cn = Tenant.objects.create(code="AUDIT_CN", display_name="Audit CN")
        eu = Tenant.objects.create(code="AUDIT_EU", display_name="Audit EU")
        soul = Soul.objects.create(name="DispatchSoul", tenant=cn)
        dispatch = DispatchRecord.objects.create(
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
        from apps.tenants.models import Tenant
        from apps.authentication.models import User
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
