"""受刑计划(处置流程节点)。设计稿:docs/ARCHITECTURE-sentence-plan.md。

阶段 1 加模型;阶段 2 接推进(`services.py`);阶段 3 接加减项请求、重开审判与撤销。

分库约束(设计稿 §1.3):新表 UUID 主键;执行地用 `tenant_code` 字符串;引用别的租户
可能持有的行(处置、调拨记录、审判)一律裸 `UUIDField`,不加跨租户外键。
`SentencePlan.tenant` / `soul` 是本库外键:计划与灵魂同在原属库。
"""
import uuid

from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import Q

from apps.core.models import AuditUserFields
from apps.disposition.models import MemoryResetMechanism
from apps.tenants.managers import TenantManager


class SentencePlanStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "执行中"
    # 原属有一件未结案的重开审判;外地照常执行,刑满进 WAITING,不推进(Q7)。
    RETRIAL = "RETRIAL", "重审中"
    # 某节点是永久刑期,灵魂留在那里;后面没有节点(Q5 在联审时校验)。
    HELD = "HELD", "永久刑期挂起"
    COMPLETED = "COMPLETED", "已完成"
    CANCELLED = "CANCELLED", "已撤销"


#: 「进行中」:一个灵魂同一时刻至多一份(部分唯一约束)。设计稿 §2.3 写的是 ACTIVE / HELD;
#: RETRIAL(Q7 之后才加的状态)同样是进行中,一并纳入。
IN_PROGRESS_PLAN_STATUSES = (SentencePlanStatus.ACTIVE, SentencePlanStatus.RETRIAL, SentencePlanStatus.HELD)


class SentenceNodeStatus(models.TextChoices):
    PENDING = "PENDING", "未开始"
    DISPATCHING = "DISPATCHING", "调拨中"
    ACTIVE = "ACTIVE", "受刑中"
    # 处置已执行,但有未结案审判,灵魂暂留执行地(Q7「刑满暂留」)。
    WAITING = "WAITING", "刑满暂留"
    COMPLETED = "COMPLETED", "已完成"
    ETERNAL = "ETERNAL", "永久刑期"
    ABORTED = "ABORTED", "手动结束"
    REMOVED = "REMOVED", "已减项"
    CANCELLED = "CANCELLED", "随计划撤销"


#: 不再占序号的节点(设计稿 §2.3:序号唯一只排除这两种)。已完成 / 永久 / 手动结束的
#: 节点是历史,仍占着自己的序号 —— 加项「序号顺延」只挪 PENDING 的。
VACATED_NODE_STATUSES = (SentenceNodeStatus.REMOVED, SentenceNodeStatus.CANCELLED)
#: 灵魂正被这个节点占着:同一计划里至多一个。设计稿 §2.3 写的是 DISPATCHING / ACTIVE;
#: WAITING(Q7 之后才加的状态)同样是「灵魂在那里」,一并纳入。
OCCUPYING_NODE_STATUSES = (SentenceNodeStatus.DISPATCHING, SentenceNodeStatus.ACTIVE, SentenceNodeStatus.WAITING)


class SentenceRequestKind(models.TextChoices):
    AMEND = "AMEND", "加项 / 减项"
    REOPEN = "REOPEN", "重开审判"


class SentenceRequestStatus(models.TextChoices):
    PENDING = "PENDING", "待原审判官决定"
    ACCEPTED = "ACCEPTED", "已批准"
    REJECTED = "REJECTED", "已驳回"
    WITHDRAWN = "WITHDRAWN", "已撤回"


class SentencePlan(AuditUserFields, models.Model):
    """一份审判结论生成的、有序的受刑计划。属于灵魂的原属租户。"""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    soul = models.ForeignKey("souls.Soul", on_delete=models.CASCADE, related_name="sentence_plans")
    #: = soul.home_tenant(结案当时)。计划归原属文明,与转生申请、灵魂账号同一归属规则。
    tenant = models.ForeignKey("tenants.Tenant", on_delete=models.CASCADE, related_name="sentence_plans", null=True)
    #: 第几世,与 Judgment.cycle 同义。
    cycle = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=20, choices=SentencePlanStatus.choices, default=SentencePlanStatus.ACTIVE)
    #: 生成它的那份结案审判(ORIGINAL)。裸 UUID:审判在原属库,今天同库,分库后仍不加外键。
    origin_judgment_id = models.UUIDField(null=True, blank=True, db_index=True)
    #: 挂在那份审判上的联审(Q1);退化情况(单文明审判)为空。
    cross_judgment_id = models.UUIDField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.TextField(blank=True, default="")

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    class Meta:
        ordering = ["-create_time"]
        verbose_name = "Sentence plan"
        verbose_name_plural = "Sentence plans"
        constraints = [
            # 两次结案并发不会生成两份进行中的计划(与 dispatch 的 unique_active_dispatch 同形)。
            models.UniqueConstraint(
                fields=["soul"],
                condition=Q(is_deleted=False) & Q(status__in=[s.value for s in IN_PROGRESS_PLAN_STATUSES]),
                name="unique_in_progress_sentence_plan",
            ),
        ]
        indexes = [
            models.Index(fields=["soul", "cycle"]),
            models.Index(fields=["tenant", "status"]),
        ]

    def __str__(self):
        return f"SentencePlan {self.soul_id} cycle {self.cycle} ({self.status})"


class SentenceNode(AuditUserFields, models.Model):
    """计划里的一站:在 `tenant_code` 那个文明执行一份处置。"""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan = models.ForeignKey(SentencePlan, on_delete=models.CASCADE, related_name="nodes")
    #: 1 起;第 1 个恒为原属地节点(约束)。重开审判加的原属节点排在后面(N1=(a))。
    order = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    #: 执行地。字符串,不是外键(分库约束)。
    tenant_code = models.CharField(max_length=50)
    #: 执行地是原属(冗余列,便于「首个节点是原属」这条约束)。
    is_home = models.BooleanField(default=False)
    status = models.CharField(max_length=20, choices=SentenceNodeStatus.choices, default=SentenceNodeStatus.PENDING)

    # 处置内容。外地节点抄自联审参与方(阶段 2);原属节点抄自结案生成的处置。
    realm_code = models.CharField(max_length=50, blank=True, default="")
    sentence_years = models.IntegerField(null=True, blank=True, validators=[MinValueValidator(0)])
    is_eternal = models.BooleanField(default=False)
    memory_reset = models.CharField(
        max_length=20, choices=MemoryResetMechanism.choices, default=MemoryResetMechanism.NONE,
    )

    # 引用,一律裸 UUID(可能在别的租户的库里)。
    disposition_id = models.UUIDField(null=True, blank=True, db_index=True)
    dispatch_record_id = models.UUIDField(null=True, blank=True)
    added_by_judgment_id = models.UUIDField(null=True, blank=True)
    added_by_request_id = models.UUIDField(null=True, blank=True)
    removed_by_request_id = models.UUIDField(null=True, blank=True)

    #: 判官给的理由。官员可见,灵魂不可见(Q10)。
    reason = models.TextField(blank=True, default="")
    activated_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["plan", "order"]
        verbose_name = "Sentence node"
        verbose_name_plural = "Sentence nodes"
        constraints = [
            models.UniqueConstraint(
                fields=["plan", "order"],
                condition=Q(is_deleted=False) & ~Q(status__in=[s.value for s in VACATED_NODE_STATUSES]),
                name="unique_live_sentence_node_order",
            ),
            models.UniqueConstraint(
                fields=["plan"],
                condition=Q(is_deleted=False) & Q(status__in=[s.value for s in OCCUPYING_NODE_STATUSES]),
                name="unique_occupying_sentence_node",
            ),
            # 「优先执行原属地」是约束不是约定。原来是「原属节点有且只有一个,且 order=1」;
            # N1=(a)(2026-09-19):重开审判结案会加一个新的原属节点,于是放宽为「首个节点是原属」。
            models.CheckConstraint(
                condition=~Q(order=1) | Q(is_home=True),
                name="first_sentence_node_is_home",
            ),
            models.CheckConstraint(condition=Q(order__gte=1), name="sentence_node_order_positive"),
            models.CheckConstraint(
                condition=Q(sentence_years__isnull=True) | Q(sentence_years__gte=0),
                name="sentence_node_years_not_negative",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant_code", "status"]),
        ]

    def __str__(self):
        return f"Node {self.order} @{self.tenant_code} ({self.status})"


class SentencePlanRequest(AuditUserFields, models.Model):
    """执行地判官向原审判官提出的加项 / 减项 / 重开审判请求(设计稿 §4)。阶段 3 才有写路径。"""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan = models.ForeignKey(SentencePlan, on_delete=models.CASCADE, related_name="requests")
    from_tenant_code = models.CharField(max_length=50)
    kind = models.CharField(max_length=10, choices=SentenceRequestKind.choices)
    #: {"add": [{"tenant_code", "realm_code", "sentence_years", "reason"}], "remove": ["<node_id>"]}
    changes = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=10, choices=SentenceRequestStatus.choices, default=SentenceRequestStatus.PENDING)
    #: 情况 1 背后那份本地加减项审判;2.x 为空。
    requested_by_judgment_id = models.UUIDField(null=True, blank=True)
    reason = models.TextField(blank=True, default="")
    decision_reason = models.TextField(blank=True, default="")
    decided_by = models.ForeignKey(
        "authentication.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="sentence_requests_decided",
    )
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-create_time"]
        verbose_name = "Sentence plan request"
        verbose_name_plural = "Sentence plan requests"
        constraints = [
            models.UniqueConstraint(
                fields=["plan"],
                condition=Q(is_deleted=False) & Q(status="PENDING"),
                name="unique_pending_sentence_request",
            ),
        ]

    def __str__(self):
        return f"Request {self.kind} from {self.from_tenant_code} ({self.status})"
