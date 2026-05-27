"""
Tests for CodenameViewSetMixin + PermissionMiddleware integration.
"""
import pytest
from django.test import TestCase, RequestFactory
from unittest.mock import patch, MagicMock
from apps.core.viewsets import CodenameViewSetMixin, ACTION_PERM_MAP


class TestCodenameViewSetMixin(TestCase):
    """Unit tests for CodenameViewSetMixin.get_required_permissions()."""

    def _make_viewset(self, permission_codename=None, extra_permissions=None, action=None):
        """Helper to create a viewset instance with given config."""
        vs = CodenameViewSetMixin()
        vs.permission_codename = permission_codename
        vs.extra_permissions = extra_permissions or {}
        vs.action = action
        return vs

    def test_standard_list_action(self):
        vs = self._make_viewset("soul", action="list")
        self.assertEqual(vs.get_required_permissions(), ["soul.read"])

    def test_standard_create_action(self):
        vs = self._make_viewset("judgment", action="create")
        self.assertEqual(vs.get_required_permissions(), ["judgment.create"])

    def test_standard_update_action(self):
        vs = self._make_viewset("soul", action="update")
        self.assertEqual(vs.get_required_permissions(), ["soul.update"])

    def test_standard_partial_update_action(self):
        vs = self._make_viewset("soul", action="partial_update")
        self.assertEqual(vs.get_required_permissions(), ["soul.update"])

    def test_standard_destroy_action(self):
        vs = self._make_viewset("soul", action="destroy")
        self.assertEqual(vs.get_required_permissions(), ["soul.delete"])

    def test_standard_retrieve_action(self):
        vs = self._make_viewset("soul", action="retrieve")
        self.assertEqual(vs.get_required_permissions(), ["soul.read"])

    def test_extra_permissions_override(self):
        extra = {"die": ["soul.die"], "karma": ["soul.read"]}
        vs = self._make_viewset("soul", extra_permissions=extra, action="die")
        self.assertEqual(vs.get_required_permissions(), ["soul.die"])

    def test_extra_permissions_multiple_codenames(self):
        extra = {"conclude": ["judgment.execute", "judgment.write"]}
        vs = self._make_viewset("judgment", extra_permissions=extra, action="conclude")
        self.assertEqual(vs.get_required_permissions(), ["judgment.execute", "judgment.write"])

    def test_unknown_action_generates_codename(self):
        vs = self._make_viewset("soul", action="custom_action")
        self.assertEqual(vs.get_required_permissions(), ["soul.custom_action"])

    def test_no_permission_codename_returns_empty(self):
        vs = self._make_viewset(None, action="list")
        self.assertEqual(vs.get_required_permissions(), [])

    def test_no_action_returns_empty(self):
        vs = self._make_viewset("soul", action=None)
        self.assertEqual(vs.get_required_permissions(), [])


class TestPermissionMiddlewareFallback(TestCase):
    """Integration test: PermissionMiddleware calls get_required_permissions() when _required_permissions is absent."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_middleware_calls_get_required_permissions(self):
        """Middleware should call view.get_required_permissions() when _required_permissions is not set."""
        from apps.core.middleware import PermissionMiddleware

        # Mock view with get_required_permissions but no _required_permissions
        mock_view = MagicMock(spec=CodenameViewSetMixin)
        mock_view._required_permissions = None
        mock_view.get_required_permissions.return_value = ["soul.read"]

        # Mock user with role
        mock_user = MagicMock()
        mock_user.is_authenticated = True
        mock_user.role = "JUDGE"

        request = self.factory.get("/api/v1/souls/")
        request.user = mock_user
        request.view = mock_view

        middleware = PermissionMiddleware(lambda r: MagicMock(status_code=200))

        with patch.object(middleware, '_has_permission', return_value=True):
            response = middleware(request)

        # get_required_permissions should have been called
        mock_view.get_required_permissions.assert_called_once()

    def test_middleware_skips_when_both_absent(self):
        """Middleware passes through when neither _required_permissions nor get_required_permissions exist."""
        from apps.core.middleware import PermissionMiddleware

        mock_view = MagicMock()
        mock_view._required_permissions = None
        # No get_required_permissions method
        del mock_view.get_required_permissions

        mock_user = MagicMock()
        mock_user.is_authenticated = True
        mock_user.role = "JUDGE"

        request = self.factory.get("/api/v1/souls/")
        request.user = mock_user
        request.view = mock_view

        mock_response = MagicMock(status_code=200)
        middleware = PermissionMiddleware(lambda r: mock_response)
        response = middleware(request)
        self.assertEqual(response.status_code, 200)


class TestSoulViewSetCodename(TestCase):
    """Verify SoulViewSet has correct codename config."""

    def test_soul_viewset_has_codename(self):
        from apps.souls.views import SoulViewSet
        self.assertEqual(SoulViewSet.permission_codename, "soul")

    def test_soul_viewset_extra_permissions(self):
        from apps.souls.views import SoulViewSet
        self.assertIn("die", SoulViewSet.extra_permissions)
        self.assertEqual(SoulViewSet.extra_permissions["die"], ["soul.die"])
        self.assertIn("karma", SoulViewSet.extra_permissions)
        self.assertEqual(SoulViewSet.extra_permissions["karma"], ["soul.read"])

    def test_soul_viewset_inherits_mixin(self):
        from apps.souls.views import SoulViewSet
        self.assertTrue(issubclass(SoulViewSet, CodenameViewSetMixin))


class TestJudgmentViewSetCodename(TestCase):
    """Verify JudgmentViewSet has correct codename config."""

    def test_judgment_viewset_has_codename(self):
        from apps.judgment.views import JudgmentViewSet
        self.assertEqual(JudgmentViewSet.permission_codename, "judgment")

    def test_judgment_viewset_extra_permissions(self):
        from apps.judgment.views import JudgmentViewSet
        self.assertIn("conclude", JudgmentViewSet.extra_permissions)
        self.assertEqual(JudgmentViewSet.extra_permissions["conclude"], ["judgment.execute"])

    def test_judgment_viewset_inherits_mixin(self):
        from apps.judgment.views import JudgmentViewSet
        self.assertTrue(issubclass(JudgmentViewSet, CodenameViewSetMixin))


class TestDispositionViewSetCodename(TestCase):
    def test_disposition_viewset_has_codename(self):
        from apps.disposition.views import DispositionViewSet
        self.assertEqual(DispositionViewSet.permission_codename, "disposition")

    def test_disposition_viewset_extra_permissions(self):
        from apps.disposition.views import DispositionViewSet
        self.assertIn("execute", DispositionViewSet.extra_permissions)
        self.assertEqual(DispositionViewSet.extra_permissions["execute"], ["disposition.execute"])

    def test_disposition_viewset_inherits_mixin(self):
        from apps.disposition.views import DispositionViewSet
        self.assertTrue(issubclass(DispositionViewSet, CodenameViewSetMixin))


class TestReincarnationViewSetCodename(TestCase):
    def test_reincarnation_viewset_has_codename(self):
        from apps.reincarnation.views import ReincarnationViewSet
        self.assertEqual(ReincarnationViewSet.permission_codename, "reincarnation")

    def test_reincarnation_viewset_extra_permissions(self):
        from apps.reincarnation.views import ReincarnationViewSet
        self.assertIn("complete", ReincarnationViewSet.extra_permissions)
        self.assertEqual(ReincarnationViewSet.extra_permissions["complete"], ["reincarnation.complete"])
        self.assertIn("reborn", ReincarnationViewSet.extra_permissions)
        self.assertEqual(ReincarnationViewSet.extra_permissions["reborn"], ["reincarnation.reborn"])

    def test_reincarnation_viewset_inherits_mixin(self):
        from apps.reincarnation.views import ReincarnationViewSet
        self.assertTrue(issubclass(ReincarnationViewSet, CodenameViewSetMixin))


class TestDispatchRecordViewSetCodename(TestCase):
    def test_dispatch_record_viewset_has_codename(self):
        from apps.dispatch.views import DispatchRecordViewSet
        self.assertEqual(DispatchRecordViewSet.permission_codename, "dispatch")

    def test_dispatch_record_viewset_extra_permissions(self):
        from apps.dispatch.views import DispatchRecordViewSet
        self.assertIn("approve", DispatchRecordViewSet.extra_permissions)
        self.assertEqual(DispatchRecordViewSet.extra_permissions["approve"], ["dispatch.approve"])
        self.assertIn("reject", DispatchRecordViewSet.extra_permissions)
        self.assertEqual(DispatchRecordViewSet.extra_permissions["reject"], ["dispatch.reject"])
        self.assertIn("execute", DispatchRecordViewSet.extra_permissions)
        self.assertEqual(DispatchRecordViewSet.extra_permissions["execute"], ["dispatch.execute"])

    def test_dispatch_record_viewset_inherits_mixin(self):
        from apps.dispatch.views import DispatchRecordViewSet
        self.assertTrue(issubclass(DispatchRecordViewSet, CodenameViewSetMixin))


class TestCrossTenantJudgmentViewSetCodename(TestCase):
    def test_cross_tenant_viewset_has_codename(self):
        from apps.dispatch.views import CrossTenantJudgmentViewSet
        self.assertEqual(CrossTenantJudgmentViewSet.permission_codename, "dispatch")

    def test_cross_tenant_viewset_extra_permissions(self):
        from apps.dispatch.views import CrossTenantJudgmentViewSet
        self.assertIn("participate", CrossTenantJudgmentViewSet.extra_permissions)
        self.assertEqual(CrossTenantJudgmentViewSet.extra_permissions["participate"], ["dispatch.participate"])
        self.assertIn("conclude", CrossTenantJudgmentViewSet.extra_permissions)
        self.assertEqual(CrossTenantJudgmentViewSet.extra_permissions["conclude"], ["dispatch.conclude"])

    def test_cross_tenant_viewset_inherits_mixin(self):
        from apps.dispatch.views import CrossTenantJudgmentViewSet
        self.assertTrue(issubclass(CrossTenantJudgmentViewSet, CodenameViewSetMixin))


class TestWorkflowViewSetsCodename(TestCase):
    def test_workflow_template_has_codename(self):
        from apps.workflow.views import WorkflowTemplateViewSet
        self.assertEqual(WorkflowTemplateViewSet.permission_codename, "workflow")
        self.assertTrue(issubclass(WorkflowTemplateViewSet, CodenameViewSetMixin))

    def test_approval_workflow_has_codename(self):
        from apps.workflow.views import ApprovalWorkflowViewSet
        self.assertEqual(ApprovalWorkflowViewSet.permission_codename, "workflow")
        self.assertTrue(issubclass(ApprovalWorkflowViewSet, CodenameViewSetMixin))

    def test_approval_workflow_extra_permissions(self):
        from apps.workflow.views import ApprovalWorkflowViewSet
        self.assertIn("advance", ApprovalWorkflowViewSet.extra_permissions)
        self.assertEqual(ApprovalWorkflowViewSet.extra_permissions["advance"], ["workflow.advance"])
        self.assertIn("approve_node", ApprovalWorkflowViewSet.extra_permissions)
        self.assertEqual(ApprovalWorkflowViewSet.extra_permissions["approve_node"], ["workflow.approve"])
        self.assertIn("create_from_judgment", ApprovalWorkflowViewSet.extra_permissions)
        self.assertEqual(ApprovalWorkflowViewSet.extra_permissions["create_from_judgment"], ["workflow.create"])

    def test_approval_node_has_codename(self):
        from apps.workflow.views import ApprovalNodeViewSet
        self.assertEqual(ApprovalNodeViewSet.permission_codename, "workflow")
        self.assertTrue(issubclass(ApprovalNodeViewSet, CodenameViewSetMixin))


class TestAuditLogViewSetCodename(TestCase):
    def test_audit_log_viewset_has_codename(self):
        from apps.audit.views import AuditLogViewSet
        self.assertEqual(AuditLogViewSet.permission_codename, "audit_log")

    def test_audit_log_viewset_extra_permissions(self):
        from apps.audit.views import AuditLogViewSet
        self.assertIn("actions", AuditLogViewSet.extra_permissions)
        self.assertEqual(AuditLogViewSet.extra_permissions["actions"], ["audit_log.read"])
        self.assertIn("resources", AuditLogViewSet.extra_permissions)
        self.assertEqual(AuditLogViewSet.extra_permissions["resources"], ["audit_log.read"])
        self.assertIn("stats", AuditLogViewSet.extra_permissions)
        self.assertEqual(AuditLogViewSet.extra_permissions["stats"], ["audit_log.read"])

    def test_audit_log_viewset_inherits_mixin(self):
        from apps.audit.views import AuditLogViewSet
        self.assertTrue(issubclass(AuditLogViewSet, CodenameViewSetMixin))


class TestNotificationViewSetCodename(TestCase):
    def test_notification_viewset_has_codename(self):
        from apps.notifications.views import NotificationViewSet
        self.assertEqual(NotificationViewSet.permission_codename, "notification")

    def test_notification_viewset_extra_permissions(self):
        from apps.notifications.views import NotificationViewSet
        self.assertIn("mark_read", NotificationViewSet.extra_permissions)
        self.assertEqual(NotificationViewSet.extra_permissions["mark_read"], ["notification.update"])
        self.assertIn("mark_all_read", NotificationViewSet.extra_permissions)
        self.assertEqual(NotificationViewSet.extra_permissions["mark_all_read"], ["notification.update"])

    def test_notification_viewset_inherits_mixin(self):
        from apps.notifications.views import NotificationViewSet
        self.assertTrue(issubclass(NotificationViewSet, CodenameViewSetMixin))


class TestUserViewSetCodename(TestCase):
    def test_user_viewset_has_codename(self):
        from apps.authentication.views import UserViewSet
        self.assertEqual(UserViewSet.permission_codename, "user")

    def test_user_viewset_extra_permissions(self):
        from apps.authentication.views import UserViewSet
        self.assertIn("activate", UserViewSet.extra_permissions)
        self.assertEqual(UserViewSet.extra_permissions["activate"], ["user.activate"])
        self.assertIn("deactivate", UserViewSet.extra_permissions)
        self.assertEqual(UserViewSet.extra_permissions["deactivate"], ["user.deactivate"])
        self.assertIn("reset_password", UserViewSet.extra_permissions)
        self.assertEqual(UserViewSet.extra_permissions["reset_password"], ["user.reset_password"])
        self.assertIn("batch_activate", UserViewSet.extra_permissions)
        self.assertEqual(UserViewSet.extra_permissions["batch_activate"], ["user.activate"])
        self.assertIn("batch_deactivate", UserViewSet.extra_permissions)
        self.assertEqual(UserViewSet.extra_permissions["batch_deactivate"], ["user.deactivate"])
        self.assertIn("own_roles", UserViewSet.extra_permissions)
        self.assertEqual(UserViewSet.extra_permissions["own_roles"], ["user.read"])
        self.assertIn("assign_roles", UserViewSet.extra_permissions)
        self.assertEqual(UserViewSet.extra_permissions["assign_roles"], ["user.assign_roles"])
        self.assertIn("export_csv", UserViewSet.extra_permissions)
        self.assertEqual(UserViewSet.extra_permissions["export_csv"], ["user.read"])
        self.assertIn("import_csv", UserViewSet.extra_permissions)
        self.assertEqual(UserViewSet.extra_permissions["import_csv"], ["user.create"])

    def test_user_viewset_inherits_mixin(self):
        from apps.authentication.views import UserViewSet
        self.assertTrue(issubclass(UserViewSet, CodenameViewSetMixin))


class TestHasPermissionFallback(TestCase):
    """Verify _has_permission fallback to ROLE_PERMISSIONS dict when codename not in DB."""

    def setUp(self):
        from apps.core.middleware import PermissionMiddleware
        self.middleware = PermissionMiddleware(lambda r: MagicMock(status_code=200))

    def test_fallback_to_dict_when_permission_not_in_db(self):
        """When Permission object doesn't exist, fall back to ROLE_PERMISSIONS dict."""
        from apps.perm.models import Permission
        # Ensure codename does NOT exist in DB
        Permission.objects.filter(codename="soul.die").delete()

        # JUDGE has "soul.read" in ROLE_PERMISSIONS but not "soul.die"
        result = self.middleware._has_permission("JUDGE", "soul.die")
        self.assertFalse(result)

    def test_granted_when_in_dict_and_not_in_db(self):
        """When Permission not in DB but ROLE_PERMISSIONS dict grants it, should grant."""
        from apps.perm.models import Permission
        from apps.core.middleware import ROLE_PERMISSIONS
        # Ensure codename does NOT exist in DB
        Permission.objects.filter(codename="soul.read").delete()

        # ADMIN has "soul.read" in ROLE_PERMISSIONS
        result = self.middleware._has_permission("ADMIN", "soul.read")
        self.assertTrue(result)

    def test_db_takes_priority_over_dict(self):
        """When Permission + RolePermission exist in DB, DB result is authoritative."""
        from apps.perm.models import Permission, Role, RolePermission

        # Ensure codename exists in DB
        perm, _ = Permission.objects.get_or_create(
            codename="soul.read", defaults={"name": "Read Soul", "category": "soul"}
        )
        role, _ = Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})

        # Grant via RolePermission
        RolePermission.objects.get_or_create(role=role, permission=perm)

        # Even if ROLE_PERMISSIONS dict doesn't have it for this role, DB grants it
        result = self.middleware._has_permission("JUDGE", "soul.read")
        self.assertTrue(result)

    def test_admin_bypass_in_middleware_call(self):
        """ADMIN role bypasses all permission checks in __call__."""
        from apps.core.middleware import PermissionMiddleware

        mock_user = MagicMock()
        mock_user.is_authenticated = True
        mock_user.role = "ADMIN"

        factory = RequestFactory()
        request = factory.get("/api/v1/souls/")
        request.user = mock_user
        request.view = MagicMock()
        request.view._required_permissions = ["nonexistent.perm"]
        request.view.get_required_permissions = MagicMock(return_value=["nonexistent.perm"])

        mock_response = MagicMock(status_code=200)
        middleware = PermissionMiddleware(lambda r: mock_response)
        response = middleware(request)
        # ADMIN bypasses — response should be 200, not 403
        self.assertEqual(response.status_code, 200)

    def test_dict_fallback_for_unseeded_codename(self):
        """Codename generated by CodenameViewSetMixin but not seeded in DB falls back to dict."""
        from apps.perm.models import Permission
        # "soul.create" is in ROLE_PERMISSIONS for ADMIN
        Permission.objects.filter(codename="soul.create").delete()

        result = self.middleware._has_permission("ADMIN", "soul.create")
        self.assertTrue(result)

        # "soul.create" is NOT in ROLE_PERMISSIONS for VIEWER
        result = self.middleware._has_permission("VIEWER", "soul.create")
        self.assertFalse(result)


class TestMenuViewSetCodename(TestCase):
    def test_menu_viewset_has_codename(self):
        from apps.menus.views import MenuViewSet
        self.assertEqual(MenuViewSet.permission_codename, "menu")

    def test_menu_viewset_extra_permissions(self):
        from apps.menus.views import MenuViewSet
        self.assertIn("all", MenuViewSet.extra_permissions)
        self.assertEqual(MenuViewSet.extra_permissions["all"], ["menu.read"])
        self.assertIn("create_menu", MenuViewSet.extra_permissions)
        self.assertEqual(MenuViewSet.extra_permissions["create_menu"], ["menu.create"])

    def test_menu_viewset_inherits_mixin(self):
        from apps.menus.views import MenuViewSet
        self.assertTrue(issubclass(MenuViewSet, CodenameViewSetMixin))
