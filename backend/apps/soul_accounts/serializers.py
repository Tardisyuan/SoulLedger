"""灵魂端(`/api/v1/me/`)与官员端(`/api/v1/soul-accounts/`)的序列化器。

**灵魂端一律显式白名单。** 不继承 `FieldPermissionMixin`:那个机制在「没有规则」时
全部可见,是黑名单语义;这里要的是反过来 —— 没写进 `fields` 的字段永远不出去,
新加到模型上的字段也不会自己漏出来。`tests/test_soul_me_api.py` 断言每个响应的
键集合**恰好**等于这里的白名单,并断言 evidence_json / new_identity / notes 等不在场。
"""
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.reincarnation.models import RebirthForm
from apps.soul_accounts.models import InitialCredential, RebirthApplication, SoulAccount
from apps.soul_accounts.services import email_not_synced as login_email_not_synced
from apps.souls.fields import HistoricalDateField

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

    @extend_schema_field(MeAccountSerializer)
    def get_account(self, soul):
        return MeAccountSerializer(self.context["account"]).data


class MeRecordSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    record_type = serializers.CharField()
    category = serializers.CharField()
    description = serializers.CharField()
    weight = serializers.IntegerField()
    event_date = HistoricalDateField(prefix="event", read_only=True)
    is_milestone = serializers.BooleanField()
    recorded_at = serializers.DateTimeField()


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


class MeLifeSerializer(serializers.Serializer):
    cycle = serializers.IntegerField()
    records = MeRecordSerializer(many=True)
    judgments = MeJudgmentSerializer(many=True)
    dispositions = MeDispositionSerializer(many=True)
    rebirth_applications = MeRebirthApplicationSerializer(many=True)
    reincarnation = MeReincarnationSerializer(allow_null=True)


class MeRebirthEligibilitySerializer(serializers.Serializer):
    can_apply = serializers.BooleanField()
    reason = serializers.CharField(allow_null=True)
    cooldown_until = serializers.DateTimeField(allow_null=True)


class MeRebirthApplicationListSerializer(MeRebirthEligibilitySerializer):
    results = MeRebirthApplicationSerializer(many=True)


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
