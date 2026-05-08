"""
REST views for Karma app.
"""
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.shortcuts import get_object_or_404

from apps.souls.models import Soul
from apps.karma.services import KarmaService


class KarmaBalanceView(APIView):
    def get(self, request, soul_id):
        soul = get_object_or_404(Soul, id=soul_id)
        summary = KarmaService.get_karmic_summary(soul)
        return Response(summary)


class KarmaRecalculateView(APIView):
    def post(self, request, soul_id):
        soul = get_object_or_404(Soul, id=soul_id)
        result = KarmaService.recalculate_soul_karma(soul)
        return Response(result)
