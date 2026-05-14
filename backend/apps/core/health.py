from django.http import JsonResponse
from django.views import View
from django.db import connection
import redis


class HealthCheck(View):
    """GET /health/ - Basic health check"""

    def get(self, request):
        return JsonResponse({"status": "ok"})


class HealthCheckDetailed(View):
    """GET /health/detailed/ - Detailed health with DB + Redis"""

    def get(self, request):
        checks = {"database": "ok", "redis": "ok", "status": "ok"}
        status_code = 200

        # DB check
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
        except Exception as e:
            checks["database"] = f"error: {e}"
            checks["status"] = "degraded"
            status_code = 503

        # Redis check
        try:
            r = redis.Redis.from_url("redis://localhost:6379/0")
            r.ping()
        except Exception as e:
            checks["redis"] = f"error: {e}"
            checks["status"] = "degraded"
            status_code = 503

        return JsonResponse(checks, status=status_code)
