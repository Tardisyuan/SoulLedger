"""
Rate limiting for death sync API.
Uses Redis INCR for atomic counter operations.
"""
from django.core.cache import cache
from rest_framework.throttling import BaseThrottle


class ApiKeyRateThrottle(BaseThrottle):
    """
    Per-API-key rate limiting using Redis INCR for atomicity.
    Falls back to in-memory if Redis unavailable.
    """
    cache_key_prefix = "death_sync_throttle"
    scope = "minute"  # 'minute' or 'hour'

    def get_cache_key(self, request, view):
        api_key = getattr(request, "api_key", None)
        if not api_key:
            return None
        return f"{self.cache_key_prefix}:{api_key.id}:{self.scope}"

    def allow_request(self, request, view):
        api_key = getattr(request, "api_key", None)
        if not api_key:
            return True

        if self.scope == "minute":
            limit = api_key.rate_limit_per_minute
            period = 60
        elif self.scope == "hour":
            limit = api_key.rate_limit_per_hour
            period = 3600
        else:
            return True

        cache_key = self.get_cache_key(request, view)

        # Use Redis INCR for atomic counter (falls back to memory if Redis unavailable)
        try:
            from django_redis import get_redis_connection
            conn = get_redis_connection("default")
            count = conn.incr(cache_key)
            if count == 1:
                conn.expire(cache_key, period)
        except Exception:
            # Fallback: non-atomic but safe for single-process
            count = cache.get(cache_key, 0)
            cache.set(cache_key, count + 1, period)

        if count > limit:
            self.wait = period
            return False

        return True
