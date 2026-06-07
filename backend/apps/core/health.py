from django.conf import settings
from django.db import connection
from django.http import JsonResponse
from django.views import View


class HealthCheck(View):
    """GET /health/ - Basic health check (public)"""

    def get(self, request):
        return JsonResponse({"status": "ok"})


class HealthCheckDetailed(View):
    """GET /health/detailed/ - Detailed health with DB + Redis (authenticated only)"""

    def get(self, request):
        # Require authentication for detailed health check
        if not request.user or not request.user.is_authenticated:
            return JsonResponse({"error": "Authentication required"}, status=401)

        # Only ADMIN users can see detailed health
        if getattr(request.user, 'role', None) != 'ADMIN':
            return JsonResponse({"error": "Admin access required"}, status=403)

        checks = {"database": "ok", "redis": "ok", "status": "ok"}
        status_code = 200

        # DB check (no internal details exposed)
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
        except Exception:
            checks["database"] = "error"
            checks["status"] = "degraded"
            status_code = 503

        # Redis check (no internal details exposed)
        try:
            import redis
            redis_url = getattr(settings, 'REDIS_URL', 'redis://localhost:6379/0')
            r = redis.Redis.from_url(redis_url)
            r.ping()
        except Exception:
            checks["redis"] = "error"
            checks["status"] = "degraded"
            status_code = 503

        return JsonResponse(checks, status=status_code)
