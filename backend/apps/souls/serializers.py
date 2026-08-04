"""
REST serializers for Soul app.
"""
from rest_framework import serializers

from apps.souls.fields import HistoricalDateField
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import SoulRecord


def _is_viewer(context) -> bool:
    """Check if the current user has VIEWER role."""
    request = context.get("request")
    if not request or not request.user:
        return False
    return getattr(request.user, "role", None) == "VIEWER"


class SoulRecordSerializer(serializers.ModelSerializer):
    # Backed by event_year/event_month/event_day (BCE-capable) rather than a
    # single DateField — see apps.souls.fields.HistoricalDateField.
    event_date = HistoricalDateField(prefix="event")

    class Meta:
        model = SoulRecord
        fields = [
            # category/event_date/is_milestone are accepted on write but were
            # not returned, so the karma timeline had no real dates to plot and
            # fell back to recorded_at — collapsing every point in a life onto
            # the day the rows were inserted.
            "id", "record_type", "category", "civilization", "description",
            "weight", "event_date", "is_milestone", "evidence_json", "recorded_at",
        ]
        read_only_fields = ["id", "recorded_at"]


class SoulSerializer(serializers.ModelSerializer):
    karmic_balance = serializers.IntegerField(read_only=True)
    tenant_code = serializers.CharField(source="tenant.code", read_only=True)
    records = SoulRecordSerializer(many=True, read_only=True)
    tenant = serializers.PrimaryKeyRelatedField(read_only=True)
    # Backed by birth_year/birth_month/birth_day and death_year/death_month/
    # death_day (BCE-capable) rather than DateFields — see
    # apps.souls.fields.HistoricalDateField. Still accepts plain
    # "YYYY-MM-DD" strings on write for backward compatibility.
    birth_date = HistoricalDateField(prefix="birth")
    death_date = HistoricalDateField(prefix="death")
    # Soul.civilization is a property derived from the tenant code. The list
    # serializer has always exposed it; the detail serializer did not, so
    # clients that read a soul then POST a judgment (which requires
    # `civilization`) got a 400 back.
    civilization = serializers.CharField(read_only=True)

    # Field-level access control: VIEWER cannot see merit/demerit scores
    merit_score = serializers.SerializerMethodField()
    demerit_score = serializers.SerializerMethodField()

    class Meta:
        model = Soul
        fields = [
            "id", "name", "current_state", "tenant_code", "tenant", "civilization",
            "birth_date", "death_date", "origin_location", "birth_name",
            "description", "merit_score", "demerit_score",
            "karmic_balance", "create_time", "update_time", "records",
        ]
        read_only_fields = ["id", "current_state", "merit_score", "demerit_score", "create_time", "update_time"]

    def get_merit_score(self, obj):
        if _is_viewer(self.context):
            return None  # VIEWER cannot see merit score
        return obj.merit_score

    def get_demerit_score(self, obj):
        if _is_viewer(self.context):
            return None  # VIEWER cannot see demerit score
        return obj.demerit_score

    def to_representation(self, instance):
        # Remove karmic_balance from output for VIEWER (use the computed field name)
        data = super().to_representation(instance)
        if _is_viewer(self.context):
            # Remove karmic_balance field entirely for VIEWER
            data.pop("merit_score", None)
            data.pop("demerit_score", None)
            data.pop("karmic_balance", None)
        return data


class SoulListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views."""
    karmic_balance = serializers.SerializerMethodField()
    tenant_code = serializers.CharField(source="tenant.code", read_only=True)
    civilization = serializers.CharField(read_only=True)
    birth_date = HistoricalDateField(prefix="birth")
    death_date = HistoricalDateField(prefix="death")

    class Meta:
        model = Soul
        fields = [
            "id", "name", "current_state", "tenant_code", "civilization",
            "birth_date", "death_date", "merit_score", "demerit_score",
            "karmic_balance", "create_time",
        ]

    def get_karmic_balance(self, obj):
        if _is_viewer(self.context):
            return None
        return obj.karmic_balance

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if _is_viewer(self.context):
            data.pop("merit_score", None)
            data.pop("demerit_score", None)
            data.pop("karmic_balance", None)
        return data


class SoulTransitionSerializer(serializers.Serializer):
    """Serializer for state transition requests."""
    new_state = serializers.ChoiceField(choices=SoulState.choices)
    reason = serializers.CharField(max_length=500, required=False, default="")
