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
