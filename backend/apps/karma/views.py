"""
REST views for Karma app.
"""
import csv
import io
from django.db.models import Count
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.http import HttpResponse

from apps.souls.models import Soul, SoulState, Civilization
from apps.tenants.models import Tenant
from apps.karma.services import KarmaService
from apps.core.permissions import TenantPermission
from apps.audit.models import AuditLog
from apps.disposition.models import Disposition
from apps.realms.models import Realm


class KarmaBalanceView(APIView):
    """
    GET /karma/{soul_id}/balance/

    Returns karmic summary with time-decay for a soul. Cached 5min.
    Tenant-isolated via TenantManager.
    """
    permission_classes = [TenantPermission]

    def get(self, request, soul_id):
        try:
            soul = Soul.objects.get(id=soul_id)
        except Soul.DoesNotExist:
            return Response(
                {"error": "NOT_FOUND", "message": "Soul not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        summary = KarmaService.get_karmic_summary(soul)
        return Response(summary)


class KarmaRecalculateView(APIView):
    """
    POST /karma/{soul_id}/recalculate/

    Recalculates and persists karmic scores for a soul. Tenant-isolated.
    """
    permission_classes = [TenantPermission]

    def post(self, request, soul_id):
        try:
            soul = Soul.objects.get(id=soul_id)
        except Soul.DoesNotExist:
            return Response(
                {"error": "NOT_FOUND", "message": "Soul not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        result = KarmaService.recalculate_soul_karma(soul)
        return Response(result)


class KarmaEffectiveView(APIView):
    """
    GET /karma/{soul_id}/effective/

    Returns effective karma with time decay applied.
    Used for disposition decisions.
    """
    permission_classes = [TenantPermission]

    def get(self, request, soul_id):
        try:
            soul = Soul.objects.get(id=soul_id)
        except Soul.DoesNotExist:
            return Response(
                {"error": "NOT_FOUND", "message": "Soul not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        result = KarmaService.get_effective_karma(soul)
        return Response(result)


class KarmaInheritanceView(APIView):
    """
    GET /karma/{soul_id}/inheritance/

    Returns reincarnation inheritance karma (20% of effective).
    """
    permission_classes = [TenantPermission]

    def get(self, request, soul_id):
        try:
            soul = Soul.objects.get(id=soul_id)
        except Soul.DoesNotExist:
            return Response(
                {"error": "NOT_FOUND", "message": "Soul not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        result = KarmaService.get_reincarnation_inheritance(soul)
        return Response(result)


class KarmaOverviewStatsView(APIView):
    """
    GET /karma/stats/overview/

    Admin-only overview statistics across all tenants.
    Returns: total souls, state distribution, tenant totals, karma range stats,
    recent activity, and souls by realm.
    """
    permission_classes = [TenantPermission]

    def get(self, request):
        user = request.user
        if getattr(user, 'role', None) != 'ADMIN':
            return Response(
                {"error": "FORBIDDEN", "message": "Admin access required"},
                status=status.HTTP_403_FORBIDDEN,
            )

        total_souls = Soul.objects.count()

        # State distribution
        state_counts = dict(
            Soul.objects.values_list("current_state")
            .annotate(count=Count("id"))
            .values_list("current_state", "count")
        )
        state_distribution = [
            {
                "state": s,
                "label": s,
                "count": state_counts.get(s, 0),
            }
            for s in SoulState.values
        ]

        # Per-tenant soul counts
        tenant_stats = []
        for tenant in Tenant.objects.all().exclude(code__startswith="TEST"):
            souls_qs = Soul.objects.filter(tenant=tenant)
            total = souls_qs.count()
            if total == 0:
                continue
            state_breakdown = dict(
                souls_qs.values_list("current_state")
                .annotate(count=Count("id"))
                .values_list("current_state", "count")
            )
            avg_karma = souls_qs.aggregate(
                avg_balance=Count("id")
            )["avg_balance"]
            tenant_stats.append({
                "tenant_code": tenant.code,
                "tenant_name": tenant.display_name,
                "total_souls": total,
                "state_breakdown": {
                    s: state_breakdown.get(s, 0) for s in SoulState.values
                },
            })

        # Karma distribution buckets
        karma_buckets = [
            {"label": "< -50", "min": -99999, "max": -50, "count": 0},
            {"label": "-50 to -20", "min": -50, "max": -20, "count": 0},
            {"label": "-20 to -5", "min": -20, "max": -5, "count": 0},
            {"label": "-5 to 5", "min": -5, "max": 5, "count": 0},
            {"label": "5 to 20", "min": 5, "max": 20, "count": 0},
            {"label": "20 to 50", "min": 20, "max": 50, "count": 0},
            {"label": "> 50", "min": 50, "max": 99999, "count": 0},
        ]
        for soul in Soul.objects.all():
            bal = soul.karmic_balance
            for bucket in karma_buckets:
                if bucket["min"] <= bal < bucket["max"]:
                    bucket["count"] += 1
                    break

        # Recent activity (last 10 audit log entries)
        recent_logs = AuditLog.objects.all()[:10]
        recent_activity = [
            {
                "id": log.id,
                "action": log.action,
                "resource": log.resource,
                "resource_id": log.resource_id,
                "description": log.description,
                "user": log.user.username if log.user else "System",
                "timestamp": log.timestamp.isoformat(),
            }
            for log in recent_logs
        ]

        # Souls by realm/disposition breakdown
        # Get counts of souls with dispositions by realm
        realm_counts = dict(
            Disposition.objects.exclude(is_executed=False)
            .values("destination_realm__realm_code", "destination_realm__name_en")
            .annotate(count=Count("id"))
            .values_list("destination_realm__realm_code", "count")
        )
        # Add executed disposition souls grouped by realm
        executed_realms = {}
        for d in Disposition.objects.filter(is_executed=True).select_related("destination_realm"):
            if d.destination_realm:
                realm_code = d.destination_realm.realm_code
                if realm_code not in executed_realms:
                    executed_realms[realm_code] = {
                        "realm_code": realm_code,
                        "realm_name": d.destination_realm.name_en,
                        "civilization": d.destination_realm.civilization,
                        "count": 0,
                    }
                executed_realms[realm_code]["count"] += 1

        souls_by_realm = list(executed_realms.values())

        return Response({
            "total_souls": total_souls,
            "state_distribution": state_distribution,
            "tenants": tenant_stats,
            "karma_distribution": [
                {"label": b["label"], "count": b["count"]} for b in karma_buckets
            ],
            "recent_activity": recent_activity,
            "souls_by_realm": souls_by_realm,
        })


class KarmaExportStatsView(APIView):
    """
    GET /karma/stats/export/

    Admin-only CSV export of all souls with their karma data.
    """
    permission_classes = [TenantPermission]

    def get(self, request):
        user = request.user
        if getattr(user, 'role', None) != 'ADMIN':
            return Response(
                {"error": "FORBIDDEN", "message": "Admin access required"},
                status=status.HTTP_403_FORBIDDEN,
            )

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = "attachment; filename=souls_karma_export.csv"

        writer = csv.writer(response)
        writer.writerow([
            "Soul ID", "Name", "Civilization", "State",
            "Merit Score", "Demerit Score", "Karmic Balance",
            "Death Date", "Created At"
        ])

        for soul in Soul.objects.select_related("tenant").all():
            writer.writerow([
                str(soul.id),
                soul.name,
                soul.civilization,
                soul.current_state,
                soul.merit_score,
                soul.demerit_score,
                soul.karmic_balance,
                soul.death_date or "",
                soul.created_at.isoformat(),
            ])

        return response
