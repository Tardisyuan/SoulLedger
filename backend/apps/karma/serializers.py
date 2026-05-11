"""
REST serializers for Karma app.
"""
from rest_framework import serializers


class KarmaBalanceSerializer(serializers.Serializer):
    soul_id = serializers.UUIDField()
    soul_name = serializers.CharField()
    merit_score = serializers.IntegerField()
    demerit_score = serializers.IntegerField()
    karmic_balance = serializers.IntegerField()
    record_count = serializers.IntegerField()


class KarmaRecordSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    type = serializers.CharField()
    category = serializers.CharField()
    description = serializers.CharField()
    original_weight = serializers.IntegerField()
    effective_weight = serializers.FloatField()
    years_elapsed = serializers.FloatField()
    decay_factor = serializers.FloatField()
    civilization = serializers.CharField()
    recorded_at = serializers.DateTimeField()
    event_date = serializers.DateField(allow_null=True)


class KarmaSummarySerializer(serializers.Serializer):
    soul_id = serializers.UUIDField()
    soul_name = serializers.CharField()
    merit_score = serializers.IntegerField()
    demerit_score = serializers.IntegerField()
    karmic_balance = serializers.IntegerField()
    record_count = serializers.IntegerField()
    records = KarmaRecordSerializer(many=True)


class EffectiveKarmaSerializer(serializers.Serializer):
    soul_id = serializers.UUIDField()
    effective_merit = serializers.IntegerField()
    effective_demerit = serializers.IntegerField()
    effective_balance = serializers.IntegerField()


class ReincarnationInheritanceSerializer(serializers.Serializer):
    soul_id = serializers.UUIDField()
    inherited_merit = serializers.IntegerField()
    inherited_demerit = serializers.IntegerField()
    inheritance_note = serializers.CharField()
