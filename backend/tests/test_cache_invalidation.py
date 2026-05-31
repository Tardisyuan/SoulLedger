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
        Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
        # Populate cache
        cache.has_permission("JUDGE", "soul.read")
        # Invalidate
        cache.invalidate_role("JUDGE")
        # After invalidation, cache should be empty
        assert cache._fallback_cache.get(("JUDGE", "soul.read")) is None

    def test_invalidate_all_clears_entire_cache(self):
        """invalidate_all() should clear all cached permissions."""
        cache = PermissionCache()
        Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
        Role.objects.get_or_create(name="ADMIN", defaults={"display_name": "Admin"})
        # Populate cache
        cache.has_permission("JUDGE", "soul.read")
        cache.has_permission("ADMIN", "soul.read")
        # Invalidate all
        cache.invalidate_all()
        # Both should be cleared
        assert cache._fallback_cache.get(("JUDGE", "soul.read")) is None
        assert cache._fallback_cache.get(("ADMIN", "soul.read")) is None

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

        # Child cache should also be cleared
        assert cache._fallback_cache.get(("CHILD", "test.inherit")) is None
