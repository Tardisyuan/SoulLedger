"""
REST serializers for Karma app.
"""
from rest_framework import serializers
from apps.souls.models import Soul


class KarmaBalanceSerializer(serializers.Serializer):
    soul_id = serializers.UUIDField()
    soul_name = serializers.CharField()
    merit_score = serializers.IntegerField()
    demerit_score = serializers.IntegerField()
    karmic_balance = serializers.IntegerField()
    record_count = serializers.IntegerField()
