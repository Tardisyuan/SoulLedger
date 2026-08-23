"""
REST serializers for Disposition app.
"""
from rest_framework import serializers

from apps.core.field_permissions import FieldPermissionMixin
from apps.disposition.models import Disposition
from apps.souls.dates import ERROR, check_term_start
from apps.souls.fields import HistoricalDateField


class DispositionSerializer(FieldPermissionMixin, serializers.ModelSerializer):
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    realm_code = serializers.CharField(source="destination_realm.realm_code", read_only=True)
    realm_name = serializers.CharField(source="destination_realm.name_en", read_only=True)
    # Backed by term_start_year/month/day (BCE-capable), the same way a soul's
    # birth_date is — a term that began in 399 BCE is the case the three
    # columns exist for. See apps.souls.fields.HistoricalDateField.
    term_start = HistoricalDateField(prefix="term_start")

    class Meta:
        model = Disposition
        fields = [
            "id", "soul", "soul_name", "judgment", "destination_realm",
            "realm_code", "realm_name", "memory_reset", "is_eternal",
            "sentence_years", "term_start", "is_executed", "executed_at",
            "notes", "created_at",
        ]

    def validate(self, attrs):
        """Refuse a term start that contradicts the soul it is recorded against.

        This is the write path the two rules in `apps.souls.dates` exist for.
        Adding the column and adding its rules in separate passes would leave a
        window in which a contradictory date could be written with nothing
        going red, and a date already in the database is not fixed by a rule
        that arrives later — it is grandfathered past it.

        ERRORs are raised as non-field errors, for the reason
        `apps/souls/serializers.py::_reject_errors` gives: every one of these
        rules is about two facts, and naming one field as the culprit asserts
        which of the two is wrong. `term_start_before_death` may equally be a
        mis-typed death year on the soul.

        Both current rules are ERROR-severity so nothing is dropped here, but
        the filter is written as a filter rather than as `if problems` on
        purpose — `check_term_start` returns `DateProblem`s in the same shape
        the soul and record checks do, and a WARNING added there later must not
        start refusing writes just because this call site never distinguished
        them.
        """
        touches_term_start = "term_start_year" in attrs
        touches_soul = "soul" in attrs
        if not (touches_term_start or touches_soul):
            # A PATCH that mentions neither leaves both alone, exactly as
            # `apps/souls/serializers.py::_touches_dates` does for a soul's
            # dates and for the reason stated there: refusing to let anyone
            # edit this row's `notes` until a pre-existing bad date is fixed
            # turns a data problem into a locked record, and the operator most
            # likely to notice the bad date is the one editing the row.
            #
            # `touches_soul` is here because re-pointing a disposition at a
            # different soul can create the contradiction without the date
            # moving at all — the other half of the pair is what changed.
            return attrs

        if touches_term_start:
            term_start = (
                attrs.get("term_start_year"),
                attrs.get("term_start_month"),
                attrs.get("term_start_day"),
            )
        elif self.instance is not None:
            term_start = (
                self.instance.term_start_year,
                self.instance.term_start_month,
                self.instance.term_start_day,
            )
        else:
            term_start = (None, None, None)

        soul = attrs.get("soul") or (self.instance.soul if self.instance else None)
        if soul is None or term_start[0] is None:
            return attrs

        executed = attrs.get(
            "is_executed",
            self.instance.is_executed if self.instance else False,
        )
        problems = check_term_start(
            term_start,
            (soul.death_year, soul.death_month, soul.death_day),
            soul.current_state,
            term_executed=executed,
        )
        messages = [p.message for p in problems if p.severity == ERROR]
        if messages:
            raise serializers.ValidationError(messages)
        return attrs


class DispositionExecuteSerializer(serializers.Serializer):
    new_identity = serializers.CharField(required=False, default="")
