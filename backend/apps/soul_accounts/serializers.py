"""灵魂端(`/api/v1/me/`)与官员端(`/api/v1/soul-accounts/`)的序列化器。

**灵魂端一律显式白名单。** 不继承 `FieldPermissionMixin`:那个机制在「没有规则」时
全部可见,是黑名单语义;这里要的是反过来 —— 没写进 `fields` 的字段永远不出去,
新加到模型上的字段也不会自己漏出来。`tests/test_soul_me_api.py` 断言每个响应的
键集合**恰好**等于这里的白名单,并断言 evidence_json / new_identity / notes 等不在场。
"""
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.reincarnation.models import RebirthForm
from apps.sentence_plan.soul_view import PLAN_STATES as SOUL_PLAN_STATES
from apps.sentence_plan.soul_view import STATION_STATUSES as SOUL_STATION_STATUSES
from apps.soul_accounts.models import CooldownShorteningRequest, InitialCredential, RebirthApplication, SoulAccount
from apps.soul_accounts.services import email_not_synced as login_email_not_synced
from apps.souls.fields import HistoricalDateField
from apps.souls.models import Civilization

# ── 灵魂端 ───────────────────────────────────────────────────────────────


class SoulLoginRequestSerializer(serializers.Serializer):
    soul_code = serializers.CharField(max_length=32)
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class SoulRefreshRequestSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class SoulTokenPairSerializer(serializers.Serializer):
    access = serializers.CharField()
    refresh = serializers.CharField()


class MeAccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = SoulAccount
        fields = ["cycle", "must_change_password", "initial_password_expires_at", "created_at"]


class SoulLoginResponseSerializer(SoulTokenPairSerializer):
    soul_code = serializers.CharField()
    account = MeAccountSerializer()


class ChangePasswordRequestSerializer(serializers.Serializer):
    old_password = serializers.CharField(max_length=128, trim_whitespace=False)
    new_password = serializers.CharField(min_length=8, max_length=128, trim_whitespace=False)


class SoulErrorSerializer(serializers.Serializer):
    """所有业务拒绝的形状。`code` 稳定,App 按它分支;`detail` 是给人看的中文。"""

    detail = serializers.CharField()
    code = serializers.CharField()


class MeTenantSerializer(serializers.Serializer):
    code = serializers.CharField()
    display_name = serializers.CharField()
    hall_names = serializers.DictField(child=serializers.CharField(), read_only=True,
                                       help_text="殿司展示名,按语言:{zh-Hans, en, egy}(`Tenant.hall_names`)。")
    seal_glyphs = serializers.ListField(child=serializers.CharField(), read_only=True,
                                        help_text="匾上的印字(1–2 个);空 = 用文明默认字。")


class MeProfileSerializer(serializers.Serializer):
    """instance 是灵魂;本世账号经 context["account"] 传入。"""

    soul_code = serializers.CharField()
    name = serializers.CharField()
    birth_name = serializers.CharField()
    civilization = serializers.CharField()
    tenant = MeTenantSerializer()
    # 2026-09-17:调拨是暂居。`tenant` / `civilization` 是此刻管辖(暂居地);
    # `home_tenant` / `home_civilization` 是原属 —— App 按它换肤,显示「暂居 X · 原属 Y」。
    home_tenant = MeTenantSerializer()
    home_civilization = serializers.CharField()
    is_residing = serializers.BooleanField()
    current_state = serializers.CharField()
    birth_date = HistoricalDateField(prefix="birth", read_only=True)
    death_date = HistoricalDateField(prefix="death", read_only=True)
    origin_location = serializers.CharField()
    merit_score = serializers.IntegerField()
    demerit_score = serializers.IntegerField()
    account = serializers.SerializerMethodField()
    welcomed_civilizations = serializers.SerializerMethodField()
    #: 助手是否对这个灵魂开通(全局开关 + 原属殿开关,apps/soul_assist/service.py::enabled_for)。
    #: App 据此决定显示不显示「问一问」:设计稿定「未开通就隐藏入口」,所以点开之前就要知道。
    assistant_enabled = serializers.SerializerMethodField()

    @extend_schema_field(MeAccountSerializer)
    def get_account(self, soul):
        return MeAccountSerializer(self.context["account"]).data

    @extend_schema_field(serializers.ListField(child=serializers.ChoiceField(choices=Civilization.choices)))
    def get_welcomed_civilizations(self, soul):
        return self.context["account"].welcomed_civilizations

    def get_assistant_enabled(self, soul) -> bool:
        from apps.soul_assist.service import enabled_for

        return enabled_for(self.context["account"])


class MeWelcomedRequestSerializer(serializers.Serializer):
    """边界校验:只收 `Civilization` 的四个值;列表里因此不会出现别的字符串。"""

    civilization = serializers.ChoiceField(choices=Civilization.choices)


class MeWelcomedSerializer(serializers.Serializer):
    welcomed_civilizations = serializers.ListField(child=serializers.ChoiceField(choices=Civilization.choices))


class MeStatuteRefSerializer(serializers.Serializer):
    """灵魂看到的律条引用:只有编号与各语言的短标题 —— 不带正文、出处、哈希、版本。"""

    code = serializers.CharField()
    title = serializers.DictField(child=serializers.CharField())


class MeRecordSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    record_type = serializers.CharField()
    category = serializers.CharField()
    description = serializers.CharField()
    weight = serializers.IntegerField()
    event_date = HistoricalDateField(prefix="event", read_only=True)
    is_milestone = serializers.BooleanField()
    recorded_at = serializers.DateTimeField()
    #: 本世页「依据」与「人生阶段」。**刻意不含** `evidence_source` / `evidence_note`:
    #: 记录从哪来(哪位证人、哪本册)是官员的内部信息,灵魂端不读。
    statute_snapshot = serializers.SerializerMethodField()
    life_stage = serializers.CharField()

    @extend_schema_field(MeStatuteRefSerializer(allow_null=True))
    def get_statute_snapshot(self, obj):
        snap = obj.statute_snapshot
        if not snap or not snap.get("code"):
            return None
        return {"code": snap["code"], "title": snap.get("title") or {}}


class MeJudgeSerializer(serializers.Serializer):
    name = serializers.CharField()
    name_zh = serializers.CharField()
    title = serializers.CharField()


class MeJudgmentSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    court = serializers.CharField()
    judge = MeJudgeSerializer(allow_null=True)
    judgment_method = serializers.CharField()
    verdict = serializers.CharField(allow_null=True)
    is_final = serializers.BooleanField()
    created_at = serializers.DateTimeField()
    concluded_at = serializers.DateTimeField(allow_null=True)


class MeRealmSerializer(serializers.Serializer):
    realm_code = serializers.CharField()
    name_local = serializers.CharField()
    name_zh = serializers.CharField()
    name_en = serializers.CharField()


class MeDispositionSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    judgment_id = serializers.UUIDField(allow_null=True)
    destination_realm = MeRealmSerializer(allow_null=True)
    memory_reset = serializers.CharField()
    is_eternal = serializers.BooleanField()
    sentence_years = serializers.IntegerField(allow_null=True)
    term_start = HistoricalDateField(prefix="term_start", read_only=True)
    is_executed = serializers.BooleanField()
    executed_at = serializers.DateTimeField(allow_null=True)
    created_at = serializers.DateTimeField()


class MeCurrentStepSerializer(serializers.Serializer):
    """当前所在节点:只有节点类型与**角色**,不含审批人是谁(2026-09-14 决定 2)。"""

    node_type = serializers.CharField()
    approver_role = serializers.CharField()
    is_appeal = serializers.BooleanField()


class MeRebirthApplicationSerializer(serializers.ModelSerializer):
    current_step = serializers.SerializerMethodField()
    can_appeal = serializers.SerializerMethodField()

    class Meta:
        model = RebirthApplication
        fields = [
            "id", "cycle", "desired_form", "statement", "appeal_statement", "status",
            "cross_civilization", "rejection_reason", "decided_at", "first_rejection_reason", "first_decided_at",
            "current_step", "can_appeal", "created_at", "updated_at",
        ]

    @extend_schema_field(MeCurrentStepSerializer(allow_null=True))
    def get_current_step(self, obj):
        from apps.soul_accounts.rebirth import current_step

        return current_step(obj)

    def get_can_appeal(self, obj) -> bool:
        from apps.soul_accounts.rebirth import can_appeal

        return can_appeal(obj, self.context.get("account"))


class MeReincarnationSerializer(serializers.Serializer):
    """结束这一世的那次转世。**没有 new_identity、没有 notes。**"""

    cycle_count = serializers.IntegerField()
    rebirth_form = serializers.CharField()
    target_realm = serializers.CharField()
    reincarnated_at = serializers.DateTimeField()


class MeSentenceStationSerializer(serializers.Serializer):
    """受刑计划的一站(App「我的受刑」1a):九档节点状态已合并成灵魂看的五档 + 赦免(`apps/sentence_plan/soul_view.py`)。
    **没有** reason、disposition / dispatch / request 的 id(Q10)。"""

    id = serializers.UUIDField()
    #: 第几站:按灵魂看得见的站重新数(已减项的站不占号)。
    n = serializers.IntegerField()
    status = serializers.ChoiceField(choices=SOUL_STATION_STATUSES)
    is_home = serializers.BooleanField()
    civilization = serializers.CharField()
    realm = MeRealmSerializer(allow_null=True)
    sentence_years = serializers.IntegerField(allow_null=True)
    is_eternal = serializers.BooleanField()
    started_on = serializers.DateField(allow_null=True)
    #: 已结束的站:结束那天;在受 / 暂留的站:起始 + 刑期。其余为空。
    ends_on = serializers.DateField(allow_null=True)


class MeSentencePlanSerializer(serializers.Serializer):
    """本人本世的受刑计划。没有计划时 `state=none`、`stations=[]`。"""

    state = serializers.ChoiceField(choices=SOUL_PLAN_STATES)
    #: 原属文明有转生、且没有永久刑期(与推送 `sentence_completed` 的 rebirth_open 同一条判据)。
    rebirth_open = serializers.BooleanField()
    stations = MeSentenceStationSerializer(many=True)


class MeLifeSerializer(serializers.Serializer):
    cycle = serializers.IntegerField()
    records = MeRecordSerializer(many=True)
    judgments = MeJudgmentSerializer(many=True)
    dispositions = MeDispositionSerializer(many=True)
    rebirth_applications = MeRebirthApplicationSerializer(many=True)
    reincarnation = MeReincarnationSerializer(allow_null=True)


class MeCooldownShorteningSerializer(serializers.ModelSerializer):
    """灵魂看自己的那份:没有 decided_by。"""

    class Meta:
        model = CooldownShorteningRequest
        fields = ["id", "application", "cycle", "reason", "desired_remaining_days", "status", "approved_days",
                  "decision_note", "decided_at", "created_at"]
        read_only_fields = fields


class MeRebirthEligibilitySerializer(serializers.Serializer):
    can_apply = serializers.BooleanField()
    reason = serializers.CharField(allow_null=True)
    cooldown_until = serializers.DateTimeField(allow_null=True)


class MeRebirthApplicationListSerializer(MeRebirthEligibilitySerializer):
    results = MeRebirthApplicationSerializer(many=True)
    #: 冷却期内才有意义:能不能申请缩短,以及本世最近一份缩短申请(待决 / 已批准 / 已驳回)。
    can_shorten_cooldown = serializers.BooleanField()
    cooldown_shortening = MeCooldownShorteningSerializer(allow_null=True)


# OTHER 不收:它是历史遗留值,「Nothing should write it any more」(RebirthForm 文档)。
DESIRED_REBIRTH_FORMS = [c for c in RebirthForm.choices if c[0] != "OTHER"]


class RebirthApplicationCreateSerializer(serializers.Serializer):
    desired_form = serializers.ChoiceField(choices=DESIRED_REBIRTH_FORMS)
    statement = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")


class RebirthAppealSerializer(serializers.Serializer):
    statement = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")


# ── 官员端 ───────────────────────────────────────────────────────────────


def mask_email(value):
    if not value or "@" not in value:
        return ""
    local, domain = value.split("@", 1)
    return f"{local[:1]}***@{domain}"


def mask_phone(value):
    return f"{value[:3]}****{value[-2:]}" if value and len(value) > 5 else ("****" if value else "")


#: 联系邮箱没有同步成登录邮箱的原因。只有一个:地址已被别的账号占用
#: (`services.sync_login_email`)。None = 已同步,或没有联系邮箱。
EMAIL_NOT_SYNCED_FIELD = serializers.ChoiceField(choices=["taken"], allow_null=True, read_only=True)


class SoulAccountSerializer(serializers.ModelSerializer):
    soul_code = serializers.CharField(source="soul.soul_code", read_only=True)
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    last_login = serializers.DateTimeField(source="user.last_login", read_only=True, allow_null=True)
    contact_email_masked = serializers.SerializerMethodField()
    contact_phone_masked = serializers.SerializerMethodField()
    email_not_synced = serializers.SerializerMethodField()

    class Meta:
        model = SoulAccount
        fields = [
            "id", "soul", "soul_code", "soul_name", "cycle", "previous_account", "origin", "username",
            "must_change_password", "initial_password_expires_at", "retired_at", "created_at", "last_login",
            "contact_email_masked", "contact_phone_masked", "email_not_synced",
        ]
        read_only_fields = fields

    @extend_schema_field(EMAIL_NOT_SYNCED_FIELD)
    def get_email_not_synced(self, obj):
        return login_email_not_synced(obj)

    def get_contact_email_masked(self, obj) -> str:
        return mask_email(obj.soul.contact_email)

    def get_contact_phone_masked(self, obj) -> str:
        return mask_phone(obj.soul.contact_phone)


class ProvisionRequestSerializer(serializers.Serializer):
    soul_id = serializers.UUIDField()
    contact_email = serializers.EmailField(required=False, allow_blank=True)
    contact_phone = serializers.RegexField(
        r"^\+?[1-9]\d{6,14}$", max_length=20, required=False, allow_blank=True,
        error_messages={"invalid": "手机号须为 7-15 位数字,可带 + 前缀"},
    )


class ResetRequestSerializer(serializers.Serializer):
    contact_email = serializers.EmailField(required=False, allow_blank=True)
    contact_phone = serializers.RegexField(
        r"^\+?[1-9]\d{6,14}$", max_length=20, required=False, allow_blank=True,
        error_messages={"invalid": "手机号须为 7-15 位数字,可带 + 前缀"},
    )


class InitialCredentialSerializer(serializers.ModelSerializer):
    """**没有 secret。** 明文只经 `reveal` 动作出去一次。"""

    soul_code = serializers.CharField(source="soul.soul_code", read_only=True)
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    cycle = serializers.IntegerField(source="account.cycle", read_only=True)
    revealed_by = serializers.CharField(source="revealed_by.username", read_only=True, allow_null=True)
    delivered_by = serializers.CharField(source="delivered_by.username", read_only=True, allow_null=True)
    email_not_synced = serializers.SerializerMethodField()

    class Meta:
        model = InitialCredential
        fields = [
            "id", "account", "soul", "soul_code", "soul_name", "cycle", "channel", "status", "expires_at",
            "attempts", "last_error", "created_at", "sent_at", "revealed_at", "revealed_by",
            "delivered_at", "delivered_by", "email_not_synced",
        ]
        read_only_fields = fields

    @extend_schema_field(EMAIL_NOT_SYNCED_FIELD)
    def get_email_not_synced(self, obj):
        return login_email_not_synced(obj.account)


class RevealedCredentialSerializer(serializers.Serializer):
    soul_code = serializers.CharField()
    password = serializers.CharField()
    expires_at = serializers.DateTimeField()


class OfficerRebirthApplicationSerializer(serializers.ModelSerializer):
    """官员侧。`current_step` / `can_appeal` 与 /me 同一个函数算(rebirth.py),
    `rejection_reason` 就是审批人驳回时填的「给灵魂的理由」,节点内部备注不在这里。"""

    soul_code = serializers.CharField(source="soul.soul_code", read_only=True)
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    current_step = serializers.SerializerMethodField()
    can_appeal = serializers.SerializerMethodField()
    cooldown_until = serializers.SerializerMethodField()
    can_decide_cross_civilization = serializers.SerializerMethodField()

    class Meta:
        model = RebirthApplication
        fields = [
            "id", "soul", "soul_code", "soul_name", "account", "cycle", "desired_form", "statement",
            "appeal_statement", "status", "workflow", "appeal_workflow", "cross_civilization",
            "rejection_reason", "decided_at", "first_rejection_reason", "first_decided_at",
            "current_step", "can_appeal", "cooldown_until",
            "can_decide_cross_civilization", "created_at", "updated_at",
        ]
        read_only_fields = fields

    @extend_schema_field(MeCurrentStepSerializer(allow_null=True))
    def get_current_step(self, obj):
        from apps.soul_accounts.rebirth import current_step

        return current_step(obj)

    def get_can_appeal(self, obj) -> bool:
        from apps.soul_accounts.rebirth import can_appeal
        from apps.soul_accounts.services import current_account_of

        return can_appeal(obj, current_account_of(obj.soul))

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_cooldown_until(self, obj):
        from apps.soul_accounts.rebirth import cooldown_until

        return cooldown_until(obj)

    def get_can_decide_cross_civilization(self, obj) -> bool:
        """与 `cross-civilization/` 端点同一个判定(rebirth.cross_civilization_refusal)。没有请求上下文时为 False。"""
        from apps.soul_accounts.rebirth import cross_civilization_refusal

        request = self.context.get("request")
        return request is not None and cross_civilization_refusal(obj, request.user) is None


class CrossCivilizationDecisionSerializer(serializers.Serializer):
    cross_civilization = serializers.BooleanField()


# ── 缩短冷却申请 ──────────────────────────────────────────────────────────


class CooldownShorteningCreateSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000)
    #: 上限(< 此刻剩余天数)在服务层校验,那里才知道剩余几天。
    desired_remaining_days = serializers.IntegerField(min_value=0, max_value=36500, required=False, allow_null=True)


class OfficerCooldownShorteningSerializer(serializers.ModelSerializer):
    soul_code = serializers.CharField(source="soul.soul_code", read_only=True)
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    decided_by_username = serializers.CharField(source="decided_by.username", read_only=True, default=None)
    #: 此刻这段冷却的截止(含已批准的缩短);结束了为 None —— 待决的申请到那时就不必决定了。
    cooldown_until = serializers.SerializerMethodField()
    remaining_days = serializers.SerializerMethodField()
    #: A11:详情里「冷却截止 2026-10-13(原 10-26)」与进度线「已过 a / 共 b 天」。
    #: `cooldown_end` 含批准的缩短且结束后仍给出(`cooldown_until` 结束后为 None);
    #: `cooldown_original_until` 是殿规截止,批准前后相同。
    cooldown_end = serializers.SerializerMethodField()
    cooldown_original_until = serializers.SerializerMethodField()
    cooldown_total_days = serializers.SerializerMethodField()
    cooldown_past_days = serializers.SerializerMethodField()

    class Meta:
        model = CooldownShorteningRequest
        fields = ["id", "soul", "soul_code", "soul_name", "account", "application", "cycle", "reason", "desired_remaining_days",
                  "status", "approved_days", "decision_note", "decided_by", "decided_by_username", "decided_at",
                  "cooldown_until", "remaining_days", "cooldown_end", "cooldown_original_until",
                  "cooldown_total_days", "cooldown_past_days", "created_at", "updated_at"]
        read_only_fields = fields

    @staticmethod
    def _span(obj):
        from apps.soul_accounts.rebirth import cooldown_span

        return cooldown_span(obj.application)

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_cooldown_end(self, obj):
        span = self._span(obj)
        return span[1] if span else None

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_cooldown_original_until(self, obj):
        span = self._span(obj)
        return span[0] if span else None

    def get_cooldown_total_days(self, obj) -> int:
        span = self._span(obj)
        return span[2] if span else 0

    def get_cooldown_past_days(self, obj) -> int:
        span = self._span(obj)
        return span[3] if span else 0

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_cooldown_until(self, obj):
        from apps.soul_accounts.rebirth import cooldown_until

        return cooldown_until(obj.application)

    def get_remaining_days(self, obj) -> int:
        """批准的天数必须小于它(向上取整);0 = 冷却已结束。"""
        from apps.soul_accounts.rebirth import cooldown_until, remaining_cooldown_days

        until = cooldown_until(obj.application)
        return remaining_cooldown_days(until) if until else 0


class CooldownShorteningCountsSerializer(serializers.Serializer):
    PENDING = serializers.IntegerField()
    APPROVED = serializers.IntegerField()
    REJECTED = serializers.IntegerField()


class CooldownShorteningApproveSerializer(serializers.Serializer):
    approved_days = serializers.IntegerField(min_value=0)
    note = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")


class CooldownShorteningRejectSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=2000)
