"""
Rate limiting for death sync API.
Uses Redis INCR for atomic counter operations.
"""
from django.core.cache import cache
from rest_framework.throttling import BaseThrottle


class ApiKeyRateThrottle(BaseThrottle):
    """
    Per-API-key rate limiting: `cache.add` + `cache.incr`, atomic in Redis, fixed window from the first call.

    NOT WIRED UNTIL 2026-08-30. This class existed, was correct-looking, and was
    referenced by nothing: `DEFAULT_THROTTLE_CLASSES` held only `AnonRateThrottle`
    and no view named it. Measured before wiring: an API key with
    `rate_limit_per_minute=1`, five consecutive requests -> `[200,200,200,200,200]`.

    Wiring it surfaced two defects that had no way to show themselves while it
    was dead. Both are fixed below, and both are the reason a "written but not
    called" module is not the same as "written and working":

    1. `self.wait = period` shadowed `BaseThrottle.wait`, which DRF calls as a
       **method** (`throttle.wait()`) when a request is refused. The first
       genuinely throttled request would have raised
       `TypeError: 'int' object is not callable` instead of returning 429.
    2. The non-Redis fallback compared the count from *before* the increment,
       so it allowed `limit + 1` requests where the Redis path allows `limit`.
       Two code paths, two different limits, and no test could see either.
    """
    cache_key_prefix = "death_sync_throttle"
    scope = "minute"  # 'minute' or 'hour'
    # Seconds to wait, set when a request is refused. Named with an underscore
    # because `wait` itself is the method DRF calls -- see defect 1 above.
    _wait = None

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

        # `add` then `incr`: atomic in Redis, and neither moves the expiry -- the window runs from the first call.
        # (Was a `django_redis` branch that could never import here, falling back every time to `get` + `set`,
        # whose `set` restarted the window on every call: a caller that kept calling was never let through again.)
        if cache.add(cache_key, 1, period):
            count = 1
        else:
            try:
                count = cache.incr(cache_key)
            except ValueError:  # expired between the two calls
                cache.add(cache_key, 1, period)
                count = 1

        if count > limit:
            self._wait = period
            return False

        return True

    def wait(self, *args, **kwargs):
        """Seconds until the caller may retry. DRF calls this to build the
        `Retry-After` header on the 429."""
        return self._wait

    @classmethod
    def remaining_for(cls, api_key, scope="minute"):
        """How many requests this key has left in the current window.

        Exists because `DeathSyncHealthView` used to report the configured
        ceiling under the name `rate_limit_remaining` -- a number that is never
        the remaining count, and was doubly wrong while nothing was counting at
        all. Returns `None` when the counter cannot be read, which the health
        view reports as `null` rather than inventing a number.
        """
        if api_key is None:
            return None
        limit = (
            api_key.rate_limit_per_minute if scope == "minute"
            else api_key.rate_limit_per_hour
        )
        cache_key = f"{cls.cache_key_prefix}:{api_key.id}:{scope}"
        used = cache.get(cache_key)
        if used is None:
            return None
        return max(0, limit - used)
