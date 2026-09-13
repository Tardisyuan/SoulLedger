from django.conf import settings
from django.db import connection
from django.http import JsonResponse
from django.views import View
from rest_framework.authentication import SessionAuthentication
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.core.permissions import IsAdminPermission


class HealthCheck(View):
    """GET /health/ - Basic health check (public)"""

    def get(self, request):
        return JsonResponse({"status": "ok"})


class HealthCheckDetailed(APIView):
    """GET /health/detailed/ - Detailed health with DB + Redis (ADMIN only)

    A DRF view so it authenticates the way the API does. As a plain Django
    `View` it read only the session, and an ADMIN calling with
    `Authorization: Bearer` got 401 (BP-16). Session stays accepted for the
    browsable/admin case. Unauthenticated -> 401 (JWT is first, so DRF answers
    NotAuthenticated with a WWW-Authenticate header); non-ADMIN -> 403.
    """

    authentication_classes = [JWTAuthentication, SessionAuthentication]
    permission_classes = [IsAdminPermission]
    # Not an API resource; keep it out of the committed OpenAPI document.
    schema = None

    def get(self, request):
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

        return Response(checks, status=status_code)
