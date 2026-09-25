"""
REST serializers for Disposition app.
"""
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.core.field_permissions import FieldPermissionMixin
from apps.core.locale import locale_from_context
from apps.core.tenant import is_tenant_exempt
from apps.core.tenant_fields import tenant_scoped
from apps.disposition.expiry import effective_term_start, term_end
from apps.disposition.models import Disposition, DispositionSection
from apps.judgment.models import Verdict
from apps.souls.dates import ERROR, check_term_start, to_representation
from apps.souls.fields import HistoricalDateField
from apps.souls.models import SoulState


class DispositionSerializer(FieldPermissionMixin, serializers.ModelSerializer):
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    realm_code = serializers.CharField(source="destination_realm.realm_code", read_only=True)
    # `get_localized_name`, not `name_en`.
    #
    # This was `source="destination_realm.name_en"`, so every reader of a
    # disposition saw the English realm name regardless of locale — a zh-Hans
    # user too, not only an egy one. It is the same defect as the missing
    # `Accept-Language` header, one layer down: the row carried a name column
    # rather than *the* name.
    realm_name = serializers.SerializerMethodField()
    # Backed by term_start_year/month/day (BCE-capable), the same way a soul's
    # birth_date is — a term that began in 399 BCE is the case the three
    # columns exist for. See apps.souls.fields.HistoricalDateField.
    term_start = HistoricalDateField(prefix="term_start")
    # 行程拓扑契约的 `disposition.realm_id`。**不是新列**:就是 `destination_realm`
    # 的主键,在契约的名字下再给一次。只读 —— 写仍然走 `destination_realm`,
    # 那里有租户校验。
    realm_id = serializers.UUIDField(source="destination_realm_id", read_only=True, allow_null=True)
    # 刑期走完的那一天 —— 与每日期满检查同一个算法(apps/disposition/expiry.py),
    # 页面的刑期条读它,不自己拿 term_start + sentence_years 再算一遍。
    # null:永久刑,或没记刑期,或既没记起算日也没执行。
    term_end = serializers.SerializerMethodField()
    # 产生这份处置的判决。`judgment` 为空(外地节点的处置,或审判被硬删)时为 null。
    verdict = serializers.ChoiceField(
        choices=Verdict.choices, source="judgment.verdict", read_only=True, allow_null=True
    )
    # 灵魂**现在**的状态,不是处置当时的。「期满」段用 `soul_reborn` 藏起已经转世的灵魂;
    # `soul_state` 给页面显示用。
    soul_state = serializers.ChoiceField(
        choices=SoulState.choices, source="soul.current_state", read_only=True
    )
    soul_reborn = serializers.SerializerMethodField()
    section = serializers.ChoiceField(
        choices=DispositionSection.choices, read_only=True,
    )

    @extend_schema_field(HistoricalDateField(prefix="term_end"))
    def get_term_end(self, obj):
        if obj.is_eternal:
            return None
        end = term_end(
            effective_term_start(
                (obj.term_start_year, obj.term_start_month, obj.term_start_day), obj.executed_at,
            ),
            obj.sentence_years,
        )
        return to_representation(*end) if end else None

    @extend_schema_field(serializers.BooleanField(
        help_text="The soul has been reborn since the life this disposition belongs to.",
    ))
    def get_soul_reborn(self, obj) -> bool:
        # 这份处置所属的那一世之后有没有 `cycle_count` 更大的转生记录。列表的 queryset
        # 用一个子查询把它注进来(`soul_reborn_flag`,见 views.py);单条响应
        # (execute / archive)没有注解,才退回一次查询。
        flag = getattr(obj, "soul_reborn_flag", None)
        if flag is not None:
            return bool(flag)
        return obj.soul.reincarnations.filter(cycle_count__gt=obj.cycle).exists()

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_realm_name(self, obj) -> str | None:
        realm = obj.destination_realm
        if realm is None:
            return None
        return realm.get_localized_name(locale_from_context(self.context))

    validate_judgment = tenant_scoped("judgment")
    validate_destination_realm = tenant_scoped("destination_realm")

    class Meta:
        model = Disposition
        fields = [
            "id", "soul", "soul_name", "judgment", "destination_realm",
            "realm_id", "realm_code", "realm_name", "memory_reset", "is_eternal",
            "sentence_years", "term_start", "is_executed", "executed_at",
            "notes", "created_at", "sentence_node_id",
            "expired_at", "term_end", "section", "verdict", "soul_state", "soul_reborn",
        ]
        # This serializer had no `read_only_fields` at all. Measured
        # 2026-08-29, a MODERATOR could `PATCH {"is_executed": true,
        # "executed_at": ...}` and get a 200: the row then reads EXECUTED while
        # the soul was never routed, never SETTLED, never REINCARNATING -- and
        # the real `POST .../execute/` afterwards returns 400 "Already
        # executed", so the soul is stuck in DISPOSED permanently. The same
        # PATCH could re-point `destination_realm` after the fact, i.e. change
        # where a sentence was served after it was served.
        #
        # `apps/reincarnation/views.py` already documented this exact shape for
        # ReincarnationSerializer and characterized it in
        # tests/test_perm_write_snapshot_outside_matrix.py. Disposition's copy
        # was never written down. A shape that has been diagnosed once is worth
        # grepping for.
        read_only_fields = [
            "id", "is_executed", "executed_at", "created_at", "sentence_node_id",
            # 只由期满检查写(apps/disposition/expiry.py),理由同上面的 is_executed。
            "expired_at",
        ]

    def validate_soul(self, value):
        """A disposition may only be recorded against a soul in this tenant.

        Re-pointing a disposition at a different soul is a supported operation
        -- `test_repointing_a_disposition_at_another_soul_is_checked` exists
        because a mis-filed sentence gets corrected, and the term-start rules
        below are what guard it. What was never checked is whether the new soul
        belongs to the caller's tenant: `soul` is a plain
        PrimaryKeyRelatedField whose queryset is a TenantManager, and that
        manager is evaluated with no tenant contextvar at serializer-validation
        time, so it scopes nothing. Same shape as ApprovalNodeSerializer's
        `workflow` (apps/workflow/serializers.py).

        ADMIN is exempt, as it is everywhere else (apps/core/tenant.py names it
        the one globally scoped role). The fallback to the user's own tenant
        column matters because `force_authenticate` never sets
        `request.tenant`.
        """
        request = self.context.get("request")
        if request is None:
            # Serializer used directly, outside a request -- the term-start
            # rules still apply; there is no tenant to check against.
            return value
        user = getattr(request, "user", None)
        if is_tenant_exempt(user):
            return value
        tenant = getattr(request, "tenant", None) or getattr(user, "tenant", None)
        if tenant is None or value.tenant_id != tenant.pk:
            raise serializers.ValidationError(
                "No such soul in this tenant."
            )
        return value

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
