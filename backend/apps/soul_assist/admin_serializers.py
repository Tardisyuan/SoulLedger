"""助手管理页的请求 / 响应形状(docs/ARCHITECTURE-assist-admin.md)。API key 只写不读。"""
from rest_framework import serializers

from apps.soul_assist import config, corpus, platforms, vectors
from apps.soul_assist.models import OFFICER_SCREENS, SCREENS, AssistEvalCase, AssistEvalResult, AssistEvalRun
from apps.soul_assist.serializers import MAX_QUESTION_LENGTH, AssistErrorSerializer

RETRIEVALS = ("vector", "fallback", "fallback_low_similarity")
FALLBACK_REASONS = ("connection", "timeout", "rate_limited", "server_error", "quota", "circuit_open")
ERROR_KINDS = ("auth", "model_not_found", "timeout", "rate_limited", "connection", "tools_unsupported", "other")


class PriceSerializer(serializers.Serializer):
    """每百万 token 的价格,单位由管理员自定(与月度上限同一单位)。`cache_read` 不填按 `input` 算。"""

    input = serializers.FloatField(min_value=0)
    output = serializers.FloatField(min_value=0)
    cache_read = serializers.FloatField(min_value=0, required=False)
    source = serializers.ChoiceField(choices=("litellm", "manual"), required=False,
                                     help_text="litellm = 预填的参考价(未改过);manual = 手填或改过。缺省按 manual")
    as_of = serializers.DateField(required=False, allow_null=True, help_text="参考价取自 LiteLLM 价目表的日期")

    def validate(self, attrs):
        if attrs.get("as_of"):  # 存进 JSONField:写成 ISO 字符串
            attrs["as_of"] = attrs["as_of"].isoformat()
        return attrs


class CandidateSerializer(serializers.Serializer):
    """一套连接配置;没给的键沿用当前生效值。`api_key` 不给 = 沿用已存的 key。
    `platform` 是预设时由它定 `provider` 与 `base_url`(不必再给;给了而不一致 → 400 `platform_locked`)。"""

    platform = serializers.ChoiceField(choices=platforms.PLATFORM_IDS, required=False)
    provider = serializers.ChoiceField(choices=tuple(config.PROVIDERS), required=False)
    base_url = serializers.URLField(max_length=500, allow_blank=True, required=False)
    api_key = serializers.CharField(max_length=500, allow_blank=True, required=False, write_only=True,
                                    trim_whitespace=True)
    model = serializers.CharField(max_length=200, min_length=1, required=False)
    effort = serializers.ChoiceField(choices=config.EFFORTS, allow_blank=True, required=False)
    fallbacks = serializers.BooleanField(required=False)

    def validate(self, attrs):
        preset = platforms.PLATFORMS.get(attrs.get("platform"))
        if preset and preset.provider:
            fixed = {"provider": preset.provider, "base_url": preset.base_url}
            clash = sorted(k for k, v in fixed.items() if k in attrs and attrs[k] != v)
            if clash:
                raise serializers.ValidationError({k: "由所选平台决定,不能改;要改请选「自定义」。" for k in clash},
                                                  code="platform_locked")
            attrs.update(fixed)
        return attrs


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
        return super().validate(attrs)


class ApiKeyStateSerializer(serializers.Serializer):
    set = serializers.BooleanField(help_text="有 key(清除过的格子为 false)")
    last4 = serializers.CharField(allow_null=True, help_text="key 至少 12 个字符才给")
    set_at = serializers.DateTimeField(allow_null=True, help_text="页面存入的时间;env 的 key 为 null")
    source = serializers.ChoiceField(choices=("page", "env"))


class ReadOnlySettingsSerializer(serializers.Serializer):
    max_concurrent = serializers.IntegerField()
    timeout_seconds = serializers.FloatField(help_text="非流式整次回答 / 流式第一段文本的上限")
    stream_total_seconds = serializers.FloatField(help_text="流式整次回答的上限")
    primary_first_token_seconds = serializers.FloatField(help_text="配了备用时,主用最多等这么久出第一段文本")
    history_turns = serializers.IntegerField()
    retention_days = serializers.IntegerField()


class PlatformSerializer(serializers.Serializer):
    id = serializers.ChoiceField(choices=platforms.PLATFORM_IDS)
    provider = serializers.ChoiceField(choices=tuple(config.PROVIDERS), allow_null=True, help_text="custom 为 null")
    base_url = serializers.CharField(allow_null=True, help_text="custom 为 null")
    tools = serializers.ChoiceField(choices=platforms.TOOLS, help_text="文档写明支持函数调用 = yes;model = 看模型")
    needs_key = serializers.BooleanField()


class ConfigSerializer(serializers.Serializer):
    enabled = serializers.BooleanField(help_text="实际生效:env 允许且页面开关为开")
    switch = serializers.BooleanField(help_text="页面上的总开关")
    env_enabled = serializers.BooleanField(help_text="部署的 ASSISTANT_ENABLED;为假时页面开关无效")
    platform = serializers.ChoiceField(choices=platforms.PLATFORM_IDS,
                                       help_text="存的平台;与当前连接对不上时按适配器 + 地址认,认不出是 custom")
    platforms = PlatformSerializer(many=True, help_text="下拉里的预设(只读)")
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
    api_key = ApiKeyStateSerializer(help_text="当前连接那个平台的 key")
    api_key_slot = serializers.CharField(help_text="当前连接的 key 存在哪一格:预设平台 id,或 custom:<主机[:端口]>")
    api_keys = serializers.DictField(child=ApiKeyStateSerializer(),
                                     help_text="每个存过 key 的平台一格(键同 api_key_slot):换到那个平台不必重填 key")
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
    tools = serializers.BooleanField(allow_null=True,
                                     help_text="连通时:模型真的调了一次测试工具为 true;没调或平台拒收工具为 false。未连通为 null")
    provider = serializers.CharField()
    model = serializers.CharField()


class ModelEntrySerializer(serializers.Serializer):
    name = serializers.CharField(help_text="模型名(平台 API 里的 id),填进「模型名」")
    context = serializers.IntegerField(allow_null=True, help_text="平台给了上下文长度才有")


class ModelListSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=("ok", "no_list", "failed"),
                                     help_text="no_list = 平台不提供模型列表(404/405),不算出错")
    error_kind = serializers.ChoiceField(choices=ERROR_KINDS, allow_null=True)
    models = ModelEntrySerializer(many=True)


class PriceReferenceRequestSerializer(serializers.Serializer):
    platform = serializers.ChoiceField(choices=platforms.PLATFORM_IDS)
    model = serializers.CharField(max_length=200)


class PriceReferenceSerializer(serializers.Serializer):
    found = serializers.BooleanField()
    input = serializers.FloatField(allow_null=True, help_text="美元 / 百万 token")
    output = serializers.FloatField(allow_null=True)
    cache_read = serializers.FloatField(allow_null=True)
    as_of = serializers.DateField(allow_null=True, help_text="价目表的取得日期;表取不到时为 null")


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
    expected_entries = serializers.ListField(
        child=serializers.CharField(max_length=100), max_length=10, required=False,
        help_text="期望进入检索 top-k 的帮助条目 id(该端、该语言的语料里要有);全部进了才算命中。空 = 不计命中率")

    class Meta:
        model = AssistEvalCase
        fields = ["id", "side", "locale", "screen", "question", "expected_tools", "must_include", "must_not_include",
                  "expected_entries", "active", "created_at"]
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
        locale = attrs.get("locale", getattr(self.instance, "locale", "zh-Hans"))
        ids = {e["id"] for e in corpus.entries(locale, side)}
        missing = set(attrs.get("expected_entries", getattr(self.instance, "expected_entries", []))) - ids
        if missing:
            raise serializers.ValidationError({"expected_entries": f"{side}端 {locale} 语料里没有这些条目:{sorted(missing)}"})
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
    """§3.3 试问:以评测身份问一句。`candidate` 不给 = 用生效配置(连同备用与断路器);给了只测这一套,
    规则同连通测试(换地址要带 key)。"""

    side = serializers.ChoiceField(choices=("soul", "officer"))
    question = serializers.CharField(max_length=MAX_QUESTION_LENGTH, trim_whitespace=True)
    candidate = CandidateSerializer(required=False)
    stream = serializers.BooleanField(required=False,
                                      help_text="true = Server-Sent Events,事件见 AssistTryStreamEvent")


class TryResultSerializer(serializers.Serializer):
    side = serializers.ChoiceField(choices=("soul", "officer"))
    answer = serializers.CharField()
    tools_called = serializers.ListField(child=serializers.CharField(), help_text="按调用顺序的工具名,不含结果")
    retrieval = serializers.ChoiceField(choices=RETRIEVALS)
    retrieved_entries = serializers.ListField(child=serializers.CharField(),
                                              help_text="检索进上下文的条目 id,近的在前;退回整份语料时为空")
    latency_ms = serializers.IntegerField()
    tokens = serializers.DictField(child=serializers.IntegerField())
    provider = serializers.CharField(help_text="实际作答的那一家")
    model = serializers.CharField()
    provider_role = serializers.ChoiceField(choices=("primary", "backup"))
    fallback_reason = serializers.ChoiceField(choices=FALLBACK_REASONS, allow_null=True,
                                              help_text="改用了备用的理由;主用答的为 null")


class TryStreamDoneSerializer(TryResultSerializer):
    event = serializers.CharField(help_text="done")


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
    retrieval_hit_rate = serializers.FloatField(
        allow_null=True, help_text="写了期望条目的已答用例里,期望条目进了检索 top-k 的比例;没有这样的用例为 null")
    retrieval_fallbacks = serializers.IntegerField(allow_null=True,
                                                   help_text="已答用例里退回整份语料的条数;早于检索的运行为 null")
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
                  "included", "excluded", "passed", "retrieval", "retrieved", "retrieval_hit", "latency_ms", "tokens",
                  "cost"]


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
    stopped = serializers.IntegerField(help_text="流式:灵魂停止或断开(已生成的部分照存、照计费)")
    interrupted = serializers.IntegerField(help_text="流式:出过字以后供应商出错或到了总时长")


class UsageFallbackReasonsSerializer(serializers.Serializer):
    connection = serializers.IntegerField()
    timeout = serializers.IntegerField()
    rate_limited = serializers.IntegerField()
    server_error = serializers.IntegerField(help_text="5xx")
    quota = serializers.IntegerField(help_text="402 余额不足")
    circuit_open = serializers.IntegerField(help_text="主用连续失败、断路器开着,没试主用")


class UsageDaySerializer(UsageBucketSerializer):
    date = serializers.DateField()
    primary_cost = serializers.FloatField(help_text="主用答的(含主用失败前已花的)花费;primary_cost + backup_cost = cost")
    backup_cost = serializers.FloatField(help_text="备用答的花费,按备用的价目表")
    fallbacks = serializers.IntegerField(help_text="这一天由备用答出的提问数(备用也失败的不计)")
    fallback_reasons = UsageFallbackReasonsSerializer()


class UsageFallbacksSerializer(serializers.Serializer):
    count = serializers.IntegerField(help_text="由备用答出的提问数;备用也失败的算作失败,不计入")
    by_reason = UsageFallbackReasonsSerializer()


class UsageProviderSerializer(UsageBucketSerializer):
    role = serializers.ChoiceField(choices=("primary", "backup"))


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


class UsageRetrievalSerializer(serializers.Serializer):
    vector = serializers.IntegerField()
    fallback = serializers.IntegerField(help_text="向量服务不通、超时,或库里没有向量")
    fallback_low_similarity = serializers.IntegerField(help_text="最近一条也低于相似度下限")


class UsageSerializer(serializers.Serializer):
    month = serializers.CharField()
    spent = serializers.FloatField()
    cap = serializers.FloatField(allow_null=True)
    unpriced_models = serializers.ListField(child=serializers.CharField())
    requests = serializers.IntegerField()
    by_status = UsageStatusSerializer()
    fallbacks = UsageFallbacksSerializer()
    by_provider = UsageProviderSerializer(many=True, help_text="主用 / 备用各自的请求、token 与花费(各按自己的价目表)")
    failure_rates = FailureRatesSerializer()
    by_retrieval = UsageRetrievalSerializer(help_text="已答的请求按帮助条目的来源分(§7.5)")
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


# ── 向量检索(docs/ARCHITECTURE-soul-assist.md §7.6)────────────────────────


class EmbeddingCandidateSerializer(serializers.Serializer):
    """一套向量配置;没给的键沿用当前生效值。`embedding_dims` 为 null = 模型原生维度(不截断)。"""

    embedding_url = serializers.URLField(max_length=500, required=False)
    embedding_model = serializers.CharField(max_length=200, min_length=1, required=False)
    embedding_dims = serializers.IntegerField(min_value=1, max_value=16000, allow_null=True, required=False)


class EmbeddingUpdateSerializer(EmbeddingCandidateSerializer):
    retrieval_k = serializers.IntegerField(min_value=1, max_value=20, required=False)
    retrieval_min_similarity = serializers.FloatField(min_value=-1, max_value=1, required=False)


class EmbeddingStatusSerializer(serializers.Serializer):
    entries = serializers.IntegerField(help_text="两种语言、两端的语料条目总数")
    embedded = serializers.IntegerField(help_text="按当前模型与维度、当前正文已嵌入的条数")
    needs_rebuild = serializers.BooleanField(
        help_text="当前模型 / 维度 / 正文下有条目没有向量。测试通过不会自动重建;重建完成前检索退回整份语料")
    model = serializers.CharField(help_text="当前配置:模型,截断时为「模型@维度」")
    last_rebuild_at = serializers.DateTimeField(allow_null=True)
    last_rebuild_model = serializers.CharField(allow_null=True)
    last_error = serializers.ChoiceField(choices=vectors.ERROR_KINDS, allow_null=True,
                                         help_text="上次重建失败的原因;那次没有换进任何向量。成功一次即清空")
    last_error_at = serializers.DateTimeField(allow_null=True)
    rebuild_running = serializers.BooleanField(help_text="正在重建;此时再点重建答 409 rebuild_running")


class EmbeddingConfigSerializer(serializers.Serializer):
    embedding_url = serializers.CharField()
    embedding_model = serializers.CharField()
    embedding_dims = serializers.IntegerField(allow_null=True, help_text="null = 模型原生维度")
    retrieval_k = serializers.IntegerField()
    retrieval_min_similarity = serializers.FloatField(
        help_text="最近一条的余弦相似度低于它,这一问退回整份语料(fallback_low_similarity)")
    overridden = serializers.ListField(child=serializers.CharField(), help_text="页面改过(不再跟 env)的键")
    status = EmbeddingStatusSerializer()


class EmbeddingTestResultSerializer(serializers.Serializer):
    ok = serializers.BooleanField()
    error_kind = serializers.ChoiceField(choices=vectors.ERROR_KINDS, allow_null=True)
    latency_ms = serializers.IntegerField()
    dims = serializers.IntegerField(allow_null=True, help_text="返回的维度;失败时为 null")
    embedding_url = serializers.CharField()
    embedding_model = serializers.CharField()
    embedding_dims = serializers.IntegerField(allow_null=True, help_text="要求的截断维度;null = 原生")


class EmbeddingErrorSerializer(AssistErrorSerializer):
    error_kind = serializers.ChoiceField(choices=vectors.ERROR_KINDS)


class EmbeddingRebuildSerializer(serializers.Serializer):
    embedded = serializers.IntegerField(help_text="这次新嵌入或重嵌的条数")
    unchanged = serializers.IntegerField()
    deleted = serializers.IntegerField(help_text="语料里已不存在而删掉的行")
    model = serializers.CharField()
    dims = serializers.IntegerField(allow_null=True)
    index = serializers.CharField(allow_null=True, help_text="PostgreSQL 上现有的 HNSW 索引名;行数未到阈值为 null")
    dropped = serializers.ListField(child=serializers.CharField(), help_text="删掉的旧模型 / 旧维度索引")
    status = EmbeddingStatusSerializer()


# ── 备用供应商(docs/ARCHITECTURE-soul-assist.md §13)────────────────────────


class BackupUpdateSerializer(CandidateSerializer):
    """与主用的连接同一组字段,另加备用自己的价目表。连接变了要先测通**同一套**(`config/backup/test/`)。"""

    prices = serializers.DictField(child=PriceSerializer(), required=False,
                                   help_text="备用的价目表(模型名 → 每百万 token 价),与主用的分开")


class BreakerSerializer(serializers.Serializer):
    open = serializers.BooleanField(help_text="断开中:主用不试,直接用备用")
    open_until = serializers.DateTimeField(allow_null=True)
    consecutive_failures = serializers.IntegerField()
    threshold = serializers.IntegerField()
    open_seconds = serializers.IntegerField()


class BackupConfigSerializer(serializers.Serializer):
    configured = serializers.BooleanField()
    platform = serializers.ChoiceField(choices=platforms.PLATFORM_IDS, allow_null=True)
    provider = serializers.CharField(allow_null=True)
    base_url = serializers.CharField(allow_null=True, allow_blank=True)
    model = serializers.CharField(allow_null=True)
    effort = serializers.CharField(allow_null=True, allow_blank=True)
    fallbacks = serializers.BooleanField(allow_null=True)
    prices = serializers.DictField(child=PriceSerializer())
    api_key = ApiKeyStateSerializer(help_text="备用那个平台的 key;与主用同平台时就是同一格")
    api_key_slot = serializers.CharField(allow_null=True)
    breaker = BreakerSerializer(help_text="主用的断路器")
    primary_first_token_seconds = serializers.FloatField()
