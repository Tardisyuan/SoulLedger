"""
Tests for permission cache invalidation.
"""
import pytest
from apps.perm.cache import PermissionCache
from apps.perm.models import Role, Permission, RolePermission


@pytest.mark.django_db
class TestPermissionCacheInvalidation:
    """Test PermissionCache invalidation behavior."""

    def test_invalidate_role_clears_cache(self):
        """invalidate_role() should clear cached permissions for a role."""
        cache = PermissionCache()
        role, _ = Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
        perm, _ = Permission.objects.get_or_create(codename="soul.read", defaults={"name": "Soul Read"})
        RolePermission.objects.get_or_create(role=role, permission=perm)
        # Populate cache
        cache.has_permission("JUDGE", "soul.read")
        # Invalidate
        cache.invalidate_role("JUDGE")
        # After invalidation, re-check should query DB (not stale cache)
        result = cache.has_permission("JUDGE", "soul.read")
        assert result is True  # Should still have permission from DB

    def test_invalidate_all_clears_entire_cache(self):
        """invalidate_all() should clear all cached permissions."""
        cache = PermissionCache()
        role_j, _ = Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
        role_a, _ = Role.objects.get_or_create(name="ADMIN", defaults={"display_name": "Admin"})
        perm, _ = Permission.objects.get_or_create(codename="soul.read", defaults={"name": "Soul Read"})
        RolePermission.objects.get_or_create(role=role_j, permission=perm)
        RolePermission.objects.get_or_create(role=role_a, permission=perm)
        # Populate cache
        cache.has_permission("JUDGE", "soul.read")
        cache.has_permission("ADMIN", "soul.read")
        # Invalidate all
        cache.invalidate_all()
        # Both should still work (re-queries DB)
        assert cache.has_permission("JUDGE", "soul.read") is True
        assert cache.has_permission("ADMIN", "soul.read") is True

    def test_cache_hit_after_grant(self):
        """After granting a permission, cache should reflect the change."""
        cache = PermissionCache()
        role = Role.objects.create(name="TEST_CACHE", display_name="Test Cache")
        perm = Permission.objects.create(codename="test.cache", name="Test Cache")

        # Initially no permission
        assert cache.has_permission("TEST_CACHE", "test.cache") is False

        # Grant permission
        RolePermission.objects.create(role=role, permission=perm)

        # Invalidate cache
        cache.invalidate_role("TEST_CACHE")

        # Now should have permission
        assert cache.has_permission("TEST_CACHE", "test.cache") is True

    def test_cache_hit_after_revoke(self):
        """After revoking a permission, cache should reflect the change."""
        cache = PermissionCache()
        role = Role.objects.create(name="TEST_REVOKE", display_name="Test Revoke")
        perm = Permission.objects.create(codename="test.revoke", name="Test Revoke")

        # Grant permission
        RolePermission.objects.create(role=role, permission=perm)
        assert cache.has_permission("TEST_REVOKE", "test.revoke") is True

        # Revoke permission
        RolePermission.objects.filter(role=role, permission=perm).delete()

        # Invalidate cache
        cache.invalidate_role("TEST_REVOKE")

        # Should no longer have permission
        assert cache.has_permission("TEST_REVOKE", "test.revoke") is False

    def test_invalidate_role_clears_descendants(self):
        """invalidate_role() should clear cache for descendant roles too."""
        cache = PermissionCache()
        parent = Role.objects.create(name="PARENT", display_name="Parent")
        child = Role.objects.create(name="CHILD", display_name="Child", parent=parent)
        perm = Permission.objects.create(codename="test.inherit", name="Test Inherit")

        # Grant to parent
        RolePermission.objects.create(role=parent, permission=perm)

        # Child inherits from parent
        assert cache.has_permission("CHILD", "test.inherit") is True

        # Invalidate parent
        cache.invalidate_role("PARENT")

        # Child should still have permission (re-queries DB)
        assert cache.has_permission("CHILD", "test.inherit") is True
