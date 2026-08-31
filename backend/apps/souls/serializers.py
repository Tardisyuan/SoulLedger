"""
REST serializers for Soul app.
"""
from rest_framework import serializers

from apps.core.field_permissions import FieldPermissionMixin
from apps.souls.dates import ERROR, WARNING, check_record_date, check_soul_dates
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


def _soul_level_date_problems(obj) -> list[dict]:
    """The soul's own two dates against each other — death_before_birth,
    implausible_lifespan — in get_date_problems's shape, minus the
    acknowledged/acknowledged_by/acknowledged_at trio: both codes here are
    ERROR-severity, and _reject_errors refuses the write that would create
    one before it ever lands (SoulSerializer.validate, SoulViewSet.die), so
    there is never a persisted problem of this kind to acknowledge. One
    can still exist on legacy data written before that check existed —
    `manage.py check_soul_dates` is the audit for exactly that — which is
    why this is worth exposing here rather than assuming it can't happen.

    Cheap on every call site: birth/death are plain columns already loaded
    on any fetched Soul row, so this touches no extra query, list or detail.
    """
    birth = (obj.birth_year, obj.birth_month, obj.birth_day)
    death = (obj.death_year, obj.death_month, obj.death_day)
    return [
        {"severity": p.severity, "code": p.code, "message": p.message}
        for p in check_soul_dates(birth, death)
    ]


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


#: The two Inferno circles no deed can reach, and why. Both carry
#: `aristotle: None` in the EU-INF corpus — Virgil's tripartition at Inf. XI
#: gives them no heading, which is the corpus saying they are not sins of a kind.
NOT_A_DEED_CIRCLES = {
    1: (
        "Limbo (Inf. IV) holds virtuous pagans and the unbaptised — those who "
        "'did not sin, and yet had merit'. It is not a punishment; Virgil is "
        "there himself."
    ),
    6: (
        "The sixth circle punishes a belief held in life — the Epicureans 'who "
        "with the body make the spirit die' (Inf. X.13-15) — not a deed done. "
        "It is also not blasphemy, which is Inf. XIV, the third ring of the "
        "seventh circle."
    ),
}


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
    # Read-only since `SoulRecord.save()` derives it from the soul's tenant.
    # It was writable before that, and it was the **only** thing that ever set
    # it — a client could stamp a Greek soul's record CHINESE and the column
    # would keep that answer, indexed. Silently ignoring the input would be
    # worse than refusing it; DRF drops a read-only field instead of 400-ing,
    # which is the behaviour the API's other derived field
    # (`SoulSerializer.civilization`) already has.
    civilization = serializers.CharField(read_only=True)

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
            # 零積不抵整發's two inputs. Added here rather than left to the admin
            # because a rule that can only be fed through SQL is a rule nobody
            # feeds — and `granularity_of` treats an unfed record as unknown, so
            # the whole of souls/0028 would have been inert on the write path
            # that actually exists.
            "statute_clause", "occurrence_count",
            # Which Inferno article a deed belongs under — see
            # SoulRecord.inferno_article and DispositionService.
            "inferno_article",
        ]
        read_only_fields = ["id", "recorded_at"]

    def validate_statute_clause(self, value):
        """A citation must resolve, or it is worse than a blank.

        `granularity_of` asks only whether the string is non-empty, so an
        unresolvable citation does not fail loudly — it silently promotes a
        record to lump or scattered and lets 零積不抵整發 act on a per-occasion
        value that does not exist. That is the shape of the four proxies
        `apps/ledger/fungibility.py` refused with evidence, arriving through the
        write path instead of through a column.

        The format is `<Statute.code>:<clause condition_zh>` — the clause and
        not the article, because 救濟門#7 carries two granularities in one
        sentence and an article reference cannot say which one scored a deed.
        """
        value = (value or "").strip()
        if not value:
            return ""

        code, _, condition = value.partition(":")
        code, condition = code.strip(), condition.strip()
        if not code or not condition:
            raise serializers.ValidationError(
                "Expected '<statute code>:<clause condition>', e.g. "
                "'救濟門#7:賑濟窮民百錢'. The clause is the unit, not the "
                "article — one article can state several per-occasion values."
            )

        from apps.judgment.models import Statute

        statute = Statute.objects.filter(code=code).first()
        if statute is None:
            raise serializers.ValidationError(
                f"No statute with code {code!r}. A citation that resolves to "
                f"nothing still reads as a granularity to the offset rule, "
                f"which would then apply 零積不抵整發 against a per-occasion "
                f"value nobody can look up."
            )

        clauses = (statute.payload_json or {}).get("clauses") or []
        conditions = [c.get("condition_zh") for c in clauses]
        if condition not in conditions:
            raise serializers.ValidationError(
                f"{code} has no clause {condition!r}. Its clauses are "
                f"{conditions}. Cited by condition text rather than by index "
                f"deliberately: an index silently repoints when the corpus is "
                f"re-transcribed, and the condition is verbatim from 正統道藏 — "
                f"it changes only when the reading of the source changes, which "
                f"is exactly when this reference should break."
            )
        return value

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
                "acknowledged_by": (
                    obj.date_warning_acknowledged_by.username
                    if p.acknowledged and obj.date_warning_acknowledged_by_id
                    else None
                ),
                "acknowledged_at": (
                    obj.date_warning_acknowledged_at.isoformat()
                    if p.acknowledged and obj.date_warning_acknowledged_at
                    else None
                ),
            }
            for p in problems
        ]

    def validate_inferno_article(self, value):
        """A citation must resolve, and must not name a circle that is not a deed.

        `_deepest_cited_circle` reads the circle off the cited Statute, so an
        unresolvable code contributes nothing and silently leaves the soul on
        the culpa ladder — the ladder this field exists to replace. Refusing on
        write is what makes "this deed is classified" mean it.

        LIMBO AND HERESY ARE REFUSED BY NAME. Their articles exist in the corpus
        and carry `aristotle: None`, because Virgil's tripartition at Inf. XI
        gives them no heading: Limbo (Inf. IV) holds those who "did not sin, and
        yet had merit" — it is not a punishment, Virgil is there himself — and
        the sixth circle punishes a belief held in life, not a deed done. Both
        are facts about a person and live on `Soul` as `baptism` and
        `denied_immortality`.

        Accepting them here would let a deed sort a soul into Limbo, which is
        the exact contradiction `tests/test_european_hell_basis.py` pinned: a
        petty fraud landing among the virtuous pagans because its weight was
        small.
        """
        value = (value or "").strip()
        if not value:
            return ""

        from apps.judgment.models import Statute

        statute = Statute.all_objects.filter(code=value).first()
        if statute is None:
            raise serializers.ValidationError(
                f"No Inferno article with code {value!r}. Codes come from the "
                f"seeded EU-INF-* corpus — the nine circles (EU-INF-C1 … C9) "
                f"and their subdivisions (EU-INF-C7-G1, EU-INF-C8-B2, "
                f"EU-INF-C9-Z1 …). An unresolvable citation reads as "
                f"unclassified and leaves the soul on the culpa ladder."
            )

        circle = (statute.payload_json or {}).get("circle")
        if circle in NOT_A_DEED_CIRCLES:
            raise serializers.ValidationError(
                f"{value} is in circle {circle}, which is not something a deed "
                f"can put a soul in. {NOT_A_DEED_CIRCLES[circle]} Record it on "
                f"the soul instead — Soul.baptism for Limbo, "
                f"Soul.denied_immortality for the sixth circle."
            )
        return value

    def validate(self, attrs):
        """Check the event date against the soul, and the granularity pair.

        On an update the soul comes off the instance; a caller that has one
        in hand can pass it in the serializer context. The create path is
        the awkward one and is handled in ``save`` below.

        THE GRANULARITY CHECK LIVES HERE AND NOT IN A SECOND `validate`.
        It was written as one and ruff caught it: a class may define the
        method once, so the later definition silently wins and the earlier
        one never runs. Two `validate` methods is a validator that looks
        present in review and is dead at runtime — the shape this repository
        keeps finding, arriving this time in the fix for it.
        """
        soul = self.context.get("soul") or getattr(self.instance, "soul", None)
        if soul is not None:
            self._check_against_soul(attrs, soul)
        self._check_granularity_pair(attrs)
        return attrs

    def _check_granularity_pair(self, attrs) -> None:
        """The two granularity inputs travel together or not at all.

        `apps.ledger.fungibility.granularity_of` needs both and reads
        either-missing as unknown, so a row carrying a count and no clause is
        not *wrong* — it is inert. That is the problem: an operator who entered
        "12 occasions" sees 12 on the record while the offset rule ignores it,
        which is a screen and a computation disagreeing with nothing to report
        it.

        Deliberately NOT reconciling `points × occurrence_count` against
        `weight`. `SoulRecord.weight` is an operator-supplied significance
        figure (1-100) by its own help text, and `apps/ledger/fungibility.py`
        records in as many words that nothing binds it to a clause's value.
        Requiring the product to match would assert a relationship this system
        has already written down as absent.
        """

        def resolved(field):
            if field in attrs:
                return attrs[field]
            return getattr(self.instance, field, None) if self.instance else None

        clause = (resolved("statute_clause") or "").strip()
        count = resolved("occurrence_count")
        if bool(clause) != (count is not None):
            raise serializers.ValidationError(
                "statute_clause and occurrence_count are the two halves of one "
                "statement and must be given together or left together. One "
                "without the other reads as unknown to the offset rule while "
                "still showing on the record."
            )

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


class SoulSerializer(FieldPermissionMixin, serializers.ModelSerializer):
    """Soul detail. Field access is enforced in two layers, deliberately.

    The hardcoded VIEWER checks below are the floor. FieldPermissionMixin
    reads FieldPermission rows and can only narrow further — it never widens,
    because a DB-driven rule that is the *only* guard fails open: the rules
    live in a management command, and an unseeded database would hand VIEWER
    every field. The floor holds with an empty table.

    The two used to disagree. seed_field_permissions declared VIEWER's
    merit_score and demerit_score `visible=True, read_only=True`, while this
    serializer has always removed them from the payload outright, and
    read_only_fields already made them unwritable for every role — so both
    halves of the seeded rule were inert and the looser text never described
    what shipped. The seed now says visible=False, which is what the code
    does. Widening VIEWER back to seeing scores is a security decision and
    needs to be made deliberately, not inherited from a stale fixture.
    """

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
    # Soul-level date problems (death_before_birth, implausible_lifespan) —
    # see _soul_level_date_problems. Distinct from each record's own
    # date_problems in `records` below, which is about that record's event
    # date against this soul, not the soul's two dates against each other.
    # A client rendering "everything wrong with this soul's dates" needs
    # both lists.
    date_problems = serializers.SerializerMethodField()

    class Meta:
        model = Soul
        fields = [
            "id", "name", "current_state", "tenant_code", "tenant", "civilization",
            "birth_date", "death_date", "origin_location", "birth_name",
            "description", "merit_score", "demerit_score",
            "karmic_balance", "create_time", "update_time", "records",
            "date_problems",
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

    def get_date_problems(self, obj):
        return _soul_level_date_problems(obj)

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
    # Same shape and same cost-free reasoning as SoulSerializer.date_problems
    # above — see _soul_level_date_problems. This is what lets the list page
    # mark a soul without an extra per-row request.
    date_problems = serializers.SerializerMethodField()
    # Record-level (`event_after_death`) rather than soul-level, and
    # collapsed to a bool because a list row has no room for a per-record
    # breakdown. Also free: SoulViewSet.get_queryset prefetch_related's
    # "records" for every action, list included, so `obj.records.all()`
    # here hits the prefetch cache rather than issuing a query per soul.
    has_date_warning = serializers.SerializerMethodField()
    # Record-level ERROR (`event_before_birth`) — the counterpart gap to
    # has_date_warning above. Rare for the same reason _soul_level_date_
    # problems documents (the write that would create one is refused
    # before it lands), but "rare" is not "impossible": legacy data
    # written before that check existed can still carry one, and the list
    # marker should not silently miss it just because the common case
    # doesn't produce it.
    has_record_error = serializers.SerializerMethodField()

    class Meta:
        model = Soul
        fields = [
            "id", "name", "current_state", "tenant_code", "civilization",
            "birth_date", "death_date", "merit_score", "demerit_score",
            "karmic_balance", "create_time", "date_problems", "has_date_warning",
            "has_record_error",
        ]

    def get_karmic_balance(self, obj):
        if _is_viewer(self.context):
            return None
        return obj.karmic_balance

    def get_date_problems(self, obj):
        return _soul_level_date_problems(obj)

    def get_has_date_warning(self, obj):
        birth = (obj.birth_year, obj.birth_month, obj.birth_day)
        death = (obj.death_year, obj.death_month, obj.death_day)
        for record in obj.records.all():
            event = (record.event_year, record.event_month, record.event_day)
            problems = check_record_date(
                event, birth, death,
                ack_fingerprint=record.date_warning_ack_fingerprint or None,
            )
            if any(p.severity == WARNING and not p.acknowledged for p in problems):
                return True
        return False

    def get_has_record_error(self, obj):
        birth = (obj.birth_year, obj.birth_month, obj.birth_day)
        death = (obj.death_year, obj.death_month, obj.death_day)
        for record in obj.records.all():
            event = (record.event_year, record.event_month, record.event_day)
            problems = check_record_date(
                event, birth, death,
                ack_fingerprint=record.date_warning_ack_fingerprint or None,
            )
            if any(p.severity == ERROR for p in problems):
                return True
        return False

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
