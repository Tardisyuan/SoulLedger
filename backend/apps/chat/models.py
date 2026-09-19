"""灵魂端聊天:Matrix 身份、会话索引、私聊请求节流。

**消息正文不在这里,一条也没有。** 正文与历史在 Synapse;这几张表只放「谁可以和谁
说话、房间是哪一个、请求还剩几小时」—— 也就是策略,而策略必须在后端执行
(2026-09-17 用户决定的四条聊天规则)。所以审计里也不会有正文:审计写的是这些行的变化。

**按分库约束写**(与 `apps/soul_accounts/models.py`、`apps/soul_push/models.py` 同一条):
UUID 主键;只有同租户外键;跨文明的动作走事件。

**只有 `Conversation` 存了 tenant 列,而那一列不是「灵魂现在在哪」。** 另两张表照旧不存,
租户经 `soul__tenant` 一跳读出。会话存它,是因为会话的租户是**收件人**,不是主体的属性:
官员收件箱是发给某个殿司的,那个殿司在灵魂暂居结束、回归原文明之后**不会改变** ——
否则 X 殿司的官员会丢掉自己正在回的那串消息,而 Y 殿司的官员会突然看见它。
私聊同理:建房那一刻双方同在哪个文明,是这段关系被允许的依据,事后谁调拨走了都不改。
"""
import uuid

from django.db import models


class ConversationKind(models.TextChoices):
    DIRECT = "DIRECT", "灵魂私聊"
    OFFICER_INBOX = "OFFICER_INBOX", "官员收件箱"


class ChatIdentity(models.Model):
    """一个灵魂账号的 Matrix 用户。

    **每一世一个**,与 `SoulAccount` 一对一:转世停用账号时这个 Matrix 用户也被停用并
    踢出所有房间(`services.deactivate_for_account`),新一世换新账号、于是换新 mxid ——
    前世的聊天历史不会跟着人走。

    `localpart` 由账号 id 经 HMAC 派生(`identity.localpart_for`),不含灵魂编号、
    姓名、邮箱或手机号:mxid 会出现在对方客户端、Synapse 日志与房间事件里,
    而灵魂编号正是登录名。派生而非随机,是为了同一个账号重复调用得到同一个人。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.OneToOneField(
        "soul_accounts.SoulAccount", on_delete=models.CASCADE, related_name="chat_identity"
    )
    # 冗余 soul:租户隔离按 `soul__tenant` 一跳(与 InitialCredential / PushDevice 同一理由)。
    soul = models.ForeignKey("souls.Soul", on_delete=models.CASCADE, related_name="chat_identities")
    localpart = models.CharField(max_length=64, unique=True)
    matrix_user_id = models.CharField(max_length=255, unique=True)
    deactivated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.matrix_user_id


class Conversation(models.Model):
    """一个 Matrix 房间,以及它为什么被允许存在。

    DIRECT:两个灵魂。`soul_a` / `soul_b` **按 UUID 升序存**,于是「一对灵魂一个房间」
    是一条数据库唯一约束,而不是服务层查一遍再但愿没有并发。

    OFFICER_INBOX:`soul_b` 为空,`tenant` 是收件的殿司。同一个灵魂在不同殿司各有一份
    (暂居时给暂居地的殿司写信,是本轮规则里明确的「当前所在」)。

    `throttled` 是第 2 条规则的执行点:非互关发起的私聊,发起方在 Matrix 里的
    power level 是 0(发不出消息),唯一的发送口是后端的
    `POST /me/chat/conversations/{id}/messages/`,它按 `last_request_at` 卡 24 小时。
    对方回过一句(`responded_at`)或两人互关之后,后端把 power level 提回 50 并清掉
    `throttled` —— 从那以后这个房间和互关房间没有区别,消息不再经过后端。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=20, choices=ConversationKind.choices)
    room_id = models.CharField(max_length=255, unique=True)
    soul_a = models.ForeignKey("souls.Soul", on_delete=models.CASCADE, related_name="chat_conversations_a")
    soul_b = models.ForeignKey(
        "souls.Soul", on_delete=models.CASCADE, null=True, blank=True, related_name="chat_conversations_b"
    )
    tenant = models.ForeignKey("tenants.Tenant", on_delete=models.PROTECT, related_name="chat_conversations")
    #: 双方各是**哪一世的账号**(`account_a` 对应 `soul_a`)。会话属于那一世,不属于灵魂:
    #: 列表按它筛(本世账号只看见自己那一世参与的会话,包括已闭的),对方名字按它取
    #: (不随对方转世变化),发言权也按它算 —— 新一世的账号永远不会被算进前世的房间。
    #: 可空只为迁移:存量行由 chat/0003 补上,新行在建房时写。
    account_a = models.ForeignKey(
        "soul_accounts.SoulAccount", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    account_b = models.ForeignKey(
        "soul_accounts.SoulAccount", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    #: 谁发起的私聊请求。互关直接建房时为空 —— 没有被节流的一方。
    initiator = models.ForeignKey(
        "souls.Soul", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    throttled = models.BooleanField(default=False)
    last_request_at = models.DateTimeField(null=True, blank=True)
    responded_at = models.DateTimeField(null=True, blank=True)
    last_message_at = models.DateTimeField(null=True, blank=True)
    #: 一方转世停用账号时关闭(`services.deactivate_for_account`)。关闭的会话仍列给**那一世**
    #: 留下的一方(只读,App 标「会话止于此」),官员侧仍可读、不可回;新一世再开同一对灵魂的私聊是
    #: **新房间** —— 前世的聊天不跟着人走。
    closed_at = models.DateTimeField(null=True, blank=True)
    #: 关闭之后,房间里还在的一方已在 Synapse 上降到 0 的时刻。为空 = 还欠一次降权:
    #: `sync_rooms` 连同未关闭的房间一起重算它,直到写成功(与发言权的其余同步同一条路)。
    silenced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-last_message_at", "-created_at"]
        indexes = [
            models.Index(fields=["tenant", "kind", "last_message_at"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["soul_a", "soul_b"],
                condition=models.Q(kind="DIRECT", closed_at__isnull=True),
                name="chat_one_open_direct_room_per_pair",
            ),
            models.UniqueConstraint(
                fields=["soul_a", "tenant"],
                condition=models.Q(kind="OFFICER_INBOX", closed_at__isnull=True),
                name="chat_one_open_inbox_per_soul_and_hall",
            ),
            # 形状由数据库兜底,不是由「服务层总是记得排序」兜底:soul_a < soul_b 一旦
            # 不成立,上面那条唯一约束就挡不住同一对灵魂的第二个房间。
            models.CheckConstraint(
                condition=(
                    models.Q(kind="DIRECT", soul_b__isnull=False)
                    & models.Q(soul_a__lt=models.F("soul_b"))
                ) | models.Q(kind="OFFICER_INBOX", soul_b__isnull=True),
                name="chat_conversation_shape",
            ),
        ]

    def __str__(self):
        return f"{self.kind} {self.room_id}"

    def other_soul_id(self, soul_id):
        """DIRECT 会话里的另一方。不是参与方时返回 None。"""
        if self.soul_a_id == soul_id:
            return self.soul_b_id
        if self.soul_b_id == soul_id:
            return self.soul_a_id
        return None

    def has_account(self, account_id):
        return account_id is not None and account_id in (self.account_a_id, self.account_b_id)

    def other_account(self, account_id):
        """DIRECT 会话里对方**那一世**的账号。"""
        if self.account_a_id == account_id:
            return self.account_b
        if self.account_b_id == account_id:
            return self.account_a
        return None
