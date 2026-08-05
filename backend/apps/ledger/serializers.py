"""
REST serializers for Ledger app.
"""
from rest_framework import serializers


class LedgerBalanceSerializer(serializers.Serializer):
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


class LedgerRecordSerializer(serializers.Serializer):
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


class CivilizationReadingSerializer(serializers.Serializer):
    """The reading this soul's cosmology takes off the ledger.

    Four shapes behind one `kind` discriminator, because the cosmologies are
    mechanically different and not one algorithm in three colours — see
    apps/ledger/readings.py. Every field but `kind` and `civilization` is
    optional, and which ones are present is decided by `kind`:

      BALANCE (CHINESE)             balance, merit, demerit
      THRESHOLD (EGYPTIAN)          heart_weight, counterweight,
                                    heavier_than_feather
      GUILT_AND_PENALTY (EUROPEAN)  culpa, culpa_record_count, poena,
                                    poena_unavailable
      UNAVAILABLE (unmapped tenant) reason

    `poena` is always null today and carries `poena_unavailable` explaining
    why: the penalty remaining after absolution is not derivable from anything
    SoulRecord stores. A client must render the absence, not a zero.
    """
    kind = serializers.CharField()
    civilization = serializers.CharField()
    # BALANCE
    balance = serializers.IntegerField(required=False)
    merit = serializers.IntegerField(required=False)
    demerit = serializers.IntegerField(required=False)
    # THRESHOLD
    heart_weight = serializers.IntegerField(required=False)
    counterweight = serializers.IntegerField(required=False)
    heavier_than_feather = serializers.BooleanField(required=False)
    # GUILT_AND_PENALTY
    culpa = serializers.IntegerField(required=False)
    culpa_record_count = serializers.IntegerField(required=False)
    poena = serializers.IntegerField(required=False, allow_null=True)
    poena_unavailable = serializers.CharField(required=False)
    # UNAVAILABLE
    reason = serializers.CharField(required=False)


class LedgerSummarySerializer(serializers.Serializer):
    soul_id = serializers.UUIDField()
    soul_name = serializers.CharField()
    merit_score = serializers.IntegerField()
    demerit_score = serializers.IntegerField()
    # Merit minus demerit: the Chinese instrument, served to every soul. Kept
    # because the rest of the system reads it (Soul.karmic_balance, disposition
    # routing, queryset ordering); `reading` below is what a client should show
    # a user, and it is the only one of the two that knows whose ledger it is.
    karmic_balance = serializers.IntegerField()
    record_count = serializers.IntegerField()
    records = LedgerRecordSerializer(many=True)
    reading = CivilizationReadingSerializer()


class EffectiveLedgerSerializer(serializers.Serializer):
    soul_id = serializers.UUIDField()
    effective_merit = serializers.IntegerField()
    effective_demerit = serializers.IntegerField()
    effective_balance = serializers.IntegerField()


class ReincarnationInheritanceSerializer(serializers.Serializer):
    """200 body of GET /ledger/inheritance/{soul_id}/.

    Only rebirth-capable civilizations get this shape; a terminal cosmology
    answers 409 with RebirthNotApplicableSerializer instead.
    """
    soul_id = serializers.UUIDField()
    inherited_merit = serializers.IntegerField()
    inherited_demerit = serializers.IntegerField()
    inheritance_note = serializers.CharField()


class RebirthNotApplicableSerializer(serializers.Serializer):
    """409 body of GET /ledger/inheritance/{soul_id}/ for a terminal cosmology.

    Egyptian and European souls have no next life, so there is nothing to
    inherit into and no number that would be honest to return. ``code`` is the
    machine-readable part; ``detail`` is prose for a human and is not stable.
    """
    code = serializers.CharField()  # always "REBIRTH_NOT_APPLICABLE"
    civilization = serializers.CharField()
    detail = serializers.CharField()
