import time

from django.conf import settings
from django.db import connection
from django.http import JsonResponse
from django.views import View
from rest_framework.authentication import SessionAuthentication
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsAdminPermission
from apps.soul_accounts.authentication import OfficerJWTAuthentication


def database_ok() -> bool:
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:
        return False
    return True


def redis_ok() -> bool:
    try:
        import redis

        redis_url = getattr(settings, "REDIS_URL", "redis://localhost:6379/0")
        # Bounded: a probe that hangs on a dead Redis is a probe that times out instead of answering 503.
        redis.Redis.from_url(redis_url, socket_timeout=2, socket_connect_timeout=2).ping()
    except Exception:
        return False
    return True


class HealthCheck(View):
    """GET /health/ — liveness (public): the process answers. Constant on purpose; readiness is /health/ready/."""

    def get(self, request):
        return JsonResponse({"status": "ok"})


#: (monotonic time, ok) of the last readiness check. A public endpoint that queries the database
#: and Redis on every hit is a free amplifier; 5 seconds bounds it to one pair of checks per process.
READY_CACHE_SECONDS = 5.0
_ready_last: list = [float("-inf"), True]


class HealthCheckReady(View):
    """GET /health/ready/ — readiness (public): this process can reach the database and Redis.

    Answers only `{"status": "ok" | "degraded"}` (503 when degraded) — which dependency failed is on
    `/health/detailed/`, behind ADMIN. Compose's backend healthcheck probes this one, so "healthy" now
    means "can serve", not merely "daphne is up". Exempt from the https redirect like `/health/`.
    """

    def get(self, request):
        now = time.monotonic()
        if now - _ready_last[0] >= READY_CACHE_SECONDS:
            _ready_last[:] = [now, database_ok() and redis_ok()]
        ok = _ready_last[1]
        return JsonResponse({"status": "ok" if ok else "degraded"}, status=200 if ok else 503)


class HealthCheckDetailed(APIView):
    """GET /health/detailed/ - Detailed health with DB + Redis (ADMIN only)

    A DRF view so it authenticates the way the API does. As a plain Django
    `View` it read only the session, and an ADMIN calling with
    `Authorization: Bearer` got 401 (BP-16). Session stays accepted for the
    browsable/admin case. Unauthenticated -> 401 (JWT is first, so DRF answers
    NotAuthenticated with a WWW-Authenticate header); non-ADMIN -> 403.
    """

    authentication_classes = [OfficerJWTAuthentication, SessionAuthentication]
    permission_classes = [IsAdminPermission]
    # Not an API resource; keep it out of the committed OpenAPI document.
    schema = None

    def get(self, request):
        checks = {"database": "ok", "redis": "ok", "status": "ok"}
        status_code = 200

        # DB and Redis checks (no internal details exposed)
        if not database_ok():
            checks["database"] = "error"
            checks["status"] = "degraded"
            status_code = 503
        if not redis_ok():
            checks["redis"] = "error"
            checks["status"] = "degraded"
            status_code = 503

        # Scheduled jobs whose cron should have fired and no run was recorded.
        # Read-time computation (apps/scheduler/services.py::overdue_jobs), so
        # a dead beat — which also kills the beat-driven overdue task — is
        # still visible to an external probe.
        #
        # INFORMATIONAL ONLY: never touches `status` or the status code (user
        # decision 2026-09-17). "database" / "redis" are about whether this
        # process can serve requests, and 503 tells an orchestrator to act on
        # the process; a job that beat has not fired is a different fault in a
        # different container, so it is reported in its own two fields and a
        # probe reads `scheduler` rather than the status code.
        try:
            from apps.scheduler.services import overdue_jobs

            overdue = [job.periodic_task.name for job in overdue_jobs()]
        except Exception:
            checks["scheduler"] = "error"
        else:
            if overdue:
                checks["scheduler"] = "overdue"
                checks["scheduler_overdue"] = overdue
            else:
                checks["scheduler"] = "ok"

        return Response(checks, status=status_code)
