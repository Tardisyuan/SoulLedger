"""
REST views for Ledger app.
"""
import csv

from django.db.models import Count, F, Q
from django.http import HttpResponse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditLog
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.disposition.models import Disposition
from apps.ledger.services import LedgerService, RebirthNotApplicable
from apps.souls.models import Soul, SoulState


def _format_death_date(soul: Soul) -> str:
    """CSV-friendly death date, preserving BCE years the legacy
    soul.death_date property can't represent. year-month-day / year-month
    / year, zero-padded to 4 digits (sign kept for BCE)."""
    if soul.death_year is None:
        return ""
    parts = [f"{soul.death_year:05d}" if soul.death_year < 0 else f"{soul.death_year:04d}"]
    if soul.death_month is not None:
        parts.append(f"{soul.death_month:02d}")
        if soul.death_day is not None:
            parts.append(f"{soul.death_day:02d}")
    return "-".join(parts)


class LedgerBalanceView(APIView):
    """
    GET /ledger/balance/{soul_id}/

    Returns the ledger summary with time-decay for a soul. Cached 5min.
    Tenant-isolated via TenantManager.

    The body carries both `karmic_balance` (merit minus demerit, which is the
    Chinese instrument and is what the rest of the system routes on) and
    `reading` — the instrument this soul's own cosmology uses. Clients that
    show a user a number should show `reading`; see apps/ledger/readings.py.

    Decay is per-civilization: EUROPEAN deeds do not decay at all, because the
    published European heading promises reduction by contrition and act rather
    than by elapsed time. See CIVILIZATION_DECAY_RATE.
    """
    permission_classes = [TenantPermission, CodenamePermission]

    def get_required_permissions(self):
        return ['ledger.read']

    def get(self, request, soul_id):
        tenant = getattr(request, 'tenant', None)
        try:
            soul = Soul.objects.get(id=soul_id, tenant=tenant)
        except Soul.DoesNotExist:
            return Response(
                {"error": "NOT_FOUND", "message": "Soul not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        summary = LedgerService.get_ledger_summary(soul)
        return Response(summary)


class LedgerRecalculateView(APIView):
    """
    POST /ledger/calculate/{soul_id}/

    Recalculates and persists ledger scores for a soul. Tenant-isolated.
    """
    permission_classes = [TenantPermission, CodenamePermission]

    def get_required_permissions(self):
        # Was 'karma.update' — a codename that exists nowhere: not in
        # DEFAULT_PERMISSIONS, not in any ROLE_PERMISSIONS list. An undefined
        # codename resolves to False for every non-ADMIN role, so declaring it
        # meant "ADMIN only". Recalculating is a write to the ledger, and the
        # write codename this app defines is ledger.manage, so use that.
        return ['ledger.manage']

    def post(self, request, soul_id):
        tenant = getattr(request, 'tenant', None)
        try:
            soul = Soul.objects.get(id=soul_id, tenant=tenant)
        except Soul.DoesNotExist:
            return Response(
                {"error": "NOT_FOUND", "message": "Soul not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        result = LedgerService.recalculate_soul_ledger(soul)
        return Response(result)


class LedgerEffectiveView(APIView):
    """
    GET /ledger/effective/{soul_id}/

    Returns the effective ledger with time decay applied.
    Used for disposition decisions.
    """
    permission_classes = [TenantPermission, CodenamePermission]

    def get_required_permissions(self):
        return ['ledger.read']

    def get(self, request, soul_id):
        tenant = getattr(request, 'tenant', None)
        try:
            soul = Soul.objects.get(id=soul_id, tenant=tenant)
        except Soul.DoesNotExist:
            return Response(
                {"error": "NOT_FOUND", "message": "Soul not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        result = LedgerService.get_effective_ledger(soul)
        return Response(result)


class LedgerInheritanceView(APIView):
    """
    GET /ledger/inheritance/{soul_id}/

    Returns the ledger a soul carries into its next life: merit at
    LedgerService.INHERITANCE_MERIT, demerit at INHERITANCE_DEMERIT.

    409 REBIRTH_NOT_APPLICABLE for a soul whose cosmology is terminal
    (EGYPTIAN, EUROPEAN) — there is no next life to inherit into.
    """
    permission_classes = [TenantPermission, CodenamePermission]

    def get_required_permissions(self):
        return ['ledger.read']

    def get(self, request, soul_id):
        tenant = getattr(request, 'tenant', None)
        try:
            soul = Soul.objects.get(id=soul_id, tenant=tenant)
        except Soul.DoesNotExist:
            return Response(
                {"error": "NOT_FOUND", "message": "Soul not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # RebirthNotApplicable is an APIException, so DRF would render it
        # correctly on its own. Caught here anyway so the 409 body is written
        # where the endpoint's other error shapes are, and so it stays a
        # machine-readable {code, civilization, detail} rather than whatever
        # the default renderer happens to do with it.
        try:
            result = LedgerService.get_reincarnation_inheritance(soul)
        except RebirthNotApplicable as exc:
            return Response(exc.detail, status=exc.status_code)
        return Response(result)


class LedgerOverviewStatsView(APIView):
    """
    GET /ledger/stats/overview/

    Admin-only overview statistics across all tenants.
    Returns: total souls, state distribution, tenant totals, ledger range stats,
    recent activity, and souls by realm.
    """
    permission_classes = [TenantPermission, CodenamePermission]

    def get_required_permissions(self):
        return ['ledger.read']

    def get(self, request):
        user = request.user
        if getattr(user, 'role', None) != 'ADMIN':
            return Response(
                {"error": "FORBIDDEN", "message": "Admin access required"},
                status=status.HTTP_403_FORBIDDEN,
            )

        tenant = getattr(request, 'tenant', None)

        # ADMIN without tenant: show all souls
        soul_qs = Soul.objects.all() if tenant is None else Soul.objects.filter(tenant=tenant)

        # S-H3: All queries scoped to tenant
        total_souls = soul_qs.count()

        # State distribution
        state_counts = dict(
            soul_qs.values_list("current_state")
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

        # Per-tenant soul counts with state breakdown (single query, no N+1)
        tenant_state_data = (
            soul_qs
            .values('tenant', 'tenant__code', 'tenant__display_name', 'current_state')
            .annotate(count=Count('id'))
            .order_by('tenant__code')
        )

        # Build tenant stats from aggregated data
        tenant_map: dict = {}
        for row in tenant_state_data:
            tid = row['tenant']
            if tid not in tenant_map:
                tenant_map[tid] = {
                    "tenant_id": tid,
                    "tenant_code": row['tenant__code'],
                    "tenant_name": row['tenant__display_name'],
                    "total_souls": 0,
                    "state_breakdown": {s: 0 for s in SoulState.values},
                }
            tenant_map[tid]["total_souls"] += row['count']
            tenant_map[tid]["state_breakdown"][row['current_state']] = row['count']

        tenant_stats = [v for v in tenant_map.values() if v['total_souls'] > 0]

        # Karma distribution buckets - scoped to tenant (S-H3)
        karma_buckets = [
            {"label": "< -50", "min": -99999, "max": -50},
            {"label": "-50 to -20", "min": -50, "max": -20},
            {"label": "-20 to -5", "min": -20, "max": -5},
            {"label": "-5 to 5", "min": -5, "max": 5},
            {"label": "5 to 20", "min": 5, "max": 20},
            {"label": "20 to 50", "min": 20, "max": 50},
            {"label": "> 50", "min": 50, "max": 99999},
        ]
        bucket_counts = {}
        for i, b in enumerate(karma_buckets):
            # karmic_balance = merit_score - demerit_score, expressed via F()
            bucket_counts[f'bucket_{i}'] = Count(
                'id',
                filter=Q(merit_score__gte=F('demerit_score') + b['min']) &
                       Q(merit_score__lt=F('demerit_score') + b['max'])
            )
        bucket_result = soul_qs.aggregate(**bucket_counts)
        for i, b in enumerate(karma_buckets):
            b["count"] = bucket_result.get(f'bucket_{i}', 0)

        # S-C2: Recent activity filtered to current tenant only
        audit_qs = AuditLog.objects.all() if tenant is None else AuditLog.objects.filter(tenant=tenant)
        recent_logs = audit_qs.select_related("user").order_by("-timestamp")[:10]
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

        # Souls by realm/disposition breakdown - scoped to tenant (S-H3)
        executed_realms = {}
        disp_qs = Disposition.objects.all() if tenant is None else Disposition.objects.filter(tenant=tenant)
        for d in disp_qs.filter(is_executed=True).select_related("destination_realm").only("destination_realm__realm_code", "destination_realm__name_en", "destination_realm__civilization"):
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


class LedgerExportStatsView(APIView):
    """
    GET /ledger/stats/export/

    Admin-only CSV export of all souls with their ledger data.

    The `role != 'ADMIN'` check below is still the gate that makes this
    admin-only. `ledger.read` is now genuinely enforced by CodenamePermission,
    but every one of the five roles holds it, so the codename alone would let
    a VIEWER export every soul in the tenant. Replacing the hardcoded check
    needs a codename that says "export" — that is a policy decision and a new
    grant, not part of moving enforcement into DRF.
    """
    permission_classes = [TenantPermission, CodenamePermission]

    def get_required_permissions(self):
        return ['ledger.read']

    def get(self, request):
        user = request.user
        if getattr(user, 'role', None) != 'ADMIN':
            return Response(
                {"error": "FORBIDDEN", "message": "Admin access required"},
                status=status.HTTP_403_FORBIDDEN,
            )

        response = HttpResponse(content_type="text/csv")
        # Matches the name the dashboard's blob download writes. The anchor's
        # download attribute wins over this header for the in-app path, so the
        # two disagreeing would only show up for someone calling the endpoint
        # directly — which is exactly the case nobody would notice.
        response["Content-Disposition"] = "attachment; filename=souls_ledger_export.csv"

        writer = csv.writer(response)
        writer.writerow([
            "Soul ID", "Name", "Civilization", "State",
            "Merit Score", "Demerit Score", "Karmic Balance",
            "Death Date", "Created At"
        ])

        tenant = getattr(request, 'tenant', None)
        # Admin exports all souls, others export only their tenant's souls
        if getattr(user, 'role', None) == 'ADMIN':
            qs = Soul.objects.select_related("tenant").all()
        else:
            qs = Soul.objects.select_related("tenant").filter(tenant=tenant) if tenant else Soul.objects.none()
        # Use iterator() to stream results without loading all into memory
        for soul in qs.iterator(chunk_size=1000):
            writer.writerow([
                str(soul.id),
                soul.name,
                soul.civilization,
                soul.current_state,
                soul.merit_score,
                soul.demerit_score,
                soul.karmic_balance,
                # soul.death_date (the legacy property) reads back as blank
                # for BCE deaths, so build the CSV cell from the raw
                # year/month/day instead — e.g. "-612-03" for a
                # year+month-only BCE record.
                _format_death_date(soul),
                soul.create_time.isoformat(),
            ])

        return response
