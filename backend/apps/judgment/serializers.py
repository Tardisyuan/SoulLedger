"""
REST serializers for Judgment app.
"""
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.core.field_permissions import FieldPermissionMixin
from apps.core.locale import locale_from_context
from apps.core.tenant import is_tenant_exempt
from apps.core.tenant_fields import same_tenant_or_404_message, tenant_scoped
from apps.judgment.claims import BATCH_LIMIT
from apps.judgment.models import EvidenceAdmission, Judgment, JudgmentCitation, Statute, Verdict, open_judgments
from apps.ledger.serializers import LedgerSummarySerializer
from apps.realms.models import Realm
from apps.realms.serializers import RealmLocalizedSerializer
from apps.reincarnation.serializers import ReincarnationSerializer
from apps.souls.models import Civilization, SoulState
from apps.souls.serializers import SoulSerializer, _is_viewer


def _locale_from(context) -> str:
    """The caller's locale, read the same way RealmLocalizedSerializer reads it.

    Statutes are multilingual reference data and the three bundles are not
    interchangeable: the Chinese articles have no English body, the Egyptian
    ones have no Chinese body at all. Resolving server-side keeps that
    fallback chain in one place (`Statute.get_localized_*`) instead of
    re-deriving it in the client."""
    return locale_from_context(context)


class StatuteSerializer(serializers.ModelSerializer):
    """One citable article.

    `display_text` is where a *derived* article becomes readable: for the
    Egyptian 42 the body lives on `Actor.powers_json["negative_confession"]`
    and this is the field that reads it. `text_en` on those rows is empty and
    stays empty — see Statute's docstring on why there is no second copy.
    """
    display_title = serializers.SerializerMethodField()
    display_text = serializers.SerializerMethodField()
    is_derived = serializers.SerializerMethodField()
    citation_count = serializers.SerializerMethodField()

    class Meta:
        model = Statute
        fields = [
            "id", "code", "civilization", "corpus", "ordinal", "polarity",
            "title_zh", "title_en", "title_egy",
            "text_zh", "text_en", "text_egy",
            "display_title", "display_text", "is_derived", "citation_count",
            "source", "source_notes", "payload_json",
        ]

    def get_citation_count(self, obj) -> int | None:
        """How many times this tenant has cited the article — or ``None``.

        A method field rather than ``IntegerField`` because the annotation is
        only present on one of this serializer's two paths.
        ``StatuteViewSet.get_queryset`` adds it; the nested use at
        ``JudgmentCitationSerializer.statute`` reaches the row through the FK,
        where no annotation exists and a declared ``IntegerField`` would raise
        ``AttributeError`` on every citation read.

        ``None``, not ``0``. "Nobody has cited this" and "this response does
        not carry the count" are different facts, and collapsing them puts a
        confident zero next to an article that may be the most-cited one in the
        corpus. The frontend renders the absent case through ``MissingValue``
        for the same reason.
        """
        return getattr(obj, "citation_count", None)

    def get_display_title(self, obj) -> str:
        return obj.get_localized_title(_locale_from(self.context))

    def get_display_text(self, obj) -> str:
        return obj.get_localized_text(_locale_from(self.context))

    def get_is_derived(self, obj) -> bool:
        return obj.source_actor_id is not None


class JudgmentCitationSerializer(serializers.ModelSerializer):
    """A ground, with the article inlined.

    Nested rather than a bare statute id: the point of the feature is that a
    reader can see WHY a verdict was given without a second round trip, and a
    list of UUIDs is not a reason.
    """
    statute = StatuteSerializer(read_only=True)

    class Meta:
        model = JudgmentCitation
        fields = ["id", "statute", "note", "created_at"]


class JudgmentSerializer(FieldPermissionMixin, serializers.ModelSerializer):
    """A proceeding. Soul and judge are the requester's own (BD-01).

    `validate_soul` / `validate_judge` were declared on
    `JudgmentCitationSerializer` above, which has neither field, so DRF never
    called them and this class resolved bare primary keys. A cross-tenant
    hearing is `apps.dispatch.CrossTenantJudgment`; here both parties belong
    to the tenant that opened the case. ADMIN is exempt as everywhere else.

    `verdict`, `is_final`, `concluded_at` are read-only and an attempt to write
    them is an explicit 400 (BD-03) — a plain field write produced a "final"
    judgment with no Disposition and a soul still JUDGING, and `conclude/`
    then refused it as already concluded. `civilization` is read-only and
    derived from the soul (BD-08).
    """
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    judge_name = serializers.CharField(source="judge.name", read_only=True)
    citations = JudgmentCitationSerializer(many=True, read_only=True)
    # 认领 / 暂缓(apps/judgment/claims.py)。全部只读:只有那几个动作能写,它们在行锁下写。
    claimed_by_name = serializers.SerializerMethodField()
    deferred_by_name = serializers.SerializerMethodField()
    # 队列一行要显示的两个数,免得每行再请求一次灵魂与证据。
    karmic_balance = serializers.SerializerMethodField()
    evidence_count = serializers.SerializerMethodField()

    validate_judge = tenant_scoped("judge")
    # 行程拓扑契约的 `judgment.realm_id`。`Realm.objects` 滤掉软删的界域,但**不滤租户**
    # (apps/core/tenant_fields.py):与 judge 相同,租户在 `validate_realm_id` 里查。
    # 与 `court` 互不推导:两者都可以写,谁也不覆盖谁。
    realm_id = serializers.PrimaryKeyRelatedField(
        source="realm", queryset=Realm.objects.all(), allow_null=True, required=False,
    )
    validate_realm_id = tenant_scoped("realm")

    class Meta:
        model = Judgment
        fields = [
            "id", "soul", "soul_name", "civilization", "judge", "judge_name",
            "court", "realm_id", "evidence_json", "confession", "verdict", "notes",
            "citations",
            "is_final", "created_at", "concluded_at",
            "kind", "amends_plan_id",
            "draft_verdict", "draft_saved_at", "draft_version",
            "claimed_by", "claimed_by_name", "claimed_at",
            "deferred_at", "deferred_by", "deferred_by_name", "defer_reason",
            "karmic_balance", "evidence_count",
        ]
        # 草稿三列只读:只有 `draft/`(带版本前提)写它们,见 JudgmentDraftService。
        # `kind` / `amends_plan_id` 只读:由服务端定(docs/ARCHITECTURE-sentence-plan.md §4),
        # 不由 POST 的 body 定 —— 灵魂有进行中的计划即 AMENDMENT;REOPEN 只由批准请求时开。
        read_only_fields = [
            "civilization", "verdict", "is_final", "concluded_at", "kind", "amends_plan_id",
            "draft_verdict", "draft_saved_at", "draft_version",
            "claimed_by", "claimed_at", "deferred_at", "deferred_by", "defer_reason",
        ]

    # Fields that only `conclude/` may write. Checked against `initial_data`
    # (the ApprovalNodeSerializer shape) because DRF strips read-only fields
    # before `validate` runs and would otherwise answer 200 to a forgery.
    _DECIDED_BY_CONCLUDE = ("verdict", "is_final", "concluded_at")
    # 同理:认领与暂缓只经 claim / release / reassign / defer / undefer 写,那条路径在
    # 案子的行锁下检查「已被别人认领」。一个 PATCH 能写 `claimed_by`,就能绕过那把锁。
    _WRITTEN_BY_CLAIM_ACTIONS = ("claimed_by", "claimed_at", "deferred_at", "deferred_by", "defer_reason")

    @staticmethod
    def _user_name(user) -> str | None:
        if user is None:
            return None
        return user.display_name or user.username

    def get_claimed_by_name(self, obj) -> str | None:
        return self._user_name(obj.claimed_by)

    def get_deferred_by_name(self, obj) -> str | None:
        return self._user_name(obj.deferred_by)

    def get_karmic_balance(self, obj) -> int | None:
        """功过相抵的净值 —— **只对中国的案子**,其他宇宙观是 null。

        `apps/ledger/readings.py`:净值是功過格的读法,埃及是称心、欧洲是罪与罚分离、
        希腊是两条并行的账,给它们一个净值就是把中国的读法套到所有人头上。按案子的
        `civilization`(审理它的宇宙观)判,不按灵魂此刻的管辖 —— 暂居不改变这件案子
        在哪个法庭上审。VIEWER 在 `to_representation` 里整个拿掉,与 `SoulSerializer` 同一条。
        """
        if obj.civilization != Civilization.CHINESE:
            return None
        return obj.soul.karmic_balance

    def get_evidence_count(self, obj) -> int:
        """`evidence_json` 的条目数 —— 详情页「事实」一栏标题旁的那个数
        (`JudgmentEvidenceColumn`,`Object.entries(evidence).length`)。"""
        evidence = obj.evidence_json
        if isinstance(evidence, dict | list):
            return len(evidence)
        return 0

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # VIEWER 默认不持有任何 judgment.* 码名,到不了这里;但权限矩阵可以授予它
        # judgment.read,而功过分数对 VIEWER 的隐藏是写死的底线(SoulSerializer 的
        # docstring:数据库规则只能收窄,不能放宽)。这里守同一条底线。
        if _is_viewer(self.context):
            data.pop("karmic_balance", None)
        return data

    def validate_soul(self, value):
        value = same_tenant_or_404_message(value, self.context, "soul")
        # ADMIN is exempt from the two rules below as well, not only from
        # tenant ownership: it is the role that repairs data, and the states
        # these rules refuse are exactly the ones that need repairing. The
        # exemption is a user decision (2026-09-12), not an oversight.
        request = self.context.get("request")
        if request is not None and is_tenant_exempt(getattr(request, "user", None)):
            return value
        if value.current_state == SoulState.SETTLED:
            raise serializers.ValidationError(
                "This soul is SETTLED; its fate is final and no further case can be opened."
            )
        open_cases = open_judgments(value)
        if self.instance is not None:
            open_cases = open_cases.exclude(pk=self.instance.pk)
        if open_cases.exists():
            raise serializers.ValidationError(
                "This soul already has an open case. Conclude it before opening another."
            )
        return value

    def validate(self, attrs):
        blocked = [f for f in self._DECIDED_BY_CONCLUDE if f in self.initial_data]
        if blocked:
            raise serializers.ValidationError({
                f: (
                    "Not settable through this endpoint. A verdict is filed through "
                    "`conclude/`, which also creates the Disposition and moves the "
                    "soul; a plain field write does neither."
                )
                for f in blocked
            })
        claim_fields = [f for f in self._WRITTEN_BY_CLAIM_ACTIONS if f in self.initial_data]
        if claim_fields:
            raise serializers.ValidationError({
                f: (
                    "Not settable through this endpoint. Use claim/, release/, "
                    "reassign/, defer/ or undefer/, which check the case under its row lock."
                )
                for f in claim_fields
            })
        if "soul" in attrs:
            attrs["civilization"] = attrs["soul"].civilization
        return attrs


class EvidenceAdmissionSerializer(serializers.ModelSerializer):
    """One ruling on one ledger record in this case. A record with no ruling
    is admitted; only rulings that were made are listed."""

    class Meta:
        model = EvidenceAdmission
        fields = ["id", "record", "admitted", "reason", "created_at", "update_time"]


class EvidenceRulingWriteSerializer(serializers.Serializer):
    """Input for `PUT /judgment/{id}/evidence/{record_id}/`. Shape only; the
    reason-required rule and which records are evidence here are
    `EvidenceAdmissionService.rule`'s."""
    admitted = serializers.BooleanField()
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class AdmittedBalanceSerializer(serializers.Serializer):
    """`LedgerService.get_admitted_balance`. `balance` and `not_admitted_net`
    are null unless `reading_kind` is BALANCE (and the judgment is from the
    current life); `reason_code` says which."""
    reading_kind = serializers.CharField(allow_null=True)
    balance = serializers.IntegerField(allow_null=True)
    not_admitted_count = serializers.IntegerField()
    not_admitted_net = serializers.FloatField(allow_null=True)
    reason_code = serializers.CharField(allow_null=True)


class EvidenceRulingResultSerializer(serializers.Serializer):
    """What a ruling returns: the row, and the balance it changed."""
    admission = EvidenceAdmissionSerializer()
    admitted_balance = AdmittedBalanceSerializer()


class JudgmentDetailSerializer(JudgmentSerializer):
    """`GET /judgment/{id}/` — the list shape plus the evidence rulings and the
    admitted balance. Detail only: the balance walks the soul's ledger, which
    the list must not do once per row."""
    evidence_admissions = EvidenceAdmissionSerializer(many=True, read_only=True)
    admitted_balance = serializers.SerializerMethodField()

    class Meta(JudgmentSerializer.Meta):
        fields = [*JudgmentSerializer.Meta.fields, "evidence_admissions", "admitted_balance"]

    @extend_schema_field(AdmittedBalanceSerializer)
    def get_admitted_balance(self, obj):
        from apps.judgment.services import EvidenceAdmissionService

        return EvidenceAdmissionService.admitted_balance(obj)


class JudgmentDraftWriteSerializer(serializers.Serializer):
    """Input for `PATCH /judgment/{id}/draft/`. `version` is the
    `draft_version` the caller last saw; either content field may be omitted."""
    version = serializers.IntegerField(min_value=0)
    notes = serializers.CharField(required=False, allow_blank=True)
    draft_verdict = serializers.ChoiceField(choices=Verdict.choices, required=False, allow_null=True)


class JudgmentDraftSerializer(serializers.ModelSerializer):
    """The draft as stored: what a save returns, and what a 409 hands back."""

    class Meta:
        model = Judgment
        fields = ["notes", "draft_verdict", "draft_version", "draft_saved_at"]
        read_only_fields = fields


class JudgmentDraftConflictSerializer(serializers.Serializer):
    """409 body of `draft/`. `code` is `draft_conflict` (someone saved first;
    `current` is what they saved) or `concluded` (`current` is null)."""
    error = serializers.CharField()
    code = serializers.ChoiceField(choices=["draft_conflict", "concluded"])
    current = JudgmentDraftSerializer(allow_null=True)


class JudgmentCitationWriteSerializer(serializers.Serializer):
    """Input for `POST /judgment/{id}/citations/`.

    Validates shape only. Whether the article exists, belongs to this tenant
    and belongs to this cosmology is `StatuteCitationService.resolve`'s
    business — it is the same question the `conclude` payload asks, and a
    check written here would cover exactly one of the two callers.
    """
    statute = serializers.UUIDField()
    note = serializers.CharField(required=False, allow_blank=True, default="")


class JudgmentConcludeSerializer(serializers.Serializer):
    verdict = serializers.ChoiceField(choices=["PASSED", "FAILED", "PURGATORY", "RETRY"])
    # allow_blank, because a verdict with no note is the ordinary case and
    # Judgment.notes is blank=True. Without it, DRF's CharField rejected an
    # explicit "" while accepting an omitted key — and both clients send the
    # key: app/judgment/[id]/page.tsx posts `notes` from a controlled textarea
    # that starts empty, and the triage queue does the same. So every verdict
    # filed without typing a note came back 400 "This field may not be blank",
    # from an endpoint whose own default for the field is "".
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    create_workflow = serializers.BooleanField(default=False)
    # The grounds, filed with the verdict. Optional — a judgment concluded
    # without citing anything is still a judgment, and requiring articles here
    # would break every existing caller and every existing test. What it must
    # not be is a place to attach reasoning AFTER the fact; see
    # StatuteCitationService.assert_amendable.
    statute_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list
    )
    # 加减项审判(kind=AMENDMENT)结案时对受刑计划的改动,形状同 `SentencePlanRequest.changes`:
    # {"add": [{"realm_code", "sentence_years", "reason"}], "remove": ["<node id>"]}。
    # 内容由 `apps/sentence_plan/requests.py::normalize_changes` 校验;其他 kind 带它答 400。
    plan_changes = serializers.DictField(required=False, allow_empty=True)


class JudgmentQueueCursorSerializer(serializers.Serializer):
    """The envelope `GET /api/v1/judgment/next/` returns.

    Schema-only, never instantiated. This is the response a judgment client
    hits most, and until this class existed it was documented as a bare
    `Judgment` — drf-spectacular's fallback to the viewset serializer, which is
    silent and was wrong. A generated client typed against that would have
    reached for `verdict` on an object whose top level is a cursor.

    Every field below is nullable or empty when the queue is exhausted: the
    view builds the payload with `judgment`/`soul`/`ledger` at `None` and the
    two lists empty, then fills them only once it has a case (see
    `JudgmentViewSet.next_pending`). `position` is additionally null when
    `remaining` is 0, because "the Nth of M" has no N when there is nothing
    left to rule on.

    The cross-app imports here are the same ones `views.py` already makes to
    build this payload; they are not a new dependency, and keeping the shape
    beside the other judgment serializers is what makes it possible to check
    that it still matches.
    """

    total = serializers.IntegerField()
    remaining = serializers.IntegerField()
    skipped = serializers.IntegerField()
    position = serializers.IntegerField(allow_null=True)
    judgment = JudgmentSerializer(allow_null=True)
    soul = SoulSerializer(allow_null=True)
    ledger = LedgerSummarySerializer(allow_null=True)
    prior_cycles = ReincarnationSerializer(many=True)
    realm_options = RealmLocalizedSerializer(many=True)


class JudgmentPrecedentSerializer(serializers.Serializer):
    """One row of 「据 · 先例」 — see apps/judgment/precedents.py for the ranking.

    `balance` is withheld (null) for VIEWER, the rule SoulSerializer applies to
    `karmic_balance`. VIEWER holds no judgment.* codename and cannot reach this
    endpoint today; the withholding is here so that granting it the read later
    does not also grant it the scores."""
    id = serializers.UUIDField(read_only=True)
    soul = serializers.UUIDField(source="soul_id", read_only=True)
    name = serializers.CharField(source="soul.name", read_only=True)
    verdict = serializers.ChoiceField(choices=Verdict.choices, read_only=True)
    court = serializers.CharField(read_only=True)
    concluded_at = serializers.DateTimeField(read_only=True, allow_null=True)
    balance = serializers.SerializerMethodField()
    realm_code = serializers.SerializerMethodField()
    realm_name = serializers.SerializerMethodField()
    same_court = serializers.BooleanField(read_only=True)
    shared_statutes = serializers.IntegerField(read_only=True)

    def get_balance(self, obj) -> int | None:
        from apps.souls.serializers import _is_viewer

        if _is_viewer(self.context):
            return None
        return obj.balance

    @staticmethod
    def _realm(obj):
        disposition = getattr(obj, "disposition", None)
        return disposition.destination_realm if disposition is not None else None

    def get_realm_code(self, obj) -> str | None:
        realm = self._realm(obj)
        return realm.realm_code if realm is not None else None

    def get_realm_name(self, obj) -> str | None:
        realm = self._realm(obj)
        return realm.get_localized_name(locale_from_context(self.context)) if realm is not None else None
# ---------------------------------------------------------------------------
# 认领、暂缓、改派、队列分组(apps/judgment/claims.py)
# ---------------------------------------------------------------------------


class QueueGroup:
    """队列的四个组。互斥,并在未结案的案子上穷尽:暂缓优先,其余按认领人分。"""

    MINE = "mine"
    UNCLAIMED = "unclaimed"
    OTHERS = "others"
    DEFERRED = "deferred"
    CHOICES = [
        (MINE, "我认领"),
        (UNCLAIMED, "待认领"),
        (OTHERS, "他人认领"),
        (DEFERRED, "暂缓"),
    ]


class JudgmentDeferSerializer(serializers.Serializer):
    """`POST /judgment/{id}/defer/` 的输入。理由必填。

    `max_length` 等于列宽 500:PostgreSQL 强制 varchar(n)、SQLite 不管,不在这里拦,
    超长的理由在 SQLite 上绿、在生产上 500(CLAUDE.md 记过 `Statute.source` 这一回)。
    """

    reason = serializers.CharField(max_length=500, allow_blank=False, trim_whitespace=True)


class JudgmentReassignSerializer(serializers.Serializer):
    """`POST /judgment/{id}/reassign/` 的输入:改派给谁(User 主键)。"""

    to = serializers.IntegerField(min_value=1)


class JudgmentBatchSerializer(serializers.Serializer):
    """`POST /judgment/batch/` 的输入。一个动作、至多 `BATCH_LIMIT` 个 id,全有或全无。"""

    operation = serializers.ChoiceField(choices=["claim", "reassign", "defer"])
    ids = serializers.ListField(
        child=serializers.UUIDField(), min_length=1, max_length=BATCH_LIMIT
    )
    to = serializers.IntegerField(min_value=1, required=False)
    reason = serializers.CharField(max_length=500, required=False, allow_blank=False, trim_whitespace=True)

    def validate(self, attrs):
        # 重复的 id 不是两件案子;去重后再数,免得「100 件」里有一半是同一件。
        attrs["ids"] = list(dict.fromkeys(attrs["ids"]))
        if attrs["operation"] == "reassign" and "to" not in attrs:
            raise serializers.ValidationError({"to": ["Required for reassign."]})
        if attrs["operation"] == "defer" and not attrs.get("reason"):
            raise serializers.ValidationError({"reason": ["Required for defer."]})
        return attrs


class JudgmentBatchResultSerializer(serializers.Serializer):
    """`POST /judgment/batch/` 成功时的响应。被拒时是 `JudgmentClaimRefusalSerializer`。"""

    operation = serializers.CharField()
    count = serializers.IntegerField()
    ids = serializers.ListField(child=serializers.UUIDField())


class JudgmentClaimRefusalSerializer(serializers.Serializer):
    """认领类动作被拒时的响应体(`ClaimRefusedError.as_payload`)。Schema only。

    `claimed_by` 只在 `already_claimed` / `not_claimant` 上有;`id` 只在批量里有,
    指出是哪一件让整批回滚;`missing` 只在批量的 404 上有。
    """

    error = serializers.CharField()
    code = serializers.CharField()
    claimed_by = serializers.IntegerField(required=False, allow_null=True)
    id = serializers.UUIDField(required=False)
    missing = serializers.ListField(child=serializers.UUIDField(), required=False)


class JudgmentQueueCountsSerializer(serializers.Serializer):
    """`GET /judgment/queue-counts/`:四个组各有几件未结案的案子。

    四个数互斥且相加等于 `total`(见 `QueueGroup`)。`court` 与 `search` 参数照样
    生效,所以标签上的数与当前筛选下的列表一致;`group` 参数被忽略 —— 数的就是各组。
    """

    mine = serializers.IntegerField()
    unclaimed = serializers.IntegerField()
    others = serializers.IntegerField()
    deferred = serializers.IntegerField()
    total = serializers.IntegerField()
