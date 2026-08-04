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


class HistoricalDateSummarySerializer(serializers.Serializer):
    """Structured (possibly BCE) date, e.g. {"year": -612, "month": 3, "day": None}."""
    year = serializers.IntegerField()
    month = serializers.IntegerField(allow_null=True)
    day = serializers.IntegerField(allow_null=True)


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
    event_date = HistoricalDateSummarySerializer(allow_null=True)
    is_milestone = serializers.BooleanField()


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
    """200 body of GET /karma/inheritance/{soul_id}/.

    Only rebirth-capable civilizations get this shape; a terminal cosmology
    answers 409 with RebirthNotApplicableSerializer instead.
    """
    soul_id = serializers.UUIDField()
    inherited_merit = serializers.IntegerField()
    inherited_demerit = serializers.IntegerField()
    inheritance_note = serializers.CharField()


class RebirthNotApplicableSerializer(serializers.Serializer):
    """409 body of GET /karma/inheritance/{soul_id}/ for a terminal cosmology.

    Egyptian and European souls have no next life, so there is nothing to
    inherit into and no number that would be honest to return. ``code`` is the
    machine-readable part; ``detail`` is prose for a human and is not stable.
    """
    code = serializers.CharField()  # always "REBIRTH_NOT_APPLICABLE"
    civilization = serializers.CharField()
    detail = serializers.CharField()
