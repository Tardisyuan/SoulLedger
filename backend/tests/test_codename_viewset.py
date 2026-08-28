"""
Tests for CodenameViewSetMixin and the permission checker it feeds.
"""
from django.test import TestCase

from apps.core.viewsets import CodenameViewSetMixin


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


# TestPermissionMiddlewareFallback 曾经在这里,2026-08-28 删除。
# 它做 `request.view = mock_view` 之后断言中间件读到了 `get_required_permissions()`。
# Django 从不设置 `request.view`(实测:真实认证请求里 `hasattr(request, "view")`
# 每次都是 False),所以那两个测试亲手制造了生产环境永远不存在的前提,然后证明了
# 前提之后的分支可以工作。分支本身已随 `apps/core/middleware.py` 的改写一起删除。
# 现在钉住事实本身的是 tests/test_request_context_middleware.py。


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
        """Moved off `dispatch` onto its own family — a decision, not a rename.

        Cross-tenant judgment is a judgment activity, not an operational
        dispatch one: the same civilization that hears a soul's own case now
        hears its cross-tenant one. See apps/dispatch/views.py.
        """
        from apps.dispatch.views import CrossTenantJudgmentViewSet
        self.assertEqual(CrossTenantJudgmentViewSet.permission_codename, "cross_judgment")

    def test_cross_tenant_viewset_extra_permissions(self):
        """participate/conclude fold into cross_judgment.create — see the viewset.

        There is no cross_judgment.update/delete/participate/conclude, only
        read/create, so every write action maps to create — the same shape
        DispatchRecordViewSet uses for dispatch.manage.
        """
        from apps.dispatch.views import CrossTenantJudgmentViewSet
        self.assertIn("participate", CrossTenantJudgmentViewSet.extra_permissions)
        self.assertEqual(CrossTenantJudgmentViewSet.extra_permissions["participate"], ["cross_judgment.create"])
        self.assertIn("conclude", CrossTenantJudgmentViewSet.extra_permissions)
        self.assertEqual(CrossTenantJudgmentViewSet.extra_permissions["conclude"], ["cross_judgment.create"])

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
        self.assertEqual(AuditLogViewSet.permission_codename, "audit")

    def test_audit_log_viewset_extra_permissions(self):
        from apps.audit.views import AuditLogViewSet
        self.assertIn("actions", AuditLogViewSet.extra_permissions)
        self.assertEqual(AuditLogViewSet.extra_permissions["actions"], ["audit.read"])
        self.assertIn("resources", AuditLogViewSet.extra_permissions)
        self.assertEqual(AuditLogViewSet.extra_permissions["resources"], ["audit.read"])
        self.assertIn("stats", AuditLogViewSet.extra_permissions)
        self.assertEqual(AuditLogViewSet.extra_permissions["stats"], ["audit.read"])

    def test_audit_log_viewset_inherits_mixin(self):
        from apps.audit.views import AuditLogViewSet
        self.assertTrue(issubclass(AuditLogViewSet, CodenameViewSetMixin))


class TestNotificationViewSetCodename(TestCase):
    def test_notification_viewset_has_codename(self):
        from apps.notifications.views import NotificationViewSet
        self.assertEqual(NotificationViewSet.permission_codename, "notification")

    def test_notification_viewset_extra_permissions(self):
        """Binary on notification.read — see the comment on the viewset.

        These used to assert `notification.update`, a codename that is in
        neither DEFAULT_PERMISSIONS nor any role's list, so mark_read was
        gated on something that could only ever answer no.
        """
        from apps.notifications.views import NotificationViewSet
        self.assertIn("mark_read", NotificationViewSet.extra_permissions)
        self.assertEqual(NotificationViewSet.extra_permissions["mark_read"], ["notification.read"])
        self.assertIn("mark_all_read", NotificationViewSet.extra_permissions)
        self.assertEqual(NotificationViewSet.extra_permissions["mark_all_read"], ["notification.read"])

    def test_notification_viewset_inherits_mixin(self):
        from apps.notifications.views import NotificationViewSet
        self.assertTrue(issubclass(NotificationViewSet, CodenameViewSetMixin))


class TestUserViewSetCodename(TestCase):
    def test_user_viewset_has_codename(self):
        from apps.authentication.views import UserViewSet
        self.assertEqual(UserViewSet.permission_codename, "user")

    def test_user_viewset_extra_permissions(self):
        """Every action maps to user.manage — see the comment on the viewset.

        These used to assert a user.activate / user.deactivate /
        user.reset_password / user.read / user.create / user.assign_roles
        family. None of those six codenames exists in DEFAULT_PERMISSIONS or
        is held by any role; `user.manage` is the only user codename there is,
        and IsAdminPermission already makes this viewset ADMIN-only for reads
        and writes alike.
        """
        from apps.authentication.views import UserViewSet
        for action in (
            "list", "retrieve", "create", "update", "partial_update", "destroy",
            "activate", "deactivate", "reset_password",
            "batch_activate", "batch_deactivate",
            "own_roles", "assign_roles", "export_csv", "import_csv",
        ):
            self.assertIn(action, UserViewSet.extra_permissions)
            self.assertEqual(UserViewSet.extra_permissions[action], ["user.manage"])

    def test_user_viewset_inherits_mixin(self):
        from apps.authentication.views import UserViewSet
        self.assertTrue(issubclass(UserViewSet, CodenameViewSetMixin))


class TestHasPermissionFallback(TestCase):
    """DB 优先于 ROLE_PERMISSIONS 字典回退。

    这些断言原先走 `PermissionMiddleware._has_permission`,而那个方法只是把参数
    包成一个假 user 转发给 `apps.perm.checker.check_permission`。中间件那条路径
    2026-08-28 删除(它从来不可达),断言直接指向真正做判断的那个函数——测的是
    同一个行为,少了一层从未被生产代码调用过的转发。
    """

    @staticmethod
    def _granted(role, codename):
        from types import SimpleNamespace

        from apps.perm.checker import check_permission
        return check_permission(SimpleNamespace(is_authenticated=True, role=role), codename)

    def test_fallback_to_dict_when_permission_not_in_db(self):
        """When Permission object doesn't exist, fall back to ROLE_PERMISSIONS dict."""
        from apps.perm.models import Permission
        # Ensure codename does NOT exist in DB
        Permission.objects.filter(codename="nonexistent.action").delete()

        # No role has "nonexistent.action" in ROLE_PERMISSIONS
        result = self._granted("JUDGE", "nonexistent.action")
        self.assertFalse(result)

    def test_granted_when_in_dict_and_not_in_db(self):
        """When Permission not in DB but ROLE_PERMISSIONS dict grants it, should grant."""
        from apps.perm.models import Permission
        # Ensure codename does NOT exist in DB
        Permission.objects.filter(codename="soul.read").delete()

        # ADMIN has "soul.read" in ROLE_PERMISSIONS
        result = self._granted("ADMIN", "soul.read")
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
        result = self._granted("JUDGE", "soul.read")
        self.assertTrue(result)

    # test_admin_bypass_in_middleware_call 曾经在这里,2026-08-28 删除。
    # 它验证的是 `PermissionMiddleware.__call__` 里的 ADMIN 短路,而那段代码在
    # `request.view` 之后,永远不可达;测试同样是自己设 `request.view` 才让它跑起来。
    # ADMIN 的真实短路在 `apps/perm/checker.py::check_permission` 里,由该模块自己的
    # 测试覆盖。

    def test_dict_fallback_for_unseeded_codename(self):
        """Codename generated by CodenameViewSetMixin but not seeded in DB falls back to dict."""
        from apps.perm.models import Permission
        # "soul.create" is in ROLE_PERMISSIONS for ADMIN
        Permission.objects.filter(codename="soul.create").delete()

        result = self._granted("ADMIN", "soul.create")
        self.assertTrue(result)

        # "soul.create" is NOT in ROLE_PERMISSIONS for VIEWER
        result = self._granted("VIEWER", "soul.create")
        self.assertFalse(result)


class TestMenuViewSetCodename(TestCase):
    def test_menu_viewset_has_codename(self):
        """Menus are no longer exempt: reads are menu.read, writes menu.manage.

        The exemption existed because `menu.manage` was the only menu codename
        and only ADMIN held it, so binding this viewset to it would have denied
        `list` — and with it the whole navigation tree — to every other role.
        perm migration 0017 seeds `menu.read` and grants it to all five roles,
        which is what makes the split declarable.
        """
        from apps.menus.views import MenuViewSet
        self.assertEqual(MenuViewSet.permission_codename, "menu")

    def test_menu_viewset_reads_are_open_to_every_role(self):
        """The navigation reads must resolve to menu.read, never menu.manage."""
        from apps.menus.views import MenuViewSet

        for action in ("list", "retrieve", "all", "tree", "list_public"):
            vs = MenuViewSet()
            vs.action = action
            self.assertEqual(
                vs.get_required_permissions(),
                ["menu.read"],
                f"{action} must not require the ADMIN-only menu.manage",
            )

    def test_menu_viewset_writes_require_manage(self):
        from apps.menus.views import MenuViewSet

        for action in ("create", "update", "partial_update", "destroy"):
            vs = MenuViewSet()
            vs.action = action
            self.assertEqual(vs.get_required_permissions(), ["menu.manage"])

    def test_menu_viewset_inherits_mixin(self):
        from apps.menus.views import MenuViewSet
        self.assertTrue(issubclass(MenuViewSet, CodenameViewSetMixin))
