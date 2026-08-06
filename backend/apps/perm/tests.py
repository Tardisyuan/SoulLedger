"""
Tests for perm app - RBAC permissions and views.
"""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from apps.org.models import Organization
from apps.perm.models import (
    DEFAULT_PERMISSIONS,
    ROLE_PERMISSIONS,
    Permission,
    Role,
    RolePermission,
)

User = get_user_model()


# ── Model tests ────────────────────────────────────────────────────────


class PermissionModelTest(TestCase):
    """Test Permission model"""

    def test_permission_str(self):
        perm = Permission.objects.create(
            codename="soul.read", name="View Soul", category="soul"
        )
        self.assertEqual(str(perm), "soul.read (View Soul)")


class RoleModelTest(TestCase):
    """Test Role model with scope and organization - M7"""

    @classmethod
    def setUpTestData(cls):
        cls.diyu = Organization.objects.create(
            name="中国地府", code="DIYU", category="CHINESE", level=0
        )

    def test_role_global_scope(self):
        # 0017 seeds ADMIN (at the model's default scope, ORG), so this can no
        # longer create the row — update_or_create still pins scope explicitly,
        # which is what the assertion is about.
        role, _ = Role.objects.update_or_create(
            name="ADMIN",
            defaults={"display_name": "Administrator", "scope": "GLOBAL"},
        )
        self.assertEqual(role.scope, "GLOBAL")
        self.assertIsNone(role.organization)

    def test_role_org_scope(self):
        role = Role.objects.create(
            name="DIYU_JUDGE", display_name="第一殿审判官", scope="ORG", organization=self.diyu
        )
        self.assertEqual(role.scope, "ORG")
        self.assertEqual(role.organization, self.diyu)

    def test_role_scope_choices(self):
        self.assertIn("GLOBAL", dict(Role.SCOPE_CHOICES).keys())
        self.assertIn("ORG", dict(Role.SCOPE_CHOICES).keys())

    def test_role_parent_inheritance(self):
        parent_role = Role.objects.create(name="PARENT_ROLE", display_name="Parent Role", scope="GLOBAL")
        child_role = Role.objects.create(name="CHILD_ROLE", display_name="Child Role", scope="GLOBAL", parent=parent_role)
        self.assertEqual(child_role.parent, parent_role)
        self.assertIsInstance(child_role.get_inherited_permissions(), set)

    def test_role_get_ancestors(self):
        parent = Role.objects.create(name="PARENT", display_name="Parent", scope="GLOBAL")
        child = Role.objects.create(name="CHILD", display_name="Child", scope="GLOBAL", parent=parent)
        grandchild = Role.objects.create(name="GRANDCHILD", display_name="Grandchild", scope="GLOBAL", parent=child)
        ancestors = grandchild.get_ancestors()
        self.assertEqual(len(ancestors), 2)
        self.assertEqual(ancestors[0], child)
        self.assertEqual(ancestors[1], parent)

    def test_role_str_representation(self):
        role, _ = Role.objects.update_or_create(
            name="ADMIN", defaults={"display_name": "Administrator"}
        )
        self.assertEqual(str(role), "ADMIN (Administrator)")


class RolePermissionModelTest(TestCase):
    """Test RolePermission model"""

    def test_role_permission_str(self):
        perm = Permission.objects.create(codename="soul.read", name="View Soul", category="soul")
        role, _ = Role.objects.get_or_create(
            name="ADMIN", defaults={"display_name": "Administrator"}
        )
        rp = RolePermission.objects.create(role=role, permission=perm)
        self.assertEqual(str(rp), "ADMIN -> soul.read")

    def test_unique_together(self):
        perm = Permission.objects.create(codename="soul.create", name="Create Soul", category="soul")
        role, _ = Role.objects.get_or_create(
            name="ADMIN", defaults={"display_name": "Administrator"}
        )
        RolePermission.objects.create(role=role, permission=perm)
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            RolePermission.objects.create(role=role, permission=perm)


# ── API view tests ────────────────────────────────────────────────────


class PermissionAPITest(TestCase):
    """Test Permission API endpoints"""

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="admin", password="admin123", role="ADMIN")
        self.viewer = User.objects.create_user(username="viewer", password="viewer123", role="VIEWER")
        for codename, name, category in DEFAULT_PERMISSIONS:
            Permission.objects.get_or_create(codename=codename, defaults={"name": name, "category": category})

        # Seeding Permission rows without the matching RolePermission rows
        # recreates precisely the state 0017 exists to remove: a codename that
        # is "seeded but ungranted", which the DB-authoritative checker reads as
        # a denial. It also makes _get_role_permissions_from_db answer from the
        # DB (any grant at all disables its dict fallback), so a half-seeded
        # fixture would have every role report a truncated permission list.
        # Grant what ROLE_PERMISSIONS promises so the fixture is a coherent
        # deployment rather than half of one.
        roles = {r.name: r for r in Role.objects.filter(name__in=list(ROLE_PERMISSIONS))}
        perms = {p.codename: p for p in Permission.objects.all()}
        for role_name, codenames in ROLE_PERMISSIONS.items():
            role = roles.get(role_name)
            if role is None:
                continue
            for codename in codenames:
                perm = perms.get(codename)
                if perm is not None:
                    RolePermission.objects.get_or_create(role=role, permission=perm)

    # -- list_permissions --

    def test_list_permissions_authenticated(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/v1/perm/permissions/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_list_permissions_unauthenticated(self):
        response = self.client.get("/api/v1/perm/permissions/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    # -- create_permission --

    def test_create_permission_admin(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/permissions/create/", {
            "codename": "custom.perm", "name": "Custom Perm", "category": "custom"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["codename"], "custom.perm")

    def test_create_permission_duplicate(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/permissions/create/", {
            "codename": "soul.read", "name": "Dup", "category": "soul"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_permission_non_admin(self):
        self.client.force_authenticate(user=self.viewer)
        response = self.client.post("/api/v1/perm/permissions/create/", {
            "codename": "test.x", "name": "Test", "category": "test"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    # -- update_delete_permission --

    def test_update_permission(self):
        perm = Permission.objects.create(codename="test.update", name="Update Me", category="test")
        self.client.force_authenticate(user=self.admin)
        response = self.client.put(f"/api/v1/perm/permissions/{perm.pk}/", {
            "codename": "test.updated", "name": "Updated", "category": "test"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        perm.refresh_from_db()
        self.assertEqual(perm.name, "Updated")

    def test_delete_permission(self):
        perm = Permission.objects.create(codename="test.delete", name="Delete Me", category="test")
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(f"/api/v1/perm/permissions/{perm.pk}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        perm.refresh_from_db()
        self.assertTrue(perm.is_deleted)

    def test_update_permission_not_found(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.put("/api/v1/perm/permissions/99999/", {
            "codename": "x", "name": "X", "category": "x"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    # -- get_role_permissions --

    def test_get_role_permissions_admin(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/v1/perm/role-permissions/", {"role": "ADMIN"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["role"], "ADMIN")
        self.assertIn("soul.read", data["permissions"])
        self.assertIn("system.settings", data["permissions"])

    def test_get_role_permissions_viewer(self):
        self.client.force_authenticate(user=self.viewer)
        response = self.client.get("/api/v1/perm/role-permissions/", {"role": "VIEWER"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["role"], "VIEWER")
        self.assertIn("soul.read", data["permissions"])
        self.assertNotIn("system.settings", data["permissions"])

    # -- get_permissions_for_role (ADMIN reads any role) --

    def test_get_permissions_for_role_admin_reads_other_role(self):
        Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/v1/perm/roles/JUDGE/permissions/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["role"], "JUDGE")
        # Response shape matches get_role_permissions so the client can share a parser
        self.assertIn("permissions", data)
        self.assertIn("details", data)

    def test_get_permissions_for_role_rejects_non_admin(self):
        """The anti-enumeration guard still applies to everyone but ADMIN."""
        Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
        self.client.force_authenticate(user=self.viewer)
        response = self.client.get("/api/v1/perm/roles/JUDGE/permissions/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_get_permissions_for_role_unknown_role(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/v1/perm/roles/NOPE/permissions/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    # -- assign_role_permissions --

    def test_assign_role_permissions(self):
        perm = Permission.objects.create(codename="test.assign", name="Assign", category="test")
        role, _ = Role.objects.get_or_create(name="VIEWER", defaults={"display_name": "Viewer"})
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/role-permissions/assign/", {
            "role": "VIEWER", "permission_ids": [perm.pk]
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["assigned_count"], 1)

    def test_assign_role_permissions_invalid_role(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/role-permissions/assign/", {
            "role": "NONEXISTENT", "permission_ids": []
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_assign_role_permissions_invalid_perm_ids(self):
        Role.objects.get_or_create(name="VIEWER", defaults={"display_name": "Viewer"})
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/role-permissions/assign/", {
            "role": "VIEWER", "permission_ids": [99999]
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    # -- init endpoints --

    def test_init_permissions(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/init/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreater(response.json()["total"], 0)

    def test_init_permissions_non_admin(self):
        self.client.force_authenticate(user=self.viewer)
        response = self.client.post("/api/v1/perm/init/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_init_roles(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/roles/init/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreater(response.json()["total"], 0)

    def test_init_role_permissions(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/role-permissions/init/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("roles", response.json())


class WorkflowPermissionMigrationTest(TestCase):
    """
    apps/perm/migrations/0013_add_workflow_permissions.py 的回归测试。

    背景：apps/workflow/views.py 一直在检查 workflow.read/create/update/delete/
    approve/advance 六个 codename，但 Permission 表里从来没有 workflow 这一族，
    权限管理界面上看不到、也没法单独授予/收回。这条迁移把
    apps.perm.models.ROLE_PERMISSIONS 字典里已经对 ADMIN/JUDGE 生效的分配落到
    DB 里，不改变任何角色的实际权限。

    这里重点盯防的回归：workflow.read 一旦被写进 Permission 表，
    apps.perm.checker.check_permission 就会认为它是"已播种"的 codename，
    尝试用 DB 判定（RolePermission 表）而不是继续 fallback 到 ROLE_PERMISSIONS
    字典。如果 JUDGE 没有配套的 RolePermission 记录，JUDGE 现在能查看工作流
    的权限就会被这次迁移静默收走。用 mirrors ROLE_PERMISSIONS 字典内容的方式
    建 RolePermission，就是为了让这次迁移落库前后 check_permission() 的结果
    完全不变。
    """

    WORKFLOW_CODENAMES = [
        "workflow.read", "workflow.create", "workflow.update",
        "workflow.delete", "workflow.approve", "workflow.advance",
    ]

    def setUp(self):
        from apps.perm.cache import invalidate_all_permissions

        # 0017 now seeds the five Role rows, so these can only be fetched.
        self.admin_role, _ = Role.objects.get_or_create(
            name="ADMIN", defaults={"display_name": "Administrator"}
        )
        self.judge_role, _ = Role.objects.get_or_create(
            name="JUDGE", defaults={"display_name": "Judge"}
        )
        # 0017 also replays 0013's own effects into the test database (it grants
        # the workflow codenames it finds already seeded). This class is about
        # what 0013 contributes, so rewind its six codenames first — otherwise
        # "forward created these grants" would hold whether or not 0013 does
        # anything. 0013's own reverse function is the exact inverse to use.
        self._backward()
        invalidate_all_permissions()
        self.addCleanup(invalidate_all_permissions)

    @staticmethod
    def _migration():
        import importlib
        return importlib.import_module("apps.perm.migrations.0013_add_workflow_permissions")

    def _forward(self):
        from django.apps import apps as real_apps
        self._migration().create_workflow_permissions(real_apps, None)

    def _backward(self):
        from django.apps import apps as real_apps
        self._migration().remove_workflow_permissions(real_apps, None)

    def test_forward_creates_six_permissions(self):
        self._forward()
        codenames = set(
            Permission.objects.filter(category="workflow").values_list("codename", flat=True)
        )
        # Superset rather than equality: 0015 adds workflow.escalate to the same
        # category, and this test is about what 0013 contributes.
        self.assertTrue(
            set(self.WORKFLOW_CODENAMES).issubset(codenames),
            f"missing: {set(self.WORKFLOW_CODENAMES) - codenames}",
        )

    def test_forward_mirrors_role_permissions_dict_exactly(self):
        self._forward()
        admin_grants = set(
            RolePermission.objects.filter(
                role=self.admin_role, permission__codename__startswith="workflow."
            ).values_list("permission__codename", flat=True)
        )
        judge_grants = set(
            RolePermission.objects.filter(
                role=self.judge_role, permission__codename__startswith="workflow."
            ).values_list("permission__codename", flat=True)
        )
        self.assertEqual(admin_grants, set(self.WORKFLOW_CODENAMES))
        self.assertEqual(judge_grants, {"workflow.read", "workflow.approve", "workflow.advance"})

    def test_judge_keeps_workflow_access_after_seeding(self):
        """The regression this migration must not introduce: JUDGE must still
        pass check_permission() for workflow.read/approve/advance once those
        codenames are seeded into the Permission table."""
        from apps.perm.checker import check_permission

        judge_user = User.objects.create_user(username="judge_wf_test", password="x", role="JUDGE")
        self._forward()

        for codename in ("workflow.read", "workflow.approve", "workflow.advance"):
            self.assertTrue(
                check_permission(judge_user, codename),
                f"JUDGE lost access to {codename} after workflow permissions were seeded",
            )
        for codename in ("workflow.create", "workflow.update", "workflow.delete"):
            self.assertFalse(check_permission(judge_user, codename))

    def test_reverse_removes_permissions_and_role_permissions(self):
        self._forward()
        self._backward()
        self.assertFalse(
            Permission.objects.filter(codename__in=self.WORKFLOW_CODENAMES).exists()
        )
        self.assertFalse(
            RolePermission.objects.filter(permission__codename__in=self.WORKFLOW_CODENAMES).exists()
        )

    def test_reverse_restores_dict_fallback_for_judge(self):
        from apps.perm.cache import invalidate_all_permissions
        from apps.perm.checker import check_permission

        judge_user = User.objects.create_user(username="judge_wf_test2", password="x", role="JUDGE")
        self._forward()
        self._backward()
        invalidate_all_permissions()

        self.assertTrue(check_permission(judge_user, "workflow.read"))

    def test_forward_is_idempotent(self):
        self._forward()
        self._forward()  # must not raise IntegrityError on the second pass
        self.assertEqual(
            Permission.objects.filter(codename__in=self.WORKFLOW_CODENAMES).count(),
            len(self.WORKFLOW_CODENAMES),
        )
        self.assertEqual(
            RolePermission.objects.filter(
                role=self.admin_role, permission__codename__startswith="workflow."
            ).count(),
            6,
        )

    def test_forward_backward_forward_cycle(self):
        """Mirrors the scratch-DB manual verification: forward -> backward -> forward."""
        self._forward()
        self._backward()
        self._forward()
        self.assertEqual(
            Permission.objects.filter(codename__in=self.WORKFLOW_CODENAMES).count(),
            len(self.WORKFLOW_CODENAMES),
        )


class ModeratorRealmLeadTest(TestCase):
    """Regression tests for 0014_grant_moderator_workflow_permissions.

    MODERATOR is the realm-lead role: it configures the approval flows for its
    own civilization. Two properties matter more than the grant itself, and
    neither is obvious from reading the migration:

    1. It must NOT be able to approve or advance a workflow. Designing a
       process and executing it are separate jobs; approve/advance belong to
       JUDGE, who exercises them on a real case.
    2. It must NOT be ADMIN. Scoping to a realm comes from the tenant, and
       apps/core/permissions.py lets ADMIN bypass tenant isolation outright —
       so a realm lead promoted to ADMIN silently becomes a lead of every
       realm. That is the failure this role exists to avoid.
    """

    CONFIGURE = ("workflow.read", "workflow.create", "workflow.update", "workflow.delete")
    EXECUTE = ("workflow.approve", "workflow.advance")

    def setUp(self):
        from apps.perm.cache import invalidate_all_permissions

        # 0017 now seeds the five Role rows, so these can only be fetched.
        self.moderator_role, _ = Role.objects.get_or_create(
            name="MODERATOR", defaults={"display_name": "Moderator"}
        )
        self.judge_role, _ = Role.objects.get_or_create(
            name="JUDGE", defaults={"display_name": "Judge"}
        )
        self.admin_role, _ = Role.objects.get_or_create(
            name="ADMIN", defaults={"display_name": "Administrator"}
        )
        # Rewind the whole workflow family — 0013's six, plus 0015's escalate —
        # along with every grant that cascades off them. 0017 replays all of
        # those into the test database, and this class has to observe 0014
        # acting on a world where they are absent, or its before/after
        # comparisons say nothing about 0014.
        Permission.objects.filter(codename__startswith="workflow.").delete()
        invalidate_all_permissions()
        self.addCleanup(invalidate_all_permissions)

    @staticmethod
    def _seed_workflow_permissions():
        import importlib

        from django.apps import apps as real_apps

        mod = importlib.import_module("apps.perm.migrations.0013_add_workflow_permissions")
        mod.create_workflow_permissions(real_apps, None)

    @staticmethod
    def _migration():
        import importlib
        return importlib.import_module(
            "apps.perm.migrations.0014_grant_moderator_workflow_permissions"
        )

    def _forward(self):
        from django.apps import apps as real_apps
        self._migration().grant(real_apps, None)

    def _backward(self):
        from django.apps import apps as real_apps
        self._migration().revoke(real_apps, None)

    def test_moderator_can_configure_workflows(self):
        from apps.perm.checker import check_permission

        user = User.objects.create_user(username="mod_cfg", password="x", role="MODERATOR")
        self._seed_workflow_permissions()
        self._forward()

        for codename in self.CONFIGURE:
            self.assertTrue(
                check_permission(user, codename),
                f"MODERATOR should be able to {codename}",
            )

    def test_moderator_cannot_approve_or_advance(self):
        """The separation of duties this role is built around."""
        from apps.perm.checker import check_permission

        user = User.objects.create_user(username="mod_exec", password="x", role="MODERATOR")
        self._seed_workflow_permissions()
        self._forward()

        for codename in self.EXECUTE:
            self.assertFalse(
                check_permission(user, codename),
                f"MODERATOR must not hold {codename} — that belongs to JUDGE",
            )

    def test_judge_keeps_execute_and_gains_nothing(self):
        """0014 must not disturb what 0013 established for JUDGE."""
        from apps.perm.checker import check_permission

        judge = User.objects.create_user(username="judge_unaffected", password="x", role="JUDGE")
        self._seed_workflow_permissions()
        self._forward()

        for codename in self.EXECUTE:
            self.assertTrue(check_permission(judge, codename))
        for codename in ("workflow.create", "workflow.update", "workflow.delete"):
            self.assertFalse(check_permission(judge, codename))

    def test_moderator_can_escalate_but_not_approve(self):
        """The escape hatch that replaces approve/advance for a realm lead.

        A stalled flow still needs a way forward; the answer is an action that
        demands a reason and writes an audit record, not the approval right
        the ten courts exist to divide.
        """
        self.assertIn("workflow.escalate", ROLE_PERMISSIONS["MODERATOR"])
        for codename in self.EXECUTE:
            self.assertNotIn(codename, ROLE_PERMISSIONS["MODERATOR"])

    def test_moderator_cannot_manage_users(self):
        """UserViewSet has no tenant mixin, so user.manage would let a realm
        lead edit any user in any tenant — including promoting themselves to
        ADMIN, which is exactly the isolation this role depends on."""
        self.assertNotIn("user.manage", ROLE_PERMISSIONS["MODERATOR"])
        self.assertNotIn("system.settings", ROLE_PERMISSIONS["MODERATOR"])
        self.assertNotIn("menu.manage", ROLE_PERMISSIONS["MODERATOR"])
        self.assertNotIn("soul.delete", ROLE_PERMISSIONS["MODERATOR"])

    def test_moderator_outranks_judge_on_realm_operations(self):
        """A realm lead should not hold fewer operational rights than the
        judges working under them — the shape 0014 shipped with."""
        moderator = set(ROLE_PERMISSIONS["MODERATOR"])
        judge = set(ROLE_PERMISSIONS["JUDGE"])
        self.assertGreater(len(moderator), len(judge))
        # Everything a judge does on souls and judgments, a lead can do too,
        # apart from the approval rights held back on purpose.
        missing = (judge - moderator) - set(self.EXECUTE)
        self.assertEqual(missing, set(), f"lead is missing judge rights: {missing}")

    def test_moderator_is_not_admin(self):
        """A realm lead must stay inside its tenant, so it cannot be ADMIN —
        ADMIN is what bypasses tenant isolation."""
        user = User.objects.create_user(username="mod_scope", password="x", role="MODERATOR")
        self.assertNotEqual(user.role, "ADMIN")
        self.assertNotIn("system.settings", ROLE_PERMISSIONS.get("MODERATOR", []))

    def test_reverse_removes_only_moderator_grants(self):
        from apps.perm.checker import check_permission

        judge = User.objects.create_user(username="judge_after_revoke", password="x", role="JUDGE")
        self._seed_workflow_permissions()

        # "Every grant this migration made" used to be spelled as "MODERATOR
        # holds no grant at all", which was only the same sentence while 0014
        # was the sole thing granting MODERATOR anything. 0017 now grants it the
        # rest of ROLE_PERMISSIONS, so compare against the grants held before
        # forward instead — that is the claim the blanket check was standing in
        # for, and it additionally catches a reverse that removes too much.
        def moderator_grants():
            return set(
                RolePermission.objects.filter(role=self.moderator_role).values_list(
                    "permission__codename", flat=True
                )
            )

        before = moderator_grants()
        self._forward()
        granted = moderator_grants() - before
        self.assertEqual(
            granted, set(self.CONFIGURE), "forward must grant exactly what 0014 promises"
        )

        self._backward()
        self.assertEqual(
            moderator_grants(),
            before,
            "reverse should drop every grant this migration made, and only those",
        )
        self.assertTrue(
            check_permission(judge, "workflow.approve"),
            "reverse must not disturb JUDGE's grants from 0013",
        )

    def test_forward_is_idempotent(self):
        self._seed_workflow_permissions()
        self._forward()
        self._forward()  # must not raise IntegrityError
        self.assertEqual(
            RolePermission.objects.filter(
                role=self.moderator_role, permission__codename__startswith="workflow."
            ).count(),
            len(self.CONFIGURE),
        )


class LedgerPermissionRenameMigrationTest(TestCase):
    """
    apps/perm/migrations/0016_rename_karma_permissions_to_ledger.py 的回归测试。

    codename 是存在 DB 里的值，改名只能靠数据迁移。这里盯防的唯一回归是
    **授权丢失**：RolePermission 用外键指向 Permission 的主键，所以必须原地
    UPDATE 那一行。先删后建会换主键，级联带走所有 RolePermission —— 那就是
    一次静默的权限收回。断言主键不变，等价于断言授权不变。
    """

    PAIRS = [("karma.read", "ledger.read"), ("karma.manage", "ledger.manage")]

    def setUp(self):
        from apps.perm.cache import invalidate_all_permissions

        # 0017 now seeds the five Role rows, so this can only be fetched.
        # The karma/ledger rows themselves are untouched by 0017: it creates
        # only menu.read, and 0016 renames karma rows that a migrate-only
        # database never had — so _seed_karma still builds the pre-rename world
        # from scratch.
        self.judge_role, _ = Role.objects.get_or_create(
            name="JUDGE", defaults={"display_name": "Judge"}
        )
        invalidate_all_permissions()
        self.addCleanup(invalidate_all_permissions)

    @staticmethod
    def _migration():
        import importlib
        return importlib.import_module(
            "apps.perm.migrations.0016_rename_karma_permissions_to_ledger"
        )

    def _run(self, forward=True):
        mod = self._migration()
        pairs = mod.RENAMES if forward else [
            (new, old, name, "karma") for old, new, name, _ in mod.RENAMES
        ]
        mod._rename(Permission, RolePermission, pairs)

    def _seed_karma(self):
        """种下改名前的世界：两条 Permission + JUDGE 对 karma.read 的授权。"""
        perms = {
            old: Permission.objects.create(codename=old, name=old, category="karma")
            for old, _ in self.PAIRS
        }
        grant = RolePermission.objects.create(
            role=self.judge_role, permission=perms["karma.read"]
        )
        return {old: p.pk for old, p in perms.items()}, grant.pk

    def test_forward_renames_in_place_and_keeps_the_grant(self):
        perm_pks, grant_pk = self._seed_karma()
        self._run(forward=True)

        self.assertFalse(Permission.objects.filter(codename__startswith="karma.").exists())
        for old, new in self.PAIRS:
            row = Permission.objects.get(codename=new)
            self.assertEqual(row.pk, perm_pks[old], "renamed in place — pk must not change")
            self.assertEqual(row.category, "ledger")

        grant = RolePermission.objects.get(pk=grant_pk)
        self.assertEqual(grant.permission.codename, "ledger.read")
        self.assertEqual(grant.role_id, self.judge_role.pk)

    def test_round_trip_restores_the_original_rows(self):
        perm_pks, grant_pk = self._seed_karma()
        self._run(forward=True)
        self._run(forward=False)

        for old, _ in self.PAIRS:
            row = Permission.objects.get(codename=old)
            self.assertEqual(row.pk, perm_pks[old])
            self.assertEqual(row.category, "karma")
        self.assertEqual(
            RolePermission.objects.get(pk=grant_pk).permission.codename, "karma.read"
        )

    def test_collision_moves_the_grant_instead_of_dropping_it(self):
        """两个 codename 同时存在时无法直接改名（唯一约束）。授权数量不能减少。"""
        _, grant_pk = self._seed_karma()
        Permission.objects.create(codename="ledger.read", name="x", category="ledger")

        self._run(forward=True)

        self.assertFalse(Permission.objects.filter(codename="karma.read").exists())
        self.assertTrue(
            RolePermission.objects.filter(
                role=self.judge_role, permission__codename="ledger.read"
            ).exists(),
            "collision branch must carry the grant over, not drop it",
        )
        self.assertFalse(RolePermission.objects.filter(pk=grant_pk).exists())

    def test_role_permissions_dict_no_longer_mentions_karma(self):
        """字典才是 checker 实际判定的依据，改名必须两边同步。"""
        for role, codenames in ROLE_PERMISSIONS.items():
            stale = [c for c in codenames if c.startswith("karma.")]
            self.assertEqual(stale, [], f"{role} still holds {stale}")
        self.assertIn("ledger.read", ROLE_PERMISSIONS["VIEWER"])
        self.assertIn("ledger.manage", ROLE_PERMISSIONS["ADMIN"])
        self.assertNotIn("ledger.manage", ROLE_PERMISSIONS["VIEWER"])
        self.assertNotIn("ledger.manage", ROLE_PERMISSIONS["JUDGE"])
        self.assertNotIn("ledger.manage", ROLE_PERMISSIONS["GUARDIAN"])

    def test_default_permissions_defines_every_codename_the_views_require(self):
        """karma.update 曾经是个谁也没定义过的 codename，别再来一次。"""
        from apps.ledger import views as ledger_views

        defined = {codename for codename, _, _ in DEFAULT_PERMISSIONS}
        checked = 0
        for name in dir(ledger_views):
            view = getattr(ledger_views, name)
            if not isinstance(view, type) or not hasattr(view, "get_required_permissions"):
                continue
            for codename in view().get_required_permissions():
                checked += 1
                self.assertIn(codename, defined, f"{name} requires undefined {codename}")
        self.assertGreater(checked, 0, "found no ledger views to check")


class RoleAPITest(TestCase):
    """Test Role CRUD API endpoints"""

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="admin2", password="admin123", role="ADMIN")
        self.viewer = User.objects.create_user(username="viewer2", password="viewer123", role="VIEWER")

    def test_list_roles(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/v1/perm/roles/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_create_role(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/roles/create/", {
            "name": "TESTER", "display_name": "Tester"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["name"], "TESTER")

    def test_create_role_duplicate(self):
        self.client.force_authenticate(user=self.admin)
        # ADMIN is seeded by 0017; get_or_create keeps the precondition explicit
        # instead of relying on the migration having run.
        Role.objects.get_or_create(name="ADMIN", defaults={"display_name": "Admin"})
        response = self.client.post("/api/v1/perm/roles/create/", {
            "name": "ADMIN", "display_name": "Admin Dup"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_role_non_admin(self):
        self.client.force_authenticate(user=self.viewer)
        response = self.client.post("/api/v1/perm/roles/create/", {
            "name": "TESTER", "display_name": "Tester"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_update_role(self):
        role = Role.objects.create(name="UPDATABLE", display_name="Old")
        self.client.force_authenticate(user=self.admin)
        response = self.client.put(f"/api/v1/perm/roles/{role.pk}/", {
            "name": "UPDATABLE", "display_name": "New Name"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        role.refresh_from_db()
        self.assertEqual(role.display_name, "New Name")

    def test_delete_role(self):
        role = Role.objects.create(name="DELETABLE", display_name="Delete Me")
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(f"/api/v1/perm/roles/{role.pk}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        role.refresh_from_db()
        self.assertTrue(role.is_deleted)

    def test_role_not_found(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.put("/api/v1/perm/roles/99999/", {
            "name": "X", "display_name": "X"
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class RoleUserCountAndStaleWriteGuardTest(TestCase):
    """RoleSerializer.user_count/version and assign_role_permissions' expected_version.

    Both exist for the Stage 7 permissions-matrix screen's save-confirmation
    guard: user_count turns an abstract grant/removal into "N users affected",
    and expected_version is what lets the client detect that another admin's
    assign call landed first, rather than silently reverting it — the replace-
    not-diff semantics of this endpoint make a lost update invisible otherwise.
    """

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="admin3", password="x", role="ADMIN")
        self.role = Role.objects.create(name="COUNTED", display_name="Counted")
        self.perm, _ = Permission.objects.get_or_create(
            codename="soul.read", defaults={"name": "查看灵魂", "category": "soul"}
        )

    def test_user_count_reflects_active_users_with_this_role_name(self):
        User.objects.create_user(username="held1", password="x", role="COUNTED")
        User.objects.create_user(username="held2", password="x", role="COUNTED")
        # role is a plain CharField on User, not a FK — matching by name is
        # the whole mechanism, so a differently-named role must not be counted.
        User.objects.create_user(username="other", password="x", role="VIEWER")

        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/v1/perm/roles/")
        counted = next(r for r in response.data if r["name"] == "COUNTED")
        self.assertEqual(counted["user_count"], 2)

    def test_version_starts_at_zero_and_is_exposed(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/v1/perm/roles/")
        counted = next(r for r in response.data if r["name"] == "COUNTED")
        self.assertEqual(counted["version"], 0)

    def test_assign_without_expected_version_still_works(self):
        """expected_version is optional — every caller before this screen existed must keep working."""
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/role-permissions/assign/", {
            "role": "COUNTED", "permission_ids": [self.perm.id],
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["version"], 1)

    def test_assign_with_correct_expected_version_succeeds_and_advances_it(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/role-permissions/assign/", {
            "role": "COUNTED", "permission_ids": [self.perm.id], "expected_version": 0,
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["version"], 1)

    def test_assign_with_stale_expected_version_is_rejected_and_does_not_write(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/v1/perm/role-permissions/assign/", {
            "role": "COUNTED", "permission_ids": [self.perm.id], "expected_version": 7,
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data["current_version"], 0)
        # The rejected call must not have written anything.
        self.assertEqual(RolePermission.objects.filter(role=self.role).count(), 0)

    def test_two_sequential_assigns_each_need_the_latest_version(self):
        """The scenario the guard exists for: a second admin's stale load."""
        self.client.force_authenticate(user=self.admin)
        first = self.client.post("/api/v1/perm/role-permissions/assign/", {
            "role": "COUNTED", "permission_ids": [self.perm.id], "expected_version": 0,
        }, format="json")
        self.assertEqual(first.status_code, status.HTTP_200_OK)

        # A second admin who loaded the screen before `first` landed still
        # holds expected_version=0 — replaying it must now 409, not silently
        # revert the grant `first` just made.
        second = self.client.post("/api/v1/perm/role-permissions/assign/", {
            "role": "COUNTED", "permission_ids": [], "expected_version": 0,
        }, format="json")
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(
            RolePermission.objects.filter(role=self.role).count(), 1,
            "the stale second call must not have wiped the grant the first call made",
        )
