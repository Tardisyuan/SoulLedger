"""助手管理页的请求 / 响应形状(docs/ARCHITECTURE-assist-admin.md)。API key 只写不读。"""
from rest_framework import serializers

from apps.soul_assist import config
from apps.soul_assist.models import OFFICER_SCREENS, SCREENS, AssistEvalCase, AssistEvalResult, AssistEvalRun
from apps.soul_assist.serializers import MAX_QUESTION_LENGTH

ERROR_KINDS = ("auth", "model_not_found", "timeout", "rate_limited", "connection", "tools_unsupported", "other")


class PriceSerializer(serializers.Serializer):
    """每百万 token 的价格,单位由管理员自定(与月度上限同一单位)。`cache_read` 不填按 `input` 算。"""

    input = serializers.FloatField(min_value=0)
    output = serializers.FloatField(min_value=0)
    cache_read = serializers.FloatField(min_value=0, required=False)


class CandidateSerializer(serializers.Serializer):
    """一套连接配置;没给的键沿用当前生效值。`api_key` 不给 = 沿用已存的 key。"""

    provider = serializers.ChoiceField(choices=tuple(config.PROVIDERS), required=False)
    base_url = serializers.URLField(max_length=500, allow_blank=True, required=False)
    api_key = serializers.CharField(max_length=500, allow_blank=True, required=False, write_only=True,
                                    trim_whitespace=True)
    model = serializers.CharField(max_length=200, min_length=1, required=False)
    effort = serializers.ChoiceField(choices=config.EFFORTS, allow_blank=True, required=False)
    fallbacks = serializers.BooleanField(required=False)


class ConfigUpdateSerializer(CandidateSerializer):
    enabled = serializers.BooleanField(required=False)
    soul_per_hour = serializers.IntegerField(min_value=1, max_value=10000, required=False)
    officer_per_hour = serializers.IntegerField(min_value=1, max_value=10000, required=False)
    monthly_cap = serializers.FloatField(min_value=0, allow_null=True, required=False)
    eval_spend_cap = serializers.FloatField(min_value=0, required=False)
    prices = serializers.DictField(child=PriceSerializer(), required=False)

    def validate(self, attrs):
        # 评测身份只由 POST eval/identities/ 设置(用户 2026-09-29 定);PATCH 里带了就明说,不静默忽略。
        locked = sorted({"eval_soul_account", "eval_officer"} & set(self.initial_data))
        if locked:
            raise serializers.ValidationError({name: "只读:评测身份由「创建评测身份」接口设置。" for name in locked},
                                              code="read_only_field")
        return attrs


class ApiKeyStateSerializer(serializers.Serializer):
    set = serializers.BooleanField()
    last4 = serializers.CharField(allow_null=True)
    set_at = serializers.DateTimeField(allow_null=True)
    source = serializers.ChoiceField(choices=("page", "env"))


class ReadOnlySettingsSerializer(serializers.Serializer):
    max_concurrent = serializers.IntegerField()
    timeout_seconds = serializers.FloatField()
    history_turns = serializers.IntegerField()
    retention_days = serializers.IntegerField()


class ConfigSerializer(serializers.Serializer):
    enabled = serializers.BooleanField(help_text="实际生效:env 允许且页面开关为开")
    switch = serializers.BooleanField(help_text="页面上的总开关")
    env_enabled = serializers.BooleanField(help_text="部署的 ASSISTANT_ENABLED;为假时页面开关无效")
    provider = serializers.CharField()
    base_url = serializers.CharField(allow_blank=True)
    model = serializers.CharField()
    effort = serializers.CharField(allow_blank=True)
    fallbacks = serializers.BooleanField()
    soul_per_hour = serializers.IntegerField()
    officer_per_hour = serializers.IntegerField()
    monthly_cap = serializers.FloatField(allow_null=True)
    eval_spend_cap = serializers.FloatField()
    prices = serializers.DictField(child=PriceSerializer())
    api_key = ApiKeyStateSerializer()
    eval_soul_account = serializers.UUIDField(allow_null=True, help_text="只读;由 POST eval/identities/ 设置")
    eval_officer = serializers.IntegerField(allow_null=True, help_text="只读;由 POST eval/identities/ 设置")
    month_rolls_over_at = serializers.CharField(help_text="月度上限按 UTC 月份滚动,写成北京时间给管理员看")
    overridden = serializers.ListField(child=serializers.CharField(), help_text="页面改过(不再跟 env)的键")
    read_only = ReadOnlySettingsSerializer()


class EvalIdentitiesSerializer(serializers.Serializer):
    eval_soul_account = serializers.UUIDField()
    eval_officer = serializers.IntegerField()
    officer_username = serializers.CharField()
    officer_role = serializers.CharField()
    description = serializers.CharField()


class ConnectivityResultSerializer(serializers.Serializer):
    ok = serializers.BooleanField()
    error_kind = serializers.ChoiceField(choices=ERROR_KINDS, allow_null=True)
    latency_ms = serializers.IntegerField()
    tokens = serializers.DictField(child=serializers.IntegerField())
    provider = serializers.CharField()
    model = serializers.CharField()


class HallSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    code = serializers.CharField()
    display_name = serializers.CharField()
    souls_homed = serializers.IntegerField(help_text="原属该殿的灵魂数")
    assistant_enabled = serializers.BooleanField()


class HallUpdateSerializer(serializers.Serializer):
    assistant_enabled = serializers.BooleanField()


class EvalCaseSerializer(serializers.ModelSerializer):
    screen = serializers.ChoiceField(choices=tuple(dict.fromkeys(SCREENS + OFFICER_SCREENS)))
    expected_tools = serializers.ListField(child=serializers.CharField(max_length=60), max_length=10,
                                           required=False)
    must_include = serializers.ListField(child=serializers.CharField(max_length=200), max_length=20, required=False)
    must_not_include = serializers.ListField(child=serializers.CharField(max_length=200), max_length=20,
                                             required=False)

    class Meta:
        model = AssistEvalCase
        fields = ["id", "side", "locale", "screen", "question", "expected_tools", "must_include", "must_not_include",
                  "active", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate(self, attrs):
        from apps.soul_assist import officer_tools, tools

        side = attrs.get("side", getattr(self.instance, "side", None))
        screen = attrs.get("screen", getattr(self.instance, "screen", None))
        if screen not in (SCREENS if side == "soul" else OFFICER_SCREENS):
            raise serializers.ValidationError({"screen": f"{screen!r} 不是{side}端的页面。"})
        known = {t.name for t in tools.SPECS} if side == "soul" else set(officer_tools.TOOLS)
        unknown = set(attrs.get("expected_tools", getattr(self.instance, "expected_tools", []))) - known
        if unknown:
            raise serializers.ValidationError({"expected_tools": f"{side}端没有这些工具:{sorted(unknown)}"})
        return attrs


class EvalPreviewRequestSerializer(serializers.Serializer):
    side = serializers.ChoiceField(choices=("soul", "officer", "both"))
    candidates = CandidateSerializer(many=True, min_length=1, max_length=2)


class EvalPreviewCandidateSerializer(serializers.Serializer):
    candidate = serializers.IntegerField()
    provider = serializers.CharField()
    model = serializers.CharField()
    asks = serializers.IntegerField()
    input_tokens = serializers.IntegerField()
    output_tokens = serializers.IntegerField()
    estimated_cost = serializers.FloatField(allow_null=True, help_text="模型不在价目表里时为 null")


class EvalPreviewSerializer(serializers.Serializer):
    asks = serializers.IntegerField()
    max_asks = serializers.IntegerField()
    estimated_cost = serializers.FloatField()
    spend_cap = serializers.FloatField()
    candidates = EvalPreviewCandidateSerializer(many=True)
    problems = serializers.ListField(child=serializers.ChoiceField(choices=(
        "unpriced_model", "no_cases", "too_many_asks", "over_spend_cap", "no_eval_soul", "no_eval_officer")))
    confirm_token = serializers.CharField(allow_null=True, help_text="problems 为空时才有;开始运行要带它")


class TryRequestSerializer(serializers.Serializer):
    """§3.3 试问:以评测身份问一句。`candidate` 不给 = 用生效配置;给了规则同连通测试(换地址要带 key)。"""

    side = serializers.ChoiceField(choices=("soul", "officer"))
    question = serializers.CharField(max_length=MAX_QUESTION_LENGTH, trim_whitespace=True)
    candidate = CandidateSerializer(required=False)


class TryResultSerializer(serializers.Serializer):
    side = serializers.ChoiceField(choices=("soul", "officer"))
    answer = serializers.CharField()
    tools_called = serializers.ListField(child=serializers.CharField(), help_text="按调用顺序的工具名,不含结果")
    latency_ms = serializers.IntegerField()
    tokens = serializers.DictField(child=serializers.IntegerField())
    provider = serializers.CharField()
    model = serializers.CharField()


class EvalStartSerializer(serializers.Serializer):
    confirm_token = serializers.CharField(max_length=64)


class EvalSummarySerializer(serializers.Serializer):
    candidate = serializers.IntegerField()
    provider = serializers.CharField()
    model = serializers.CharField()
    cases = serializers.IntegerField()
    passed = serializers.IntegerField()
    errors = serializers.IntegerField()
    tool_accuracy = serializers.FloatField(allow_null=True)
    phrase_hit_rate = serializers.FloatField(allow_null=True)
    mean_latency_ms = serializers.FloatField(allow_null=True)
    cost = serializers.FloatField(allow_null=True)
    input_tokens = serializers.IntegerField()
    output_tokens = serializers.IntegerField()


class EvalCandidateOutSerializer(serializers.Serializer):
    """落库的候选配置,**不含 key**。"""

    provider = serializers.SerializerMethodField()
    base_url = serializers.CharField()
    model = serializers.CharField()
    effort = serializers.CharField(allow_blank=True)
    fallbacks = serializers.SerializerMethodField()

    def get_provider(self, obj) -> str:
        return config.provider_name(obj["provider"])

    def get_fallbacks(self, obj) -> bool:
        return bool(obj["fallbacks"])


class EvalResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssistEvalResult
        fields = ["id", "candidate", "case", "side", "question", "tools_called", "answer", "error", "tools_ok",
                  "included", "excluded", "passed", "latency_ms", "tokens", "cost"]


class EvalRunSerializer(serializers.ModelSerializer):
    candidates = EvalCandidateOutSerializer(many=True, read_only=True)
    summary = EvalSummarySerializer(many=True, read_only=True)

    class Meta:
        model = AssistEvalRun
        fields = ["id", "created_at", "status", "candidates", "estimated_cost", "total", "done", "summary",
                  "finished_at"]


class EvalRunDetailSerializer(EvalRunSerializer):
    results = EvalResultSerializer(many=True, read_only=True)

    class Meta(EvalRunSerializer.Meta):
        fields = EvalRunSerializer.Meta.fields + ["results"]


class UsageBucketSerializer(serializers.Serializer):
    requests = serializers.IntegerField()
    answered = serializers.IntegerField()
    input_tokens = serializers.IntegerField()
    output_tokens = serializers.IntegerField()
    cache_read_tokens = serializers.IntegerField()
    cost = serializers.FloatField(help_text="只含已定价模型")


class UsageDaySerializer(UsageBucketSerializer):
    date = serializers.DateField()


class UsageSideSerializer(UsageBucketSerializer):
    side = serializers.ChoiceField(choices=("soul", "officer"))


class UsageHallSerializer(UsageBucketSerializer):
    tenant_id = serializers.IntegerField(allow_null=True)
    code = serializers.CharField(allow_null=True)


class UsageStatusSerializer(serializers.Serializer):
    ok = serializers.IntegerField()
    empty = serializers.IntegerField()
    unavailable = serializers.IntegerField()
    busy = serializers.IntegerField()
    rate_limited = serializers.IntegerField()
    not_configured = serializers.IntegerField()


class FailureRatesSerializer(serializers.Serializer):
    unavailable = serializers.FloatField(help_text="503 不可用 / 全部请求")
    rate_limited = serializers.FloatField(help_text="429(限流 + 忙) / 全部请求")
    empty = serializers.FloatField(help_text="「答不了」 / 答出的请求")


class Phase4Serializer(serializers.Serializer):
    corpus_tokens = serializers.IntegerField()
    corpus_threshold = serializers.IntegerField()
    corpus_reached = serializers.BooleanField()
    empty_share = serializers.FloatField()
    empty_threshold = serializers.FloatField()
    empty_reached = serializers.BooleanField()


class UsageSerializer(serializers.Serializer):
    month = serializers.CharField()
    spent = serializers.FloatField()
    cap = serializers.FloatField(allow_null=True)
    unpriced_models = serializers.ListField(child=serializers.CharField())
    requests = serializers.IntegerField()
    by_status = UsageStatusSerializer()
    failure_rates = FailureRatesSerializer()
    by_day = UsageDaySerializer(many=True)
    by_side = UsageSideSerializer(many=True)
    by_hall = UsageHallSerializer(many=True)
    phase4 = Phase4Serializer()


class CorpusEntrySerializer(serializers.Serializer):
    id = serializers.CharField()
    locale = serializers.CharField()
    audience = serializers.CharField()
    screens = serializers.ListField(child=serializers.CharField())
    civilizations = serializers.ListField(child=serializers.CharField())
    tokens = serializers.IntegerField()


class CorpusPromptSerializer(serializers.Serializer):
    locale = serializers.CharField()
    audience = serializers.CharField()
    tokens = serializers.IntegerField()


class CorpusSerializer(serializers.Serializer):
    entries = CorpusEntrySerializer(many=True)
    prompts = CorpusPromptSerializer(many=True)
    total_tokens = serializers.IntegerField(help_text="最大的一份 system prompt(一次请求实际带上的)的估计")
    threshold = serializers.IntegerField()
