"""
Tests for permission cache invalidation.

Rewritten 2026-09-13 (BP-09): these used to drive the cache through
`PermissionCache.has_permission`, which is now deleted (it recomputed
permission from `Role.get_inherited_permissions` — inheritance the real
enforcement path, `apps.perm.checker.check_permission`, never considers — and
wrote the result under the same cache key `checker.py` uses, which is the
drift BP-09 removed). `test_cache_hit_after_grant` / `test_cache_hit_after_revoke`
were dropped outright rather than rewritten: they asserted grant/revoke
behavior that duplicates `apps/perm/test_checker_grants.py::test_a_grant_grants`
/ `test_a_revocation_revokes`, which exercise the actual production path.
What remains here is `invalidate_role` / `invalidate_all` mechanics — those are
real (`apps/perm/views.py` calls them on every grant/revoke) — tested directly
against `get`/`set`, the two methods `checker.py` actually calls.
"""
import pytest

from apps.perm.cache import PermissionCache
from apps.perm.models import Role


@pytest.mark.django_db
class TestPermissionCacheInvalidation:
    """Test PermissionCache invalidation behavior."""

    def test_invalidate_role_clears_cache(self):
        """invalidate_role() should clear cached permissions for a role."""
        cache = PermissionCache()
        Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
        cache.set("JUDGE", "soul.read", True)
        assert cache.get("JUDGE", "soul.read") is True

        cache.invalidate_role("JUDGE")

        assert cache.get("JUDGE", "soul.read") is None

    def test_invalidate_all_clears_entire_cache(self):
        """invalidate_all() should clear all cached permissions, for every role."""
        cache = PermissionCache()
        Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
        Role.objects.get_or_create(name="ADMIN", defaults={"display_name": "Admin"})
        cache.set("JUDGE", "soul.read", True)
        cache.set("ADMIN", "soul.read", True)

        cache.invalidate_all()

        assert cache.get("JUDGE", "soul.read") is None
        assert cache.get("ADMIN", "soul.read") is None

    def test_invalidate_role_clears_descendants(self):
        """invalidate_role() should clear cache for descendant roles too."""
        cache = PermissionCache()
        parent = Role.objects.create(name="PARENT", display_name="Parent")
        Role.objects.create(name="CHILD", display_name="Child", parent=parent)
        cache.set("PARENT", "test.inherit", True)
        cache.set("CHILD", "test.inherit", True)

        cache.invalidate_role("PARENT")

        # Absence, not just the parent's: this is the "cascades to
        # descendants" behavior `get_descendants()` exists for.
        assert cache.get("PARENT", "test.inherit") is None
        assert cache.get("CHILD", "test.inherit") is None

    def test_invalidate_role_does_not_clear_unrelated_role(self):
        """A control case: invalidating one role must not clear another's cache."""
        cache = PermissionCache()
        Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
        Role.objects.get_or_create(name="VIEWER", defaults={"display_name": "Viewer"})
        cache.set("JUDGE", "soul.read", True)
        cache.set("VIEWER", "soul.read", False)

        cache.invalidate_role("JUDGE")

        assert cache.get("JUDGE", "soul.read") is None
        assert cache.get("VIEWER", "soul.read") is False
