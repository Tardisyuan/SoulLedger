"""
Permission Cache Service - Redis Implementation.

Provides caching for permission checks to reduce database queries.
Designed to gracefully fall back when Redis is unavailable.
Supports role hierarchy inheritance.
"""
import logging
from typing import Optional

from django.conf import settings

logger = logging.getLogger(__name__)


class PermissionCache:
    """
    Redis-based permission cache with fallback to memory cache.

    TTL is configurable via CACHE_PERMISSION_TTL setting (default: 300s).
    """

    def __init__(self):
        self._redis_client = None
        self._fallback_cache: dict[tuple[str, str], tuple[bool, float]] = {}
        self._ttl = getattr(settings, 'CACHE_PERMISSION_TTL', 300)
        self._connect_redis()

    def _connect_redis(self):
        """Establish Redis connection with error handling."""
        try:
            import redis
            self._redis_client = redis.from_url(
                settings.REDIS_URL,
                decode_responses=True
            )
            # Test connection
            self._redis_client.ping()
            logger.info("PermissionCache: Redis connection established")
        except Exception as e:
            logger.warning(f"PermissionCache: Redis unavailable, using memory fallback: {e}")
            self._redis_client = None

    def _make_key(self, role: str, codename: str) -> str:
        """Generate Redis key for role+codename pair."""
        return f"perm:{role}:{codename}"

    def get(self, role: str, codename: str) -> Optional[bool]:
        """
        Get cached permission result.

        Returns:
            True if permission granted, False if denied, None if not cached.
        """
        import time

        # Try Redis first (with reconnection attempt)
        if self._redis_client is None:
            self._connect_redis()  # Attempt reconnection
        if self._redis_client is not None:
            try:
                key = self._make_key(role, codename)
                value = self._redis_client.get(key)
                if value is not None:
                    return value == '1'
            except Exception as e:
                logger.warning(f"PermissionCache: Redis get failed, falling back: {e}")
                self._redis_client = None

        # Fallback to memory cache with TTL check
        cache_key = (role, codename)
        entry = self._fallback_cache.get(cache_key)
        if entry is not None:
            value, timestamp = entry
            if time.time() - timestamp < self._ttl:
                return value
            # Expired - remove from cache
            del self._fallback_cache[cache_key]
        return None

    def set(self, role: str, codename: str, has_permission: bool) -> None:
        """Cache permission result with TTL."""
        import time

        # Update Redis if available
        if self._redis_client is not None:
            try:
                key = self._make_key(role, codename)
                self._redis_client.setex(
                    key,
                    self._ttl,
                    '1' if has_permission else '0'
                )
                return
            except Exception as e:
                logger.warning(f"PermissionCache: Redis set failed, falling back: {e}")
                self._redis_client = None

        # Fallback to memory cache with timestamp
        import time
        self._fallback_cache[(role, codename)] = (has_permission, time.time())

    def has_permission(self, role_name: str, permission_codename: str) -> Optional[bool]:
        """
        Check if a role has a specific permission, considering role hierarchy inheritance.

        This method checks both direct permissions and inherited permissions from parent roles.

        Args:
            role_name: The role name to check
            permission_codename: The permission codename to check for

        Returns:
            True if permission granted, False if denied, None if not cached.
        """
        # Try cache first
        cached = self.get(role_name, permission_codename)
        if cached is not None:
            return cached

        # Cache miss - need to compute from database
        try:
            from apps.perm.models import Role

            role = Role.objects.prefetch_related('permissions', 'parent').get(name=role_name)
            inherited_perms = role.get_inherited_permissions()
            has_perm = permission_codename in inherited_perms

            # Cache the result
            self.set(role_name, permission_codename, has_perm)
            return has_perm
        except Exception as e:
            logger.warning(f"PermissionCache: has_permission check failed: {e}")
            return None

    def invalidate_role(self, role: str) -> None:
        """Clear all cached permissions for a role and its descendants."""
        # Invalidate Redis using SCAN (non-blocking) instead of KEYS
        if self._redis_client is not None:
            try:
                pattern = f"perm:{role}:*"
                keys = []
                cursor = 0
                while True:
                    cursor, batch = self._redis_client.scan(cursor=cursor, match=pattern, count=100)
                    keys.extend(batch)
                    if cursor == 0:
                        break
                if keys:
                    self._redis_client.delete(*keys)
                    logger.debug(f"PermissionCache: invalidated {len(keys)} keys for role={role}")
            except Exception as e:
                logger.warning(f"PermissionCache: Redis invalidate_role failed: {e}")

        # Invalidate memory fallback
        keys_to_remove = [k for k in self._fallback_cache if k[0] == role]
        for key in keys_to_remove:
            del self._fallback_cache[key]

        # Also invalidate descendant roles since they inherit from this role
        try:
            from apps.perm.models import Role
            role_obj = Role.objects.filter(name=role).first()
            if role_obj:
                for descendant in role_obj.get_descendants():
                    self.invalidate_role(descendant.name)
        except Exception as e:
            logger.warning(f"PermissionCache: failed to invalidate descendants: {e}")

    def invalidate_all(self) -> None:
        """Clear all permission caches."""
        # Clear Redis using SCAN (non-blocking) instead of KEYS
        if self._redis_client is not None:
            try:
                pattern = "perm:*"
                keys = []
                cursor = 0
                while True:
                    cursor, batch = self._redis_client.scan(cursor=cursor, match=pattern, count=100)
                    keys.extend(batch)
                    if cursor == 0:
                        break
                if keys:
                    self._redis_client.delete(*keys)
                    logger.debug(f"PermissionCache: invalidated {len(keys)} all keys")
            except Exception as e:
                logger.warning(f"PermissionCache: Redis invalidate_all failed: {e}")

        # Clear memory fallback
        self._fallback_cache.clear()


# Global singleton instance
_permission_cache: Optional[PermissionCache] = None


def get_permission_cache() -> PermissionCache:
    """Get the global PermissionCache singleton."""
    global _permission_cache
    if _permission_cache is None:
        _permission_cache = PermissionCache()
    return _permission_cache


def invalidate_role_permissions(role: str) -> None:
    """Convenience function to invalidate all cached permissions for a role."""
    get_permission_cache().invalidate_role(role)


def invalidate_all_permissions() -> None:
    """Convenience function to clear all permission caches."""
    get_permission_cache().invalidate_all()