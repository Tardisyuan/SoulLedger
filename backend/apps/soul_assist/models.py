"""助手会话(docs/ARCHITECTURE-soul-assist.md §4.2)。

**按账号,不按灵魂。** 与书信同一条:新的一世看不见前世的会话;前世账号停用后,
它的会话由 `purge_history` 立刻真删。

**这是本仓库第一处把灵魂的自由文本落库并发给第三方的地方**(决策 A3;书信刻意不存正文,
`tests/test_chat_policy.py`)。原文只在这里,保存 30 天;审计里只有哈希。
"""
import uuid

from django.db import models
from pgvector.django import VectorField

from apps.core.soft_delete import SoftDeleteMixin
from apps.death_sync.fields import EncryptedCharField

#: App 的「问一问」来自哪一页。只作提示(先调哪个工具、给哪些建议问题),不改变数据范围。
SCREENS = ("applications", "sentence", "life", "letters", "circle", "settings", "other")
#: 官员端 Web 的「问一问」来自哪一段路由(`frontend/app/<段>/`)。`tests/test_officer_assist_corpus.py`
#: 把它钉在前端的目录上:加一个页面而不加这里 → 红。
OFFICER_SCREENS = (
    "actors", "admin", "audit", "corpus", "cross-judgments", "dashboard", "death-sync", "dispatch",
    "disposition", "judgment", "ledger", "menus", "moderation", "notifications", "organizations",
    "permissions", "profile", "realms", "rebirth-applications", "recycle-bin", "scheduler",
    "sentence-requests", "social", "soul-credentials", "soul-inbox", "souls", "tenants", "users",
    "welcome", "workflow", "other",
)


class AssistConversation(SoftDeleteMixin, models.Model):
    """灵魂会话 `account` 有值;官员会话 `user` 有值(docs/ARCHITECTURE-officer-assist.md §3)。
    恰好一个有值,由库里的约束保证,不靠调用方自觉。"""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey("soul_accounts.SoulAccount", on_delete=models.CASCADE, null=True, blank=True,
                                related_name="assist_conversations")
    user = models.ForeignKey("authentication.User", on_delete=models.CASCADE, null=True, blank=True,
                             related_name="assist_conversations")
    screen = models.CharField(max_length=20, choices=[(s, s) for s in dict.fromkeys(SCREENS + OFFICER_SCREENS)])
    created_at = models.DateTimeField(auto_now_add=True)
    last_active_at = models.DateTimeField(auto_now_add=True, db_index=True)
    #: 管理页评测(`apps/soul_assist/evals.py`)开的会话:不续、不进本人的会话列表,留存与清理照常。
    is_eval = models.BooleanField(default=False)

    class Meta:
        ordering = ["-last_active_at"]
        indexes = [models.Index(fields=["account", "screen", "-last_active_at"]),
                   models.Index(fields=["user", "screen", "-last_active_at"])]
        constraints = [models.CheckConstraint(
            condition=models.Q(account__isnull=False, user__isnull=True)
            | models.Q(account__isnull=True, user__isnull=False),
            name="assist_conversation_one_owner")]


class AssistMessage(models.Model):
    ROLES = (("user", "user"), ("assistant", "assistant"))

    conversation = models.ForeignKey(AssistConversation, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=10, choices=ROLES)
    content = models.TextField()
    #: 这条回答调用过的工具名(按顺序)。只存名字,不存工具返回的数据 —— 回放历史也不回放它(§4.2)。
    tool_calls = models.JSONField(default=list, blank=True)
    tokens = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at", "id"]


# ── 管理页(docs/ARCHITECTURE-assist-admin.md)──────────────────────────────


class AssistConfig(models.Model):
    """单行。**没写进 `values` 的键就用 env**(env 是初始值;总开关的 env 还是硬上限),
    所以没人保存过时,行为与只有 env 时逐字节相同。读取走 `apps/soul_assist/config.py::effective`。"""

    #: 页面改过的键 → 值;键见 `config.EDITABLE`。API key 不在这里。
    values = models.JSONField(default=dict, blank=True)
    #: 密文存库(`ENCRYPTION_KEY`)。`api_key_set_at` 为空 = 没改过,用 env;不为空时 "" 表示已清除。
    api_key = EncryptedCharField(max_length=1000, blank=True, default="")
    api_key_set_at = models.DateTimeField(null=True, blank=True)
    #: 评测用的测试身份(§3.2);数据范围照正式规则走。
    eval_soul_account = models.ForeignKey("soul_accounts.SoulAccount", on_delete=models.SET_NULL, null=True,
                                          blank=True, related_name="+")
    eval_officer = models.ForeignKey("authentication.User", on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name="+")
    #: 月度上限的状态(用户 2026-09-29 定):本月已发过 80% 提醒的月份("YYYY-MM"),以及因超额被关掉的月份。
    #: 后者非空 = 总开关是**上限**关的,次月 1 日起首次读开关时自动重开;管理员手动改过开关就清空,不再自动开。
    cap_alert_sent_for = models.CharField(max_length=7, blank=True, default="")
    cap_closed_for = models.CharField(max_length=7, blank=True, default="")
    #: 上次重建向量(`vectors.sync`)的时间与所用模型(「模型」或「模型@截断维度」);管理页显示。
    vectors_synced_at = models.DateTimeField(null=True, blank=True)
    vectors_synced_model = models.CharField(max_length=220, blank=True, default="")
    #: 上次重建失败的原因(`vectors.ERROR_KINDS`)与时间;成功一次就清空。失败的那次什么都没换进去。
    vectors_error = models.CharField(max_length=30, blank=True, default="")
    vectors_error_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class AssistUsage(models.Model):
    """每次提问一行,**不含任何原文**:成功、空回答与各种失败都记,用量页与月度上限只读这张表。"""

    STATUSES = [(s, s) for s in ("ok", "empty", "unavailable", "busy", "rate_limited", "not_configured")]
    #: 这一问的帮助条目怎么来的(§7.5):向量检索的 top-k;向量服务不通 / 超时 / 库里没有向量时的整份语料;
    #: 最近一条也不够像时的整份语料。没走到检索的失败(未开通、忙)为空。
    RETRIEVALS = [(s, s) for s in ("vector", "fallback", "fallback_low_similarity")]
    SIDES = (("soul", "soul"), ("officer", "officer"))

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    side = models.CharField(max_length=10, choices=SIDES)
    tenant = models.ForeignKey("tenants.Tenant", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    status = models.CharField(max_length=20, choices=STATUSES)
    model = models.CharField(max_length=200, blank=True, default="")
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    cache_read_tokens = models.PositiveIntegerField(default=0)
    retrieval = models.CharField(max_length=30, choices=RETRIEVALS, blank=True, default="")
    #: 评测的请求:不计入用量与月度上限。
    is_eval = models.BooleanField(default=False)


class AssistEvalCase(models.Model):
    """评测集(§7 Q1 = A):我们起草、管理员增删;**不从灵魂的提问原文里取**。"""

    SIDES = AssistUsage.SIDES

    side = models.CharField(max_length=10, choices=SIDES)
    locale = models.CharField(max_length=10, choices=[("zh-Hans", "zh-Hans"), ("en", "en")], default="zh-Hans")
    screen = models.CharField(max_length=20, choices=[(s, s) for s in dict.fromkeys(SCREENS + OFFICER_SCREENS)])
    question = models.CharField(max_length=1000)
    expected_tools = models.JSONField(default=list, blank=True)
    must_include = models.JSONField(default=list, blank=True)
    must_not_include = models.JSONField(default=list, blank=True)
    #: 期望进入检索 top-k 的帮助条目 id(§7.6);空 = 这条用例不计检索命中率。
    expected_entries = models.JSONField(default=list, blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["side", "id"]


class AssistEvalRun(models.Model):
    STATUSES = [(s, s) for s in ("queued", "running", "done", "stopped_at_cap", "failed")]

    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey("authentication.User", on_delete=models.SET_NULL, null=True, related_name="+")
    status = models.CharField(max_length=20, choices=STATUSES, default="queued")
    #: 候选配置(一或两套);其中的 API key 是 Fernet 密文,响应里不出。
    candidates = models.JSONField(default=list)
    case_ids = models.JSONField(default=list)
    estimated_cost = models.FloatField(default=0)
    total = models.PositiveIntegerField(default=0)
    done = models.PositiveIntegerField(default=0)
    summary = models.JSONField(default=list, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


class AssistEvalResult(models.Model):
    run = models.ForeignKey(AssistEvalRun, on_delete=models.CASCADE, related_name="results")
    candidate = models.PositiveSmallIntegerField()
    case = models.ForeignKey(AssistEvalCase, on_delete=models.SET_NULL, null=True, related_name="+")
    #: 题目的快照:用例之后被改被删,旧的运行记录仍然读得懂。
    question = models.CharField(max_length=1000)
    side = models.CharField(max_length=10, choices=AssistUsage.SIDES)
    tools_called = models.JSONField(default=list)
    answer = models.TextField(blank=True, default="")
    error = models.CharField(max_length=40, blank=True, default="")
    tools_ok = models.BooleanField(default=False)
    included = models.JSONField(default=dict)  # 短语 → 是否出现
    excluded = models.JSONField(default=dict)  # 短语 → 是否(错误地)出现
    passed = models.BooleanField(default=False)
    #: 检索方式(AssistUsage.RETRIEVALS)、进了上下文的条目 id、期望条目是否在其中(用例没写期望 = None)。
    retrieval = models.CharField(max_length=30, blank=True, default="")
    retrieved = models.JSONField(default=list)
    retrieval_hit = models.BooleanField(null=True)
    latency_ms = models.PositiveIntegerField(default=0)
    tokens = models.JSONField(default=dict)
    cost = models.FloatField(null=True)

    class Meta:
        ordering = ["candidate", "id"]


class HelpChunk(models.Model):
    """帮助条目的向量(docs/ARCHITECTURE-soul-assist.md §7.3)。**条目即块**:一个 (语言, 条目) 一行。

    由 `vectors.sync` 维护,不手改。`embedding` 是**不定维**的 `vector`:换模型、换维度不用迁移,重建即可;
    检索只比同一 `model`、同一 `dims` 的行。SQLite 上同一列存成 `[x,y,…]` 文本,余弦在 Python 里算。
    过滤用的元数据(受众、文明)在检索时按当前语料文件取,这里的副本只供查看。"""

    entry_id = models.CharField(max_length=100)
    locale = models.CharField(max_length=10)
    audience = models.CharField(max_length=10)
    screens = models.JSONField(default=list)
    civilizations = models.JSONField(default=list)
    #: 送给模型的正文。
    content = models.TextField()
    #: 嵌入的文本(questions + 正文)连同截断维度的 SHA-256:两者任一变了就重嵌。
    content_hash = models.CharField(max_length=64)
    model = models.CharField(max_length=200)
    dims = models.PositiveIntegerField()
    embedding = VectorField()
    embedded_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["locale", "entry_id"], name="help_chunk_one_per_entry")]
        indexes = [models.Index(fields=["locale", "audience", "model", "dims"])]
