"""
Tests for Role Hierarchy (ancestors/descendants) — the `Role.parent` chain.

2026-09-13 (BP-09): this file used to be mostly about `get_inherited_permissions()`
and `PermissionCache.has_permission()`, both deleted as dead code — full-repo
grep found only test callers, and `apps/core/ws_permissions.py`'s docstring
already recorded that `Role.parent` inheritance "is not reproduced ... and is
not load-bearing: nothing seeded ever sets it." What is real and stays tested
below is `get_ancestors()` / `get_descendants()` and the `parent` FK itself —
`PermissionCache.invalidate_role()` uses `get_descendants()` in production to
cascade cache invalidation to child roles.
"""
import pytest

from apps.perm.models import Role


@pytest.mark.django_db
class TestRoleHierarchy:
    """Test the role hierarchy chain itself: parent/children/ancestors/descendants."""

    @pytest.fixture(autouse=True)
    def setup_data(self):
        """4-level chain: TEST_ADMIN -> MANAGER -> STAFF -> JUNIOR.

        Synthetic names (not real seeded roles — see git history for why
        'ADMIN' collides with perm migration 0017's seed data).
        """
        self.role_admin = Role.objects.create(
            name='TEST_ADMIN',
            display_name='Test Administrator'
        )
        self.role_manager = Role.objects.create(
            name='MANAGER',
            display_name='Manager',
            parent=self.role_admin
        )
        self.role_staff = Role.objects.create(
            name='STAFF',
            display_name='Staff',
            parent=self.role_manager
        )
        self.role_junior = Role.objects.create(
            name='JUNIOR',
            display_name='Junior',
            parent=self.role_staff
        )
        yield

    def test_get_ancestors(self):
        """Test getting all ancestors of a role"""
        # ADMIN has no ancestors
        assert len(self.role_admin.get_ancestors()) == 0

        # MANAGER has ADMIN as ancestor
        manager_ancestors = self.role_manager.get_ancestors()
        assert len(manager_ancestors) == 1
        assert manager_ancestors[0] == self.role_admin

        # STAFF has MANAGER and ADMIN as ancestors
        staff_ancestors = self.role_staff.get_ancestors()
        assert len(staff_ancestors) == 2
        assert self.role_manager in staff_ancestors
        assert self.role_admin in staff_ancestors

        # JUNIOR has STAFF, MANAGER, ADMIN as ancestors
        junior_ancestors = self.role_junior.get_ancestors()
        assert len(junior_ancestors) == 3
        assert self.role_staff in junior_ancestors
        assert self.role_manager in junior_ancestors
        assert self.role_admin in junior_ancestors

    def test_get_descendants(self):
        """Test getting all descendants of a role"""
        # JUNIOR has no descendants
        assert len(self.role_junior.get_descendants()) == 0

        # STAFF has JUNIOR as descendant
        staff_descendants = self.role_staff.get_descendants()
        assert len(staff_descendants) == 1
        assert self.role_junior in staff_descendants

        # MANAGER has STAFF and JUNIOR as descendants
        manager_descendants = self.role_manager.get_descendants()
        assert len(manager_descendants) == 2
        assert self.role_staff in manager_descendants
        assert self.role_junior in manager_descendants

        # ADMIN has all as descendants
        admin_descendants = self.role_admin.get_descendants()
        assert len(admin_descendants) == 3
        assert self.role_manager in admin_descendants
        assert self.role_staff in admin_descendants
        assert self.role_junior in admin_descendants

    def test_child_relationship(self):
        """Test parent-children relationship"""
        assert self.role_admin.children.filter(name='MANAGER').exists()
        assert self.role_manager.parent == self.role_admin
        assert self.role_staff.parent == self.role_manager
        assert self.role_junior.parent == self.role_staff

    def test_no_parent_role(self):
        """Test role with no parent"""
        assert self.role_admin.parent is None


@pytest.mark.django_db
class TestRoleHierarchyEdgeCases:
    """Test edge cases in the ancestor/descendant chain."""

    def test_circular_reference_prevention(self):
        """get_descendants() terminates and reports correctly on a simple chain."""
        role_a = Role.objects.create(name='ROLE_A', display_name='Role A')
        role_b = Role.objects.create(name='ROLE_B', display_name='Role B', parent=role_a)

        assert role_b.parent == role_a
        assert role_a.get_descendants() == [role_b]

    def test_deep_hierarchy(self):
        """get_descendants() walks a deep hierarchy (10 levels) without stopping early."""
        roles = []
        previous_role = None

        for i in range(10):
            role = Role.objects.create(
                name=f'LEVEL_{i}',
                display_name=f'Level {i}',
                parent=previous_role
            )
            roles.append(role)
            previous_role = role

        # The root sees all 9 roles below it; the leaf sees none.
        assert len(roles[0].get_descendants()) == 9
        assert len(roles[-1].get_descendants()) == 0

    def test_empty_hierarchy(self):
        """A role with no parent and no children has no ancestors or descendants."""
        role = Role.objects.create(name='EMPTY', display_name='Empty Role')
        assert role.get_ancestors() == []
        assert role.get_descendants() == []
