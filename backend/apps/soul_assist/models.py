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


class AssistConversation(SoftDeleteMixin, models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey("soul_accounts.SoulAccount", on_delete=models.CASCADE,
                                related_name="assist_conversations")
    screen = models.CharField(max_length=20, choices=[(s, s) for s in SCREENS])
    created_at = models.DateTimeField(auto_now_add=True)
    last_active_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-last_active_at"]
        indexes = [models.Index(fields=["account", "screen", "-last_active_at"])]


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
