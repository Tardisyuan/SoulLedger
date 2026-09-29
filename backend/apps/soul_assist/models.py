"""助手会话(docs/ARCHITECTURE-soul-assist.md §4.2)。

**按账号,不按灵魂。** 与书信同一条:新的一世看不见前世的会话;前世账号停用后,
它的会话由 `purge_history` 立刻真删。

**这是本仓库第一处把灵魂的自由文本落库并发给第三方的地方**(决策 A3;书信刻意不存正文,
`tests/test_chat_policy.py`)。原文只在这里,保存 30 天;审计里只有哈希。
"""
import uuid

from django.db import models

from apps.core.soft_delete import SoftDeleteMixin

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
