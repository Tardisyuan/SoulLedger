"""
REST serializers for Soul app.
"""
from rest_framework import serializers

from apps.souls.dates import ERROR, check_record_date, check_soul_dates
from apps.souls.fields import HistoricalDateField
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import SoulRecord


def _is_viewer(context) -> bool:
    """Check if the current user has VIEWER role."""
    request = context.get("request")
    if not request or not request.user:
        return False
    return getattr(request.user, "role", None) == "VIEWER"


def _date_after_write(attrs, instance, prefix) -> tuple:
    """The (year, month, day) this record will have once ``attrs`` is applied.

    HistoricalDateField has ``source="*"`` and writes all three columns
    together, so the presence of ``<prefix>_year`` in attrs is a reliable
    test of whether the client sent that date at all. When it did not — a
    PATCH touching only the name — the stored value stands, and the rules
    still have to see it: otherwise editing a soul's name would validate its
    birth date against an absent death date and pass everything.
    """
    if f"{prefix}_year" in attrs:
        return (
            attrs.get(f"{prefix}_year"),
            attrs.get(f"{prefix}_month"),
            attrs.get(f"{prefix}_day"),
        )
    if instance is None:
        return (None, None, None)
    return (
        getattr(instance, f"{prefix}_year"),
        getattr(instance, f"{prefix}_month"),
        getattr(instance, f"{prefix}_day"),
    )


def _touches_dates(attrs, instance, *prefixes) -> bool:
    """Is this write setting any of these dates?

    A create always counts — there is no stored value to leave alone. On an
    update, a PATCH that never mentions a date is left alone deliberately.
    If a soul already carries dates that contradict each other, refusing to
    let anyone edit its *name* until they are fixed turns a data problem into
    a locked record, and the operator most likely to notice the bad dates is
    the one editing that soul. Any write that does touch a date is checked
    against the other one, stored or new, so nothing gets in this way.
    """
    if instance is None:
        return True
    return any(f"{prefix}_year" in attrs for prefix in prefixes)


def _reject_errors(problems) -> None:
    """Turn ERROR-severity date problems into a 400; let WARNINGs through.

    Warnings describe things that are unusual but genuinely possible — a
    posthumous record, above all — so the API must not refuse them. They are
    the `check_soul_dates` management command's business, which reports
    without blocking anyone.

    Raised as non-field errors rather than pinned to one date field. Every
    one of these rules is about a *pair* of dates, and naming a single
    culprit ("death_date is wrong") would assert something the rule cannot
    know: when a lifespan comes out at 511 years, either end may be the
    mistake. The messages name both dates so the operator can go and look.
    """
    messages = [p.message for p in problems if p.severity == ERROR]
    if messages:
        raise serializers.ValidationError(messages)


class SoulRecordSerializer(serializers.ModelSerializer):
    # Backed by event_year/event_month/event_day (BCE-capable) rather than a
    # single DateField — see apps.souls.fields.HistoricalDateField.
    event_date = HistoricalDateField(prefix="event")
    # DateProblem is a NamedTuple, not a model row — there is no persistent
    # "problem" to serialize, so this is computed fresh from the record's
    # own dates against its soul's on every read. Includes `acknowledged`,
    # which is only ever True when the stored fingerprint still matches —
    # see apps.souls.dates.check_record_date / date_warning_fingerprint.
    date_problems = serializers.SerializerMethodField()

    class Meta:
        model = SoulRecord
        fields = [
            # category/event_date/is_milestone are accepted on write but were
            # not returned, so the karma timeline had no real dates to plot and
            # fell back to recorded_at — collapsing every point in a life onto
            # the day the rows were inserted.
            "id", "record_type", "category", "civilization", "description",
            "weight", "event_date", "is_milestone", "evidence_json", "recorded_at",
            "date_problems",
        ]
        read_only_fields = ["id", "recorded_at"]

    def get_date_problems(self, obj):
        soul = obj.soul
        event = (obj.event_year, obj.event_month, obj.event_day)
        birth = (soul.birth_year, soul.birth_month, soul.birth_day)
        death = (soul.death_year, soul.death_month, soul.death_day)
        problems = check_record_date(
            event, birth, death,
            ack_fingerprint=obj.date_warning_ack_fingerprint or None,
        )
        return [
            {
                "severity": p.severity,
                "code": p.code,
                "message": p.message,
                "acknowledged": p.acknowledged,
            }
            for p in problems
        ]

    def validate(self, attrs):
        """Check the event date against the soul, when the soul is known here.

        On an update the soul comes off the instance; a caller that has one
        in hand can pass it in the serializer context. The create path is
        the awkward one and is handled in ``save`` below.
        """
        soul = self.context.get("soul") or getattr(self.instance, "soul", None)
        if soul is not None:
            self._check_against_soul(attrs, soul)
        return attrs

    def save(self, **kwargs):
        """
        SoulViewSet.add_record supplies the soul as a save() keyword rather
        than in the posted data, so on creation ``validate`` above ran with
        no soul to compare against — this is the first moment the record and
        its soul are both in hand. Re-checking here rather than making the
        soul a writable field keeps the API shape unchanged: clients POST to
        /souls/<id>/add_record/ and the URL says which soul it is.
        """
        soul = kwargs.get("soul")
        if soul is not None:
            self._check_against_soul(self.validated_data, soul)
        return super().save(**kwargs)

    def _check_against_soul(self, attrs, soul) -> None:
        if not _touches_dates(attrs, self.instance, "event"):
            return
        _reject_errors(check_record_date(
            _date_after_write(attrs, self.instance, "event"),
            (soul.birth_year, soul.birth_month, soul.birth_day),
            (soul.death_year, soul.death_month, soul.death_day),
        ))


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

    def validate(self, attrs):
        """Birth and death have to make sense together — see apps.souls.dates.

        HistoricalDateField already rejects a date that is not a real
        calendar date; this is the layer above, where two valid dates are
        wrong about each other.

        Changing a soul's dates can also strand its existing records outside
        the new lifetime, and that is not checked here. Blocking it would
        deadlock the only sane repair order — you cannot fix a soul whose
        dates are wrong without first fixing records that are only wrong
        because the soul's dates are. `manage.py check_soul_dates` reports
        the mismatch instead.
        """
        if not _touches_dates(attrs, self.instance, "birth", "death"):
            return attrs
        _reject_errors(check_soul_dates(
            _date_after_write(attrs, self.instance, "birth"),
            _date_after_write(attrs, self.instance, "death"),
        ))
        return attrs

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
