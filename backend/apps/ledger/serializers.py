"""Doc-only serializers for the ledger endpoints.

The six views in apps/ledger/views.py are `APIView`s that return dicts built
by `LedgerService` and `apps.ledger.readings`. Nothing here is instantiated at
runtime — see apps/core/schema.py for what that means and what it costs.

Every shape below was read off the function that builds it:
`LedgerService.get_ledger_summary`, `.recalculate_soul_ledger`,
`.get_effective_ledger`, `.get_reincarnation_inheritance`,
`readings.get_civilization_reading`, `fungibility.offset_within_classes`, and
`LedgerOverviewStatsView.get` itself.
"""
from drf_spectacular.utils import PolymorphicProxySerializer, extend_schema_field
from rest_framework import serializers


class LedgerErrorSerializer(serializers.Serializer):
    """`{"error": "NOT_FOUND", "message": "Soul not found"}`.

    Two members, not one: `error` here is a machine code (NOT_FOUND,
    FORBIDDEN) and `message` is the prose. That is a different body from the
    `{"error": "<sentence>"}` the perm and auth views emit, which is why
    apps/core/schema.py's ErrorResponseSerializer is not reused — a client
    that printed this one's `error` would show the operator the word
    "NOT_FOUND".
    """

    error = serializers.CharField()
    message = serializers.CharField()


# ── The reading: one shape per cosmology ─────────────────────────────────


class FungibilityClassTotalSerializer(serializers.Serializer):
    """One offsetting pool. `_tidy` keeps whole numbers whole and 半功 at 0.5,
    so every member here is a number that may or may not be an integer."""

    merit = serializers.FloatField()
    demerit = serializers.FloatField()
    offset = serializers.FloatField()
    unoffset_demerit = serializers.FloatField()
    unusable_merit = serializers.FloatField()


class NonFungibleSerializer(serializers.Serializer):
    """`offset_within_classes` — 功過有不可折者, netted per class.

    `by_class` is keyed by fungibility class name, not a list: the classes are
    derived from record categories and the caller looks one up rather than
    scanning.

    `granularity_applied` False does not mean the rule was tested and did not
    bite — `granularity_unavailable` is the sentence saying why, and it is
    always present for exactly that reason.
    """

    by_class = serializers.DictField(child=FungibilityClassTotalSerializer())
    unoffset_demerit = serializers.FloatField()
    unusable_merit = serializers.FloatField()
    rule_zh = serializers.CharField()
    rule_source = serializers.CharField()
    attested_classes = serializers.ListField(child=serializers.CharField())
    granularity_rule_zh = serializers.CharField()
    granularity_applied = serializers.BooleanField()
    granularity_unavailable = serializers.CharField()
    granularity_missing_inputs = serializers.ListField(child=serializers.CharField())


class BalanceReadingSerializer(serializers.Serializer):
    """kind=BALANCE — the Chinese 功過格 account."""

    kind = serializers.CharField()
    civilization = serializers.CharField()
    balance = serializers.IntegerField()
    merit = serializers.IntegerField()
    demerit = serializers.IntegerField()
    # Absent, not null, when `_chinese_reading` was given no class totals —
    # the key is only assigned inside `if class_totals is not None`. The live
    # path (`get_ledger_summary`) always passes them.
    non_fungible = NonFungibleSerializer(required=False)


class ThresholdReadingSerializer(serializers.Serializer):
    """kind=THRESHOLD — the Egyptian weighing. No merit member: the scale
    does not subtract, and `heart_weight` is the demerit total alone."""

    kind = serializers.CharField()
    civilization = serializers.CharField()
    heart_weight = serializers.IntegerField()
    counterweight = serializers.IntegerField()
    heavier_than_feather = serializers.BooleanField()


class GuiltAndPenaltyReadingSerializer(serializers.Serializer):
    """kind=GUILT_AND_PENALTY — the European culpa/poena pair.

    `poena` is null in every response this code can currently produce:
    `_european_reading` assigns `None` unconditionally, because the three
    facts it presupposes are not recorded anywhere. `poena_missing` names
    them, and is non-empty for exactly as long as `poena` is null.
    """

    kind = serializers.CharField()
    civilization = serializers.CharField()
    culpa = serializers.IntegerField()
    culpa_record_count = serializers.IntegerField()
    poena = serializers.IntegerField(allow_null=True)
    poena_missing = serializers.ListField(child=serializers.CharField())


class SentenceReadingSerializer(serializers.Serializer):
    """kind=SENTENCE — Republic X's two roads.

    `wrongs` and `benefactions` are deed counts, and nothing in this payload
    relates them to `repayment_multiple`: tenfold is owed per deed, not a
    total. `elapsed_years` is whole years (`sentence_elapsed_years -> int |
    None`), null when no term start is recorded, and `elapsed_missing` is
    non-empty for exactly that long.
    """

    kind = serializers.CharField()
    civilization = serializers.CharField()
    wrongs = serializers.IntegerField()
    benefactions = serializers.IntegerField()
    repayment_multiple = serializers.IntegerField()
    circuit_years = serializers.IntegerField()
    elapsed_years = serializers.IntegerField(allow_null=True)
    elapsed_missing = serializers.ListField(child=serializers.CharField())


class UnavailableReadingSerializer(serializers.Serializer):
    """kind=UNAVAILABLE — the tenant's civilization is not mapped, so this
    ledger gets no reading rather than a guessed one. `reason_code` is a
    state (TENANT_NOT_MAPPED); the remedy is the client's copy."""

    kind = serializers.CharField()
    civilization = serializers.CharField()
    reason_code = serializers.CharField()


@extend_schema_field(
    PolymorphicProxySerializer(
        component_name="LedgerReading",
        # The MAPPING form (a dict), not the list form, and the difference is
        # not cosmetic. Given a list, drf-spectacular derives each mapping key
        # by calling `to_representation(None)` on the sub-serializer's `kind`
        # field — which for a plain CharField is the string "None". Measured:
        # every one of the five collapsed onto a single mapping entry,
        # `{"None": "#/components/schemas/UnavailableReading"}`, so a
        # generated client would have resolved every reading to the
        # UNAVAILABLE shape. The document said `oneOf` five and the
        # discriminator said one.
        #
        # Keys here are the literals `readings.py` writes into `kind`.
        serializers={
            "BALANCE": BalanceReadingSerializer,
            "THRESHOLD": ThresholdReadingSerializer,
            "GUILT_AND_PENALTY": GuiltAndPenaltyReadingSerializer,
            "SENTENCE": SentenceReadingSerializer,
            "UNAVAILABLE": UnavailableReadingSerializer,
        },
        resource_type_field_name="kind",
    )
)
class LedgerReadingField(serializers.JSONField):
    """The five readings, discriminated on `kind`.

    One shape for all of them was the thing apps/ledger/readings.py exists to
    undo, so the document must not flatten them back into one object either.
    The union is what makes a generated client narrow on `kind` instead of
    treating every member as optional.
    """


class LedgerRecordEventDateSerializer(serializers.Serializer):
    """`{year, month, day}` — never an ISO string. `year` can be negative
    (BCE) and month/day are routinely unknown for ancient records, which is
    the whole reason this is structured. See apps.souls.dates."""

    year = serializers.IntegerField()
    month = serializers.IntegerField(allow_null=True)
    day = serializers.IntegerField(allow_null=True)


class LedgerRecordSummarySerializer(serializers.Serializer):
    """One row of `records` in the balance payload."""

    id = serializers.UUIDField()
    # `type` on the wire; the column is `record_type`.
    type = serializers.CharField()
    category = serializers.CharField()
    fungibility_class = serializers.CharField()
    description = serializers.CharField()
    original_weight = serializers.IntegerField()
    # Rounded to 2dp for display. The TOTAL is not the sum of these — it
    # accumulates unrounded and rounds once; see get_ledger_summary.
    effective_weight = serializers.FloatField()
    years_elapsed = serializers.FloatField()
    decay_factor = serializers.FloatField()
    civilization = serializers.CharField()
    recorded_at = serializers.DateTimeField()
    event_date = LedgerRecordEventDateSerializer(allow_null=True)
    is_milestone = serializers.BooleanField()


class LedgerSummarySerializer(serializers.Serializer):
    """200 body of `LedgerBalanceView`.

    `karmic_balance` is merit minus demerit — the Chinese instrument, served
    to every civilization because it is also a Soul column that querysets
    sort on. `reading` is the instrument this soul's own cosmology uses, and
    is what a client should show a person.
    """

    soul_id = serializers.UUIDField()
    soul_name = serializers.CharField()
    merit_score = serializers.IntegerField()
    demerit_score = serializers.IntegerField()
    karmic_balance = serializers.IntegerField()
    record_count = serializers.IntegerField()
    records = LedgerRecordSummarySerializer(many=True)
    reading = LedgerReadingField()


class LedgerRecalculateResultSerializer(serializers.Serializer):
    """200 body of `LedgerRecalculateView` — the denormalised columns as
    they stand after the write, not the decayed sums that produced them."""

    soul_id = serializers.UUIDField()
    merit_score = serializers.IntegerField()
    demerit_score = serializers.IntegerField()
    karmic_balance = serializers.IntegerField()


class LedgerEffectiveSerializer(serializers.Serializer):
    """200 body of `LedgerEffectiveView`. Same three numbers as the summary's
    merit/demerit/balance, under names that say they are decay-applied."""

    soul_id = serializers.UUIDField()
    effective_merit = serializers.IntegerField()
    effective_demerit = serializers.IntegerField()
    effective_balance = serializers.IntegerField()


class LedgerInheritanceSerializer(serializers.Serializer):
    """200 body of `LedgerInheritanceView`.

    The two rates are the fractions the arithmetic above them used, not the
    20/100 percentages a card draws with. Shipping the same float makes it
    impossible for the displayed rate and the applied rate to disagree —
    which is a failure this codebase has already had once.
    """

    soul_id = serializers.UUIDField()
    inherited_merit = serializers.IntegerField()
    inherited_demerit = serializers.IntegerField()
    inheritance_merit_rate = serializers.FloatField()
    inheritance_demerit_rate = serializers.FloatField()


class RebirthNotApplicableSerializer(serializers.Serializer):
    """409 body of `LedgerInheritanceView` — `RebirthNotApplicable.detail`.

    409 and not 404: the soul reads back fine, it is the operation its
    cosmology forbids. `detail` is prose from TERMINAL_COSMOLOGY_REASON;
    `code` is the member to branch on.
    """

    code = serializers.CharField()
    civilization = serializers.CharField()
    detail = serializers.CharField()


# ── Overview statistics ──────────────────────────────────────────────────


class SoulStateDistributionSerializer(serializers.Serializer):
    """`label` is the raw state member today, same value as `state` — the
    view assigns `"label": s` beside `"state": s`. Localising is the
    client's job and this endpoint has no locale."""

    state = serializers.CharField()
    label = serializers.CharField()
    count = serializers.IntegerField()


class TenantSoulStatsSerializer(serializers.Serializer):
    tenant_id = serializers.IntegerField()
    tenant_code = serializers.CharField()
    tenant_name = serializers.CharField()
    total_souls = serializers.IntegerField()
    # Keyed by SoulState member; every member is present, zeros included.
    state_breakdown = serializers.DictField(child=serializers.IntegerField())


class KarmaBucketSerializer(serializers.Serializer):
    """Only label and count reach the wire — the `min`/`max` bounds the view
    computes with are not emitted. The end buckets are unbounded, so the
    counts always sum to `total_souls`."""

    label = serializers.CharField()
    count = serializers.IntegerField()


class RecentActivitySerializer(serializers.Serializer):
    """An AuditLog row flattened. `user` is the username or the literal
    string "System" for a row with no user — not null."""

    id = serializers.IntegerField()
    action = serializers.CharField()
    resource = serializers.CharField()
    resource_id = serializers.CharField()
    description = serializers.CharField()
    user = serializers.CharField()
    timestamp = serializers.DateTimeField()


class SoulsByRealmSerializer(serializers.Serializer):
    """Executed, non-archived dispositions with a destination realm."""

    realm_code = serializers.CharField()
    realm_name = serializers.CharField()
    civilization = serializers.CharField()
    count = serializers.IntegerField()


class LedgerOverviewStatsSerializer(serializers.Serializer):
    """200 body of `LedgerOverviewStatsView`.

    `karma_distribution_total` is emitted rather than assumed: it always
    equals `total_souls` because the buckets partition the whole line, and
    it exists so a reader can check that without re-deriving the bounds.
    """

    total_souls = serializers.IntegerField()
    state_distribution = SoulStateDistributionSerializer(many=True)
    tenants = TenantSoulStatsSerializer(many=True)
    karma_distribution = KarmaBucketSerializer(many=True)
    karma_distribution_total = serializers.IntegerField()
    recent_activity = RecentActivitySerializer(many=True)
    souls_by_realm = SoulsByRealmSerializer(many=True)
