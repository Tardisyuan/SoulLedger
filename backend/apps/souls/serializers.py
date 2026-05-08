"""
REST serializers for Soul app.
"""
from rest_framework import serializers
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import SoulRecord


class SoulRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = SoulRecord
        fields = [
            "id", "record_type", "civilization", "description",
            "weight", "evidence_json", "recorded_at",
        ]
        read_only_fields = ["id", "recorded_at"]


class SoulSerializer(serializers.ModelSerializer):
    karmic_balance = serializers.IntegerField(read_only=True)
    records = SoulRecordSerializer(many=True, read_only=True)

    class Meta:
        model = Soul
        fields = [
            "id", "name", "civilization", "current_state",
            "birth_date", "death_date", "origin_location", "birth_name",
            "description", "merit_score", "demerit_score",
            "karmic_balance", "created_at", "updated_at", "records",
        ]
        read_only_fields = ["id", "current_state", "merit_score", "demerit_score", "created_at", "updated_at"]


class SoulListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views."""
    karmic_balance = serializers.IntegerField(read_only=True)

    class Meta:
        model = Soul
        fields = [
            "id", "name", "civilization", "current_state",
            "birth_date", "death_date", "merit_score", "demerit_score",
            "karmic_balance", "created_at",
        ]


class SoulTransitionSerializer(serializers.Serializer):
    """Serializer for state transition requests."""
    new_state = serializers.ChoiceField(choices=SoulState.choices)
    reason = serializers.CharField(max_length=500, required=False, default="")
