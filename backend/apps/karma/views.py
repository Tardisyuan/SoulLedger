"""
REST views for Karma app.
"""
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from apps.souls.models import Soul
from apps.karma.services import KarmaService
from apps.core.permissions import TenantPermission


class KarmaBalanceView(APIView):
    """
    GET /karma/{soul_id}/balance/

    Returns karmic summary for a soul. Tenant-isolated.
    """
    permission_classes = [TenantPermission]

    def get(self, request, soul_id):
        try:
            # Filter through TenantManager — thread-local tenant set by middleware
            soul = Soul.objects.get(id=soul_id)
        except Soul.DoesNotExist:
            return Response(
                {"error": "NOT_FOUND", "message": "Soul not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Explicit tenant check at permission layer
        user_tenant = getattr(request, 'tenant', None)
        if user_tenant and soul.tenant and str(soul.tenant.pk) != str(user_tenant.pk):
            return Response(
                {"error": "FORBIDDEN", "message": "Access denied: soul belongs to another tenant"},
                status=status.HTTP_403_FORBIDDEN,
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

        # Explicit tenant check
        user_tenant = getattr(request, 'tenant', None)
        if user_tenant and soul.tenant and str(soul.tenant.pk) != str(user_tenant.pk):
            return Response(
                {"error": "FORBIDDEN", "message": "Access denied: soul belongs to another tenant"},
                status=status.HTTP_403_FORBIDDEN,
            )

        result = KarmaService.recalculate_soul_karma(soul)
        return Response(result)
