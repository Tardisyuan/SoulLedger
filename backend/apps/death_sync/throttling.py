"""
Rate limiting for death sync API.
"""
from rest_framework.throttling import BaseThrottle
from django.core.cache import cache


class ApiKeyRateThrottle(BaseThrottle):
    """
    Per-API-key rate limiting using Django cache (Redis).
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
        count = cache.get(cache_key, 0)
        if count >= limit:
            self.wait = period
            return False

        cache.set(cache_key, count + 1, period)
        return True
