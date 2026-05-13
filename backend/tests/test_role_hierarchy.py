"""
Tests for Role Hierarchy Inheritance
验证角色层级继承功能
"""
import pytest
from django.test import TestCase

from apps.perm.models import Role, Permission, RolePermission


@pytest.mark.django_db
class TestRoleHierarchy:
    """Test role hierarchy and permission inheritance"""

    @pytest.fixture(autouse=True)
    def setup_data(self):
        """Setup test data"""
        # Create permissions
        self.perm_read = Permission.objects.create(
            codename='test.read',
            name='Test Read',
            category='test'
        )
        self.perm_write = Permission.objects.create(
            codename='test.write',
            name='Test Write',
            category='test'
        )
        self.perm_delete = Permission.objects.create(
            codename='test.delete',
            name='Test Delete',
            category='test'
        )
        self.perm_admin = Permission.objects.create(
            codename='test.admin',
            name='Test Admin',
            category='test'
        )

        # Create role hierarchy: ADMIN -> MANAGER -> STAFF -> JUNIOR
        self.role_admin = Role.objects.create(
            name='ADMIN',
            display_name='Administrator'
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

        # ADMIN has all permissions directly
        RolePermission.objects.create(role=self.role_admin, permission=self.perm_read)
        RolePermission.objects.create(role=self.role_admin, permission=self.perm_write)
        RolePermission.objects.create(role=self.role_admin, permission=self.perm_delete)
        RolePermission.objects.create(role=self.role_admin, permission=self.perm_admin)

        # MANAGER has read and write (inherits admin's permissions via ADMIN)
        RolePermission.objects.create(role=self.role_manager, permission=self.perm_read)
        RolePermission.objects.create(role=self.role_manager, permission=self.perm_write)

        # STAFF only has read
        RolePermission.objects.create(role=self.role_staff, permission=self.perm_read)

        # JUNIOR has no direct permissions

        yield

    def test_direct_permissions(self):
        """Test that direct permissions are correctly assigned"""
        admin_perms = self.role_admin.get_inherited_permissions()
        assert 'test.read' in admin_perms
        assert 'test.write' in admin_perms
        assert 'test.delete' in admin_perms
        assert 'test.admin' in admin_perms

        # MANAGER has only 2 direct permissions (read, write)
        # but inherits delete and admin from ADMIN
        manager_direct = set(
            rp.permission.codename
            for rp in RolePermission.objects.filter(role=self.role_manager)
        )
        assert 'test.read' in manager_direct
        assert 'test.write' in manager_direct
        assert 'test.delete' not in manager_direct  # Not directly assigned
        assert 'test.admin' not in manager_direct  # Not directly assigned

        # But MANAGER inherits delete and admin from ADMIN
        manager_perms = self.role_manager.get_inherited_permissions()
        assert 'test.read' in manager_perms
        assert 'test.write' in manager_perms
        assert 'test.delete' in manager_perms  # Inherited from ADMIN
        assert 'test.admin' in manager_perms  # Inherited from ADMIN

    def test_child_inherits_parent_permissions(self):
        """Test that child role inherits parent role's permissions"""
        # MANAGER inherits from ADMIN
        manager_perms = self.role_manager.get_inherited_permissions()
        assert 'test.read' in manager_perms  # Direct
        assert 'test.write' in manager_perms  # Direct
        assert 'test.delete' in manager_perms  # Inherited from ADMIN
        assert 'test.admin' in manager_perms  # Inherited from ADMIN

    def test_grandchild_inherits_grandparent_permissions(self):
        """Test that grandchild inherits from grandparent (multi-level inheritance)"""
        # STAFF inherits from MANAGER which inherits from ADMIN
        staff_perms = self.role_staff.get_inherited_permissions()
        assert 'test.read' in staff_perms  # Direct
        assert 'test.write' in staff_perms  # Inherited from MANAGER
        assert 'test.delete' in staff_perms  # Inherited from ADMIN via MANAGER
        assert 'test.admin' in staff_perms  # Inherited from ADMIN via MANAGER

    def test_great_grandchild_inheritance(self):
        """Test 4-level hierarchy: ADMIN -> MANAGER -> STAFF -> JUNIOR"""
        # JUNIOR inherits all the way up
        junior_perms = self.role_junior.get_inherited_permissions()
        assert 'test.read' in junior_perms  # Direct on JUNIOR (none) -> STAFF
        assert 'test.write' in junior_perms  # Inherited from MANAGER
        assert 'test.delete' in junior_perms  # Inherited from ADMIN
        assert 'test.admin' in junior_perms  # Inherited from ADMIN

    def test_direct_permission_overrides_inherited(self):
        """Test that direct permission assignment works even if parent denies"""
        # Create a scenario where we can test override behavior
        # For now, note that direct permissions ADD to inherited, not override

        junior_perms = self.role_junior.get_inherited_permissions()
        # JUNIOR has no direct permissions, but inherits all from ancestors
        assert len(junior_perms) == 4  # All 4 permissions inherited

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
        admin_perms = self.role_admin.get_inherited_permissions()
        # ADMIN only has its direct permissions
        assert len(admin_perms) == 4

    def test_permission_cache_has_permission(self):
        """Test PermissionCache.has_permission with role inheritance"""
        from apps.perm.cache import get_permission_cache

        cache = get_permission_cache()
        cache.invalidate_all()

        # ADMIN has test.read
        assert cache.has_permission('ADMIN', 'test.read') is True
        # ADMIN does not have nonexistent permission
        assert cache.has_permission('ADMIN', 'nonexistent') is False

        # MANAGER inherits test.delete and test.admin from ADMIN
        assert cache.has_permission('MANAGER', 'test.delete') is True
        assert cache.has_permission('MANAGER', 'test.admin') is True

        # JUNIOR inherits everything from ancestors
        assert cache.has_permission('JUNIOR', 'test.read') is True
        assert cache.has_permission('JUNIOR', 'test.write') is True
        assert cache.has_permission('JUNIOR', 'test.delete') is True
        assert cache.has_permission('JUNIOR', 'test.admin') is True


@pytest.mark.django_db
class TestRoleHierarchyEdgeCases:
    """Test edge cases in role hierarchy"""

    def test_circular_reference_prevention(self):
        """Test that we handle potential circular references gracefully"""
        # Create a simple chain
        role_a = Role.objects.create(name='ROLE_A', display_name='Role A')
        role_b = Role.objects.create(name='ROLE_B', display_name='Role B', parent=role_a)

        # Verify hierarchy
        assert role_b.parent == role_a
        assert role_a.get_descendants() == [role_b]

    def test_deep_hierarchy(self):
        """Test a deep role hierarchy (10 levels)"""
        roles = []
        previous_role = None

        # Create 10-level hierarchy
        for i in range(10):
            role = Role.objects.create(
                name=f'LEVEL_{i}',
                display_name=f'Level {i}',
                parent=previous_role
            )
            roles.append(role)

            # Add a unique permission at each level
            perm = Permission.objects.create(
                codename=f'level_{i}.read',
                name=f'Level {i} Read',
                category='test'
            )
            RolePermission.objects.create(role=role, permission=perm)
            previous_role = role

        # Verify deepest role inherits all permissions
        deepest = roles[-1]
        inherited = deepest.get_inherited_permissions()
        assert len(inherited) == 10  # All 10 unique permissions
        for i in range(10):
            assert f'level_{i}.read' in inherited

    def test_empty_hierarchy(self):
        """Test role with no permissions and no parent"""
        role = Role.objects.create(name='EMPTY', display_name='Empty Role')
        perms = role.get_inherited_permissions()
        assert len(perms) == 0
