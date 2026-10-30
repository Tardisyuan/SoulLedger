"""
REST serializers for Judgment app.
"""
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.core.archive import ARCHIVE_FIELDS, ArchiveSerializerMixin
from apps.core.field_permissions import FieldPermissionMixin
from apps.core.locale import locale_from_context
from apps.core.tenant_fields import same_tenant_or_404_message, tenant_scoped
from apps.core.viewer import SEE_ALL, viewer_tenant_id
from apps.disposition.destination import MAX_TERM_YEARS
from apps.judgment import snapshot, wangsi
from apps.judgment.claims import BATCH_LIMIT, ClaimRefusedError, assert_concludable, ferry_barred, may_edit
from apps.judgment.models import (
    CitationSnapshotKind,
    EvidenceAdmission,
    Judgment,
    JudgmentCitation,
    JudgmentComment,
    Statute,
    Verdict,
    open_judgments,
)
from apps.ledger.serializers import LedgerSummarySerializer
from apps.org.ownership import check_owner_org, owner_org_field
from apps.realms.models import Realm
from apps.realms.serializers import RealmLocalizedSerializer
from apps.reincarnation.serializers import ReincarnationSerializer
from apps.souls.models import Civilization, SoulState
from apps.souls.serializers import SoulSerializer, is_viewer


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
            "revision", "effective_from",
        ]
        # 版本由 `Statute.save` 在条文变了时定,不是谁填的值(这个视图集本来就只读)。
        read_only_fields = ["revision", "effective_from"]

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


class CitationSnapshotSerializer(serializers.Serializer):
    """Schema of `JudgmentCitationSerializer.snapshot` (read-only)."""
    kind = serializers.ChoiceField(choices=CitationSnapshotKind.choices)
    taken_at = serializers.DateTimeField()
    display_title = serializers.CharField()
    display_text = serializers.CharField()
    source = serializers.CharField()
    current_differs = serializers.BooleanField()


class JudgmentCitationSerializer(serializers.ModelSerializer):
    """A ground, with the article inlined.

    Nested rather than a bare statute id: the point of the feature is that a
    reader can see WHY a verdict was given without a second round trip, and a
    list of UUIDs is not a reason.
    """
    statute = StatuteSerializer(read_only=True)
    snapshot = serializers.SerializerMethodField()

    class Meta:
        model = JudgmentCitation
        fields = ["id", "statute", "note", "created_at", "snapshot"]

    @extend_schema_field(CitationSnapshotSerializer(allow_null=True))
    def get_snapshot(self, obj):
        """What the article said when the verdict was given — or ``None``.

        ``None`` for an open case (it reads the live ``statute``) and for a
        citation that was never snapshotted. ``current_differs`` compares the
        stored hash with today's rendering, so the desk can offer the
        「现行文本已修订」 comparison without shipping both texts twice."""
        if not obj.snapshot_at or not obj.judgment.is_final:
            return None
        key = snapshot.locale_key(_locale_from(self.context))
        return {
            "kind": obj.snapshot_kind,
            "taken_at": obj.snapshot_at,
            "display_title": (obj.snapshot_title or {}).get(key, ""),
            "display_text": (obj.snapshot_text or {}).get(key, ""),
            "source": obj.snapshot_source,
            "current_differs": snapshot.content_hash(snapshot.render(obj.statute)) != obj.snapshot_hash,
        }


class JudgmentSerializer(ArchiveSerializerMixin, FieldPermissionMixin, serializers.ModelSerializer):
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
    # 官员端「{name}请求改派」那一行要名字(Design 第四十批 O-a)。
    reassign_requested_by_name = serializers.SerializerMethodField()
    # 队列一行要显示的两个数,免得每行再请求一次灵魂与证据。
    karmic_balance = serializers.SerializerMethodField()
    evidence_count = serializers.SerializerMethodField()
    # 队列「功 / 过」分列:灵魂此刻的两本账,分开给,不是净值 —— 所以不像 `karmic_balance`
    # 那样只给中国(希腊两条并行的账、欧洲罪与罚分离,本来就是分开读的)。VIEWER 拿掉,同 SoulSerializer。
    merit_score = serializers.IntegerField(source="soul.merit_score", read_only=True)
    demerit_score = serializers.IntegerField(source="soul.demerit_score", read_only=True)
    # 审判台「所在界域」:案子挂的那一站(`realm`),按请求语言给名字;没挂站是 null。
    realm_name = serializers.SerializerMethodField()
    city_god_name = serializers.CharField(source="city_god.name", read_only=True, allow_null=True, default=None)
    # 希腊原审此刻过不了阿刻戎的原因(UNBURIED / NO_FARE),能过河是空串;队列据此不画「认领」(第五十七批 G-1)。
    ferry_barred = serializers.SerializerMethodField()
    # 此刻还押在枉死城(`wangsi.is_held`,按服务端的日期判):官员端「还押 / 已到期」读它,不拿手机日期比 `held_until`。
    wangsi_held = serializers.SerializerMethodField()
    # 此刻为什么不能结案(`claims.assert_concludable` 的拒绝码:at_city_god / held_until_fated_date / embalming /
    # duat_unfinished / unferried),能结案是空串。审判台据此置灰「落判」,不在前端重抄一遍规则。
    conclude_refusal = serializers.SerializerMethodField()
    # 调用者此刻能不能改这件案子(`claims.may_edit`,与 `assert_may_edit` 同一条规则):别人认领中、自己又不持
    # judgment.assign 是 false,审判台据此藏起编辑控件(fix-be1 遗留,2026-10-29)。没有请求的上下文按 true。
    can_edit = serializers.SerializerMethodField()
    # 这件案子自己的审批流以 CANCELLED 结束(跨界联审撤销),发落卡在 approval_cancelled:审判台据此给「重开一案」
    # (`reopen-cancelled/`,judgment.assign)。与那个动作的前提同一条:流决定这件案子、状态 CANCELLED。
    flow_cancelled = serializers.SerializerMethodField()

    validate_judge = tenant_scoped("judge")
    # 行程拓扑契约的 `judgment.realm_id`。`Realm.objects` 滤掉软删的界域,但**不滤租户**
    # (apps/core/tenant_fields.py):与 judge 相同,租户在 `validate_realm_id` 里查。
    # 与 `court` 互不推导:两者都可以写,谁也不覆盖谁。
    realm_id = serializers.PrimaryKeyRelatedField(
        source="realm", queryset=Realm.objects.all(), allow_null=True, required=False,
    )
    validate_realm_id = tenant_scoped("realm")
    # 「戊 · 发落」草稿的界域;只读,只经 `draft/` 写。
    draft_destination_realm_id = serializers.UUIDField(read_only=True, allow_null=True)
    # 这次审判挂着的审批(结案时「同时发起审批」或手动发起时关联);没有是 null。
    # 「发起审批」(W-11)的关联审判下拉据此把已有审批的置灰。列表的 queryset 已 select_related。
    workflow = serializers.PrimaryKeyRelatedField(source="approval_workflow", read_only=True)
    # 所属机构(数据范围 B3a):建时可显式给,缺省按 `default_owner_org`(court 前缀 > 建案人机构 > 殿根);
    # 建后持 judgment.assign 可改,已结案的案子也可以(归属是管理上的事,不是判决的依据)。
    owner_org = owner_org_field()
    owner_org_name = serializers.CharField(source="owner_org.name", read_only=True, default=None)

    def validate_owner_org(self, value):
        return check_owner_org(value, self.context, "judgment", self.instance, "judgment.assign")

    class Meta:
        model = Judgment
        fields = [
            "id", "case_number", "soul", "soul_name", "civilization", "judge", "judge_name",
            "court", "realm_id", "evidence_json", "confession", "summary", "verdict", "notes",
            "citations",
            "is_final", "created_at", "concluded_at", "untimely", "held_until", "duat_stage", "ferry_barred",
            "wangsi_held", "conclude_refusal", "can_edit", "flow_cancelled",
            "kind", "amends_plan_id",
            "draft_verdict", "draft_saved_at", "draft_version",
            "draft_destination_realm_id", "draft_term_years", "draft_eternal",
            "claimed_by", "claimed_by_name", "claimed_at",
            "deferred_at", "deferred_by", "deferred_by_name", "defer_reason",
            "reassign_requested_at", "reassign_requested_by", "reassign_requested_by_name", "reassign_reason",
            "stale_since",
            # 城隍初审(apps/judgment/city_gods.py):全部只读,只经 `/judgment/city-god-cases/` 的动作写。
            "city_god", "city_god_name", "city_god_status", "city_god_note", "sent_on_at",
            "karmic_balance", "evidence_count",
            # 世次(`cycle`,0 是第一世,判决创建时盖章)与审判方式,都是模型上已有的列,此前没出线。
            "cycle", "judgment_method", "merit_score", "demerit_score", "realm_name",
            "workflow",
            # 埃及称心的结果,结案时冻结;天平摇摆而再称的案子指回上一件(apps/judgment/weighing.py)。
            "weighing_result", "heart_weight", "retrial_of",
            # 罪目(地府,自动选殿按它)与枉死城(docs/10)。罪目、死因、冤情等级可由 PATCH 写(`validate` 守规则);
            # 申诉那几列只读,只经 `/judgment/wangsi/{id}/grievance|decide/` 写(apps/judgment/wangsi.py)。
            "offence", "wrongful_death_cause", "grievance_level",
            "grievance_status", "grievance_plea", "grievance_note", "grievance_decided_at",
            "owner_org", "owner_org_name",
            *ARCHIVE_FIELDS,
        ]
        # 草稿各列只读:只有 `draft/`(带版本前提)写它们,见 JudgmentDraftService。
        # `kind` / `amends_plan_id` 只读:由服务端定(docs/ARCHITECTURE-sentence-plan.md §4),
        # 不由 POST 的 body 定 —— 灵魂有进行中的计划即 AMENDMENT;REOPEN 只由批准请求时开。
        read_only_fields = [
            *ARCHIVE_FIELDS, "civilization", "verdict", "is_final", "concluded_at", "kind", "amends_plan_id", "untimely", "held_until", "duat_stage",
            "draft_verdict", "draft_saved_at", "draft_version",
            "draft_destination_realm_id", "draft_term_years", "draft_eternal",
            "claimed_by", "claimed_at", "deferred_at", "deferred_by", "defer_reason",
            "reassign_requested_at", "reassign_requested_by", "reassign_reason",
            "stale_since",
            "cycle", "judgment_method", "weighing_result", "heart_weight", "retrial_of",
            "city_god", "city_god_status", "city_god_note", "sent_on_at",
            "grievance_status", "grievance_plea", "grievance_note", "grievance_decided_at",
        ]

    def update(self, instance, validated_data):
        """Write only the columns this PATCH/PUT carries (2026-10-29 审查).

        DRF's default `instance.save()` rewrites the whole row from the copy loaded at the start of the request,
        so a PATCH of `grievance_level` racing `wangsi.decide_grievance` put the old `grievance_status` and
        `held_until` back — an upheld grievance undone, the soul held again. Every column the serializer can
        write is a plain field (no many-to-many), so `update_fields` covers it; `Judgment.save` adds
        `stale_since` itself, and the audit columns ride along as everywhere else.
        """
        for name, value in validated_data.items():
            setattr(instance, name, value)
        instance.save(update_fields=[*validated_data, "version", "update_user", "update_time"])
        return instance

    # Fields that only `conclude/` may write. Checked against `initial_data`
    # (the ApprovalNodeSerializer shape) because DRF strips read-only fields
    # before `validate` runs and would otherwise answer 200 to a forgery.
    _DECIDED_BY_CONCLUDE = ("verdict", "is_final", "concluded_at")
    # 同理:认领与暂缓只经 claim / release / reassign / defer / undefer 写,那条路径在
    # 案子的行锁下检查「已被别人认领」。一个 PATCH 能写 `claimed_by`,就能绕过那把锁。
    _WRITTEN_BY_CLAIM_ACTIONS = (
        "claimed_by", "claimed_at", "deferred_at", "deferred_by", "defer_reason",
        "reassign_requested_at", "reassign_requested_by", "reassign_reason",
    )

    @staticmethod
    def _user_name(user) -> str | None:
        if user is None:
            return None
        return user.display_name or user.username

    def get_claimed_by_name(self, obj) -> str | None:
        return self._user_name(obj.claimed_by)

    def get_deferred_by_name(self, obj) -> str | None:
        return self._user_name(obj.deferred_by)

    def get_reassign_requested_by_name(self, obj) -> str | None:
        return self._user_name(obj.reassign_requested_by)

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

    def get_ferry_barred(self, obj) -> str:
        return ferry_barred(obj)

    def get_wangsi_held(self, obj) -> bool:
        return wangsi.is_held(obj)

    def get_conclude_refusal(self, obj) -> str:
        try:
            assert_concludable(obj)
        except ClaimRefusedError as exc:
            return exc.code
        return ""

    def get_can_edit(self, obj) -> bool:
        request = self.context.get("request")
        user = getattr(request, "user", None)
        return user is None or not user.is_authenticated or may_edit(obj, user)

    def get_flow_cancelled(self, obj) -> bool:
        from apps.workflow.models import ApprovalWorkflowStatus

        flow = getattr(obj, "approval_workflow", None)
        return flow is not None and flow.decides_judgment and flow.status == ApprovalWorkflowStatus.CANCELLED

    def get_realm_name(self, obj) -> str | None:
        realm = obj.realm
        return realm.get_localized_name(locale_from_context(self.context)) if realm is not None else None

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
        if is_viewer(self.context):
            for field in ("karmic_balance", "merit_score", "demerit_score"):
                data.pop(field, None)
        # 暂居只读(原属殿读暂居地的案子,决定 24):暂居地经手官员的名字不给,只看案子在哪一殿。
        viewer = viewer_tenant_id(self.context.get("request"))
        if viewer is not SEE_ALL and viewer != instance.tenant_id:
            for field in ("claimed_by", "claimed_by_name", "deferred_by", "deferred_by_name",
                          "reassign_requested_by", "reassign_requested_by_name"):
                if field in data:
                    data[field] = None
        return data

    def validate_soul(self, value):
        value = same_tenant_or_404_message(value, self.context, "soul")
        # ADMIN is exempt from the two rules below as well, not only from
        # tenant ownership: it is the role that repairs data, and the states
        # these rules refuse are exactly the ones that need repairing. The
        # exemption is a user decision (2026-09-12), not an oversight. It follows the role, not the reach:
        # an ADMIN bound to a hall keeps it inside its hall (2026-10-29) — the soul is already known to be in
        # the caller's hall by the line above.
        request = self.context.get("request")
        user = getattr(request, "user", None) if request is not None else None
        if getattr(user, "role", None) == "ADMIN" and not getattr(user, "hall_view", None):
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
        if self.instance is not None:
            self._validate_fixed_after_creation(attrs)
        if "soul" in attrs:
            attrs["civilization"] = attrs["soul"].civilization
        self._validate_chinese_case_fields(attrs)
        return attrs

    #: 已结案的案子还能改的列(用户 2026-10-29 第 18 条):只有备注。判官、法庭、界域、证据、供词、摘要……
    #: 都是判决的依据,事后改它们记录就和判决对不上;改错走重开 / 更正结算。
    _WRITABLE_AFTER_CONCLUSION = frozenset({"notes", "owner_org"})

    def _validate_fixed_after_creation(self, attrs):
        """M1:案子是关于哪个灵魂的,建后不改 —— 换灵魂会把已采信的证据、引条文、认领一并挪到别人头上,
        原灵魂停在 JUDGING 却没有案子。第 18 条:已结案的案子除备注外全部冻结。只拦真的改了值的列,
        原样回传的 PUT 照过。"""
        instance = self.instance
        if "soul" in attrs and attrs["soul"].pk != instance.soul_id:
            raise serializers.ValidationError(
                {"soul": "A judgment's soul is fixed once the case is opened."}, code="soul_fixed")
        if instance.verdict is None and not instance.is_final:
            return
        changed = sorted(f for f, v in attrs.items()
                         if f not in self._WRITABLE_AFTER_CONCLUSION and v != getattr(instance, f, v))
        if changed:
            raise serializers.ValidationError(
                {f: "This judgment is concluded; only its notes can change. Reopen or correct the settlement."
                 for f in changed}, code="judgment_concluded")

    def _validate_chinese_case_fields(self, attrs):
        """罪目只在地府的案子上;死因与冤情等级只在枉死的案子上;已结案的案子三者都不再改
        (罪目在结案时已决定了去哪一殿,事后改它只会让记录与处置对不上)。空串总是可以写回。"""
        instance = self.instance
        errors = {}
        concluded = instance is not None and (instance.verdict is not None or instance.is_final)
        civilization = attrs.get("civilization") or (instance.civilization if instance else None)
        untimely = bool(instance and instance.untimely)
        for field in ("offence", "wrongful_death_cause", "grievance_level"):
            if field not in attrs:
                continue
            if concluded and attrs[field] != getattr(instance, field):
                errors[field] = "This judgment is concluded."
            elif attrs[field] and field == "offence" and civilization != Civilization.CHINESE:
                errors[field] = "Only a 地府 (Chinese) case has an offence category."
            elif attrs[field] and field != "offence" and not untimely:
                errors[field] = "Only an untimely death (枉死) has a cause and a grievance level."
        if errors:
            raise serializers.ValidationError(errors)


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


class WeighingSerializer(serializers.Serializer):
    """埃及称心,按本案采信的证据(apps/judgment/weighing.py)。"""
    heart_weight = serializers.IntegerField()
    counterweight = serializers.IntegerField()
    heavier_than_feather = serializers.BooleanField()
    weighed_verdict = serializers.CharField()


class AdmittedBalanceSerializer(serializers.Serializer):
    """`LedgerService.get_admitted_balance`. `balance` and `not_admitted_net`
    are null unless `reading_kind` is BALANCE (and the judgment is from the
    current life); `reason_code` says which."""
    reading_kind = serializers.CharField(allow_null=True)
    balance = serializers.IntegerField(allow_null=True)
    not_admitted_count = serializers.IntegerField()
    not_admitted_net = serializers.FloatField(allow_null=True)
    reason_code = serializers.CharField(allow_null=True)
    #: A concluded case whose `balance` is the conclusion snapshot: today's
    #: admitted figure for the same reading. Null otherwise.
    current_balance = serializers.IntegerField(allow_null=True, required=False)
    #: Egyptian cases only: what the scale gives today. Absent elsewhere.
    weighing = WeighingSerializer(required=False)


class EvidenceRulingResultSerializer(serializers.Serializer):
    """What a ruling returns: the row, and the balance it changed."""
    admission = EvidenceAdmissionSerializer()
    admitted_balance = AdmittedBalanceSerializer()


class JudgmentFlowProgressSerializer(serializers.Serializer):
    """审判详情上的审批流程一行(Design 第五十九批 M-1,官员 App 只读)。"""

    workflow = serializers.UUIDField()
    status = serializers.CharField(help_text="`ApprovalWorkflowStatus`:IN_PROGRESS / COMPLETED / REJECTED …")
    index = serializers.IntegerField(help_text="走到第几站(只数要人决定的节点,同 `officer_app.facts`);没有当前节点时是最后决定的那站。")
    total = serializers.IntegerField()
    waiting = serializers.CharField(allow_null=True, help_text="处置为什么还不能执行:`weighing.unfinished_flow` 的码;"
                                    "没有处置、已执行或不被拦时为 null。")


class JudgmentDetailSerializer(JudgmentSerializer):
    """`GET /judgment/{id}/` — the list shape plus the evidence rulings and the
    admitted balance. Detail only: the balance walks the soul's ledger, which
    the list must not do once per row."""
    evidence_admissions = EvidenceAdmissionSerializer(many=True, read_only=True)
    admitted_balance = serializers.SerializerMethodField()
    # 挂在这份审判上的跨域审判(`CrossTenantJudgment.judgment` 一对一的反向),没有就是 null。
    # 审判页据此把「开联审」换成去那场联审的链接 —— 此前它照样显示,点了才被服务端拒(审计 1017 #10)。
    # 反向访问在没有时抛的 RelatedObjectDoesNotExist 也是 AttributeError,`allow_null` 让它读作 null。
    cross_judgment_id = serializers.UUIDField(source="cross_judgment.pk", read_only=True, allow_null=True)
    # 原审的审批流程走到哪一站、处置是否因此还不能执行(第五十九批 M-1);没有流程为 null。
    flow_progress = serializers.SerializerMethodField()

    class Meta(JudgmentSerializer.Meta):
        fields = [*JudgmentSerializer.Meta.fields, "evidence_admissions", "admitted_balance", "cross_judgment_id",
                  "flow_progress"]

    @extend_schema_field(JudgmentFlowProgressSerializer(allow_null=True))
    def get_flow_progress(self, obj):
        from apps.judgment.weighing import unfinished_flow
        from apps.workflow.models import AUTOMATIC_KINDS

        wf = getattr(obj, "approval_workflow", None)  # 没有时反向一对一抛的也是 AttributeError
        if wf is None:
            return None
        steps = [n for n in wf.nodes.order_by("node_order") if n.kind not in AUTOMATIC_KINDS]
        at = wf.current_node_id
        if at is None:
            decided = [n for n in steps if n.decided_at is not None]
            at = max(decided, key=lambda n: n.decided_at).pk if decided else None
        disposition = getattr(obj, "disposition", None)
        waiting = None
        if disposition is not None and not disposition.is_executed and not getattr(disposition, "is_deleted", False):
            waiting = unfinished_flow(disposition, flow_status=wf.status)
        # A finished flow reads 「第 n / 共 n 站」: a flow that skipped stations (五逆, a balanced PASS jumping to
        # the tenth court) last decides a node in the middle, and 「第 2 / 10 站 · 已完成」 reads as stuck.
        index = len(steps) if wf.status == "COMPLETED" else next(
            (i for i, n in enumerate(steps, 1) if n.pk == at), len(steps))
        return {"workflow": wf.pk, "status": wf.status,
                "index": index,
                "total": len(steps), "waiting": waiting}

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
    # 「戊 · 发落」的草稿。界域须是本案租户、本文明、未软删的(视图查);容量与裁决可去留给结案。
    draft_destination_realm_id = serializers.UUIDField(required=False, allow_null=True)
    draft_term_years = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=MAX_TERM_YEARS)
    draft_eternal = serializers.BooleanField(required=False)


class JudgmentDraftSerializer(serializers.ModelSerializer):
    """The draft as stored: what a save returns, and what a 409 hands back."""

    draft_destination_realm_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = Judgment
        fields = [
            "notes", "draft_verdict", "draft_destination_realm_id", "draft_term_years", "draft_eternal",
            "draft_version", "draft_saved_at",
        ]
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
    # Absent = no workflow, except while a cross-realm judgment is open on the case (第四十三批): then the
    # conclusion generates one and the bench is merged into it; an explicit false is refused (400
    # `workflow_required`). Null rather than a False default so "not said" and "said no" stay apart.
    create_workflow = serializers.BooleanField(required=False, allow_null=True, default=None)
    # W-1: the station orders of this realm's flow the judge unticked; the final review is refused (400
    # `final_required`). Only read when a workflow is generated.
    skip_node_orders = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, default=list, max_length=100)
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
    # 审判台「戊 · 发落」:判官亲自选的目的地与刑期。三个都不给 = 自动分派,与以前一样。
    # 其余校验(本案租户、裁决可去、容量、永恒)在结案事务里做,见
    # apps/disposition/destination.py::resolve_placement。
    destination_realm_id = serializers.UUIDField(required=False, allow_null=True)
    term_years = serializers.IntegerField(
        required=False, allow_null=True, min_value=1, max_value=MAX_TERM_YEARS,
    )
    eternal = serializers.BooleanField(required=False, allow_null=True)


class JudgmentDestinationOptionSerializer(serializers.ModelSerializer):
    """One realm the 「戊 · 发落」 picker may offer for a candidate verdict."""
    name = serializers.SerializerMethodField()
    occupancy = serializers.IntegerField(read_only=True)
    # 判官不写刑期时这扇门填的默认年数(2026-10-29,`disposition.default_terms`);永久或没有默认为 null。
    default_term_years = serializers.SerializerMethodField()

    class Meta:
        model = Realm
        fields = ["id", "name", "realm_code", "kind", "capacity", "occupancy", "is_eternal", "default_term_years"]
        read_only_fields = fields

    def get_default_term_years(self, obj) -> int | None:
        from apps.disposition.default_terms import default_term_years

        return default_term_years(obj.realm_code, is_eternal=obj.is_eternal)

    def get_name(self, obj) -> str:
        return obj.get_localized_name(locale_from_context(self.context))


class JudgmentDestinationsSerializer(serializers.Serializer):
    """`GET /judgment/{id}/destinations/?candidate_verdict=` — schema-only envelope.

    `default_realm_id` is where automatic routing would send the soul (null when
    that realm is not among the options, e.g. an unmapped tenant);
    `default_term_years` is the default term of that realm, written onto the disposition when the judge
    gives none (2026-10-29, `apps.disposition.default_terms`); null when eternal or without a default.
    `not_applicable` is the rest of the tenant's realms for this civilization —
    ones this verdict cannot reach, listed so the picker can show them disabled
    with the reason; `conclude` refuses them (`realm_not_allowed`).
    """
    verdict = serializers.CharField()
    default_realm_id = serializers.UUIDField(allow_null=True)
    default_term_years = serializers.IntegerField(allow_null=True)
    options = JudgmentDestinationOptionSerializer(many=True)
    not_applicable = JudgmentDestinationOptionSerializer(many=True)


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
        from apps.souls.serializers import is_viewer

        if is_viewer(self.context):
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


class JudgmentReassignRequestSerializer(serializers.Serializer):
    """`POST /judgment/{id}/request-reassign/` 的输入。理由可省(网页不带);手机端必填后带上,
    随通知的 `params["reason"]` 存下,供审批人读。长度同 `JudgmentDeferSerializer`(列宽 500)。"""

    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, trim_whitespace=True)


class JudgmentDeferSerializer(serializers.Serializer):
    """`POST /judgment/{id}/defer/` 的输入。理由必填。

    `max_length` 等于列宽 500:PostgreSQL 强制 varchar(n)、SQLite 不管,不在这里拦,
    超长的理由在 SQLite 上绿、在生产上 500(CLAUDE.md 记过 `Statute.source` 这一回)。
    """

    reason = serializers.CharField(max_length=500, allow_blank=False, trim_whitespace=True)


class JudgmentReassignSerializer(serializers.Serializer):
    """`POST /judgment/{id}/reassign/` 的输入:改派给谁(User 主键),理由可省(官员端必填后带上,随通知给原认领人)。"""

    to = serializers.IntegerField(min_value=1)
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, trim_whitespace=True)


class JudgmentClaimReasonSerializer(serializers.Serializer):
    """`release/` 与 `undefer/` 的可选输入:替别人放回 / 撤销暂缓时的理由,随通知给原认领人(Design 第四十批 O-a)。"""

    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, trim_whitespace=True)


class AssignableOfficerSerializer(serializers.Serializer):
    """`GET /judgment/assignable-officers/` 的一行:改派弹层要的五样,别无其他 ——
    没有邮箱、电话。`display_name` 可能为空,客户端退回 `username`。"""

    id = serializers.IntegerField(read_only=True)
    display_name = serializers.CharField(read_only=True)
    username = serializers.CharField(read_only=True)
    role = serializers.CharField(read_only=True)
    #: 这位官员手上认领着、尚未结案的案子件数(本租户)。
    in_hand = serializers.IntegerField(read_only=True)


class JudgmentReassignRequestResultSerializer(serializers.Serializer):
    """`POST /judgment/{id}/request-reassign/` 的 200:通知了几位管理员。"""

    notified = serializers.IntegerField(read_only=True)


class JudgmentRateLimitedSerializer(serializers.Serializer):
    """429 `rate_limited`:`retry_after` 秒后可再请(也在 `Retry-After` 头里)。Schema only。"""

    error = serializers.CharField()
    code = serializers.CharField()
    retry_after = serializers.IntegerField()


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

    `claimed_by` 只在 `already_claimed` / `not_claimant` / `claimed_by_other` 上有,
    `claimed_by_name` 只在 `claimed_by_other`(结案被拒)上有;`id` 只在批量里有,
    指出是哪一件让整批回滚;`missing` 只在批量的 404 上有。
    """

    error = serializers.CharField()
    code = serializers.CharField()
    claimed_by = serializers.IntegerField(required=False, allow_null=True)
    claimed_by_name = serializers.CharField(required=False)
    id = serializers.UUIDField(required=False)
    missing = serializers.ListField(child=serializers.UUIDField(), required=False)
    # `unferried`(希腊,未葬 / 无渡资滞留阿刻戎岸边):是哪一种,`Soul.FerryPassage`。
    ferry_passage = serializers.CharField(required=False)


class JudgmentCourtSerializer(serializers.Serializer):
    """`GET /judgment/courts/` 的一行:调用者租户里出现过的一个殿,和它眼下有几件未结案。

    殿是自由文本列,没有字典表;这份名单就是队列殿筛选的选项来源。`pending` 与
    `queue-counts/` 的 `total` 同一个谓词(未结案,含暂缓)。
    """

    court = serializers.CharField()
    pending = serializers.IntegerField()


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


class JudgmentCommentSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = JudgmentComment
        fields = ["id", "author", "author_name", "body", "created_at"]
        read_only_fields = ["id", "author", "author_name", "created_at"]
        extra_kwargs = {"body": {"max_length": JudgmentComment.MAX_LENGTH, "trim_whitespace": True}}

    @extend_schema_field(serializers.CharField())
    def get_author_name(self, obj):
        user = obj.author
        return (user.display_name or user.username) if user else ""
