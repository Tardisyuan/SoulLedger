"""灵魂端账号、初始凭据、转生申请。

设计的权威是 docs/ARCHITECTURE-soul-app-and-domain-split.md 文首两段用户决策
(2026-09-14、2026-09-17)。这里只写代码层面的约束。

**按分库约束写**(同文档 2026-09-17「顺序」):主键 UUID;只有同租户的外键
(灵魂、它自己的账号、它自己的工作流);不存 tenant 列 —— 租户经 `soul__home_tenant`
读出(原属租户;调拨是暂居,暂居不改变账号与申请归谁管),于是这几张表不会留下一个过期的租户值。跨文明的动作(转生申请被
判定跨文明)只发事件,不写别的租户的数据。
"""
import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.death_sync.fields import EncryptedCharField
from apps.reincarnation.models import RebirthForm


class AccountOrigin(models.TextChoices):
    DEATH_SYNC = "DEATH_SYNC", "死亡同步自动开通"
    OFFICER = "OFFICER", "官员手动开通"
    BACKFILL = "BACKFILL", "存量补齐"


class SoulAccount(models.Model):
    """一个灵魂某一世的登录账号。

    **每一世一个**:(soul, cycle) 唯一。转世完成时本行 `retired_at` 被写上、关联
    User 停用,**这是终态** —— 没有任何代码路径把它清回 NULL,登录也只找
    `retired_at IS NULL` 的那一行(`current_account_of`),所以前世账号永不可再登录。

    `previous_account` 只供官员追溯与审计。灵魂端读前世数据一律按
    `soul_id + cycle < 本世` 查,**不沿这条链递归**(设计文档「实施约束」)。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="soul_account"
    )
    soul = models.ForeignKey("souls.Soul", on_delete=models.CASCADE, related_name="accounts")
    cycle = models.PositiveIntegerField(help_text="这个账号属于第几世;0 是第一世。")
    previous_account = models.OneToOneField(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="next_account"
    )
    origin = models.CharField(max_length=20, choices=AccountOrigin.choices)
    must_change_password = models.BooleanField(default=True)
    # 初始密码(以及官员重置出来的密码)的有效期。首次改密后清空:之后的密码
    # 由灵魂自己设,不过期。
    initial_password_expires_at = models.DateTimeField(null=True, blank=True)
    retired_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["soul", "cycle"]
        constraints = [
            models.UniqueConstraint(fields=["soul", "cycle"], name="soul_account_one_per_life"),
            # 同一时刻只有一个可登录的账号。与上一条互补:上一条挡并发死亡同步,
            # 这一条挡「转世没停用旧号就开了新号」这类顺序错误。
            models.UniqueConstraint(
                fields=["soul"], condition=Q(retired_at__isnull=True),
                name="soul_account_one_current",
            ),
        ]

    def __str__(self):
        return f"{self.soul_id} cycle {self.cycle}"


class CredentialStatus(models.TextChoices):
    QUEUED = "QUEUED", "待发送"          # 已入库,等事务提交后发送(outbox)
    SENT = "SENT", "已发送"              # 渠道已接受;明文已抹掉
    PENDING = "PENDING", "待交付"        # 无可用渠道或发送失败;明文加密保存,等官员处理
    REVEALED = "REVEALED", "已查看"      # 官员看过一次;明文已抹掉,只能等标记交付或重置
    DELIVERED = "DELIVERED", "已线下交付"
    VOID = "VOID", "已作废"              # 过期、被重置取代、或灵魂已改密


#: 明文还可能在库里的状态。
SECRET_BEARING_STATUSES = (CredentialStatus.QUEUED, CredentialStatus.PENDING)


class InitialCredential(models.Model):
    """一次签发的初始密码,及其投递。

    **明文只在两种状态下存在,且加密**(`EncryptedCharField`):QUEUED(等事务
    提交后发送,进程在这之间崩了也不丢)与 PENDING(待交付)。发送成功、官员查看
    一次、过期、被重置取代,都会把它抹成空串。「原文不落库」在这里的准确含义是:
    **成功发出去的密码不留原文**;发不出去的必须留到有人交付,否则就丢了。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey(SoulAccount, on_delete=models.CASCADE, related_name="credentials")
    # 冗余一个 soul 外键,为了按 `soul__home_tenant` 一跳做租户隔离(tests/test_tenant_scoping_contract.py 只认一跳)。
    soul = models.ForeignKey("souls.Soul", on_delete=models.CASCADE, related_name="initial_credentials")
    channel = models.CharField(max_length=10, blank=True, default="", help_text="EMAIL / SMS;空表示没有可用渠道")
    status = models.CharField(max_length=10, choices=CredentialStatus.choices)
    secret = EncryptedCharField(max_length=512, blank=True, default="")
    expires_at = models.DateTimeField()
    attempts = models.PositiveIntegerField(default=0)
    last_error = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    revealed_at = models.DateTimeField(null=True, blank=True)
    revealed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    delivered_at = models.DateTimeField(null=True, blank=True)
    delivered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status", "created_at"])]


class RebirthApplicationStatus(models.TextChoices):
    UNDER_REVIEW = "UNDER_REVIEW", "审批中"
    REJECTED = "REJECTED", "已驳回"            # 可申诉一次
    APPEALING = "APPEALING", "申诉中"
    APPEAL_REJECTED = "APPEAL_REJECTED", "申诉被驳回"
    APPROVED = "APPROVED", "已批准"


OPEN_APPLICATION_STATUSES = (RebirthApplicationStatus.UNDER_REVIEW, RebirthApplicationStatus.APPEALING)


class RebirthApplication(models.Model):
    """灵魂发起的转生申请。审批本身是一个 `ApprovalWorkflow`(case_type
    REBIRTH_APPLICATION),申诉是另一个(is_appeal=True,original_workflow 指回来)。
    `status` 是两个工作流状态的投影,由 `rebirth.sync_from_workflow` 在工作流变化时写。

    灵魂只表达期望形态(`desired_form`);是否跨文明由判官初审决定
    (`cross_civilization`,NULL = 尚未决定)。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    soul = models.ForeignKey("souls.Soul", on_delete=models.CASCADE, related_name="rebirth_applications")
    account = models.ForeignKey(SoulAccount, on_delete=models.PROTECT, related_name="rebirth_applications")
    cycle = models.PositiveIntegerField()
    desired_form = models.CharField(max_length=20, choices=RebirthForm.choices)
    statement = models.TextField(blank=True, default="", max_length=2000)
    appeal_statement = models.TextField(blank=True, default="", max_length=2000)
    status = models.CharField(max_length=20, choices=RebirthApplicationStatus.choices)
    workflow = models.OneToOneField(
        "workflow.ApprovalWorkflow", on_delete=models.PROTECT, related_name="rebirth_application"
    )
    appeal_workflow = models.OneToOneField(
        "workflow.ApprovalWorkflow", null=True, blank=True, on_delete=models.PROTECT,
        related_name="rebirth_appeal",
    )
    cross_civilization = models.BooleanField(null=True, blank=True)
    # `rejection_reason` / `decided_at` 是**最近一次**决定:未申诉时是初审结论,申诉后是申诉结论
    # (APPROVED 或 APPEAL_REJECTED;申诉审理中两者为空)。冷却期起点读 `decided_at`,
    # 于是始终是最近一次终局驳回 —— 这层语义不变,冷却与 can_appeal 都不用改。
    #
    # 首次驳回另存两列(2026-09-17 用户决定):`appeal()` 在清空上面两列之前把它们抄到这里,
    # 申诉期间与申诉之后灵魂仍看得到当初为何被驳回、何时被驳回。选「另存首次」而不是「另存申诉结论」,
    # 是因为已有读 `rejection_reason` 的客户端读到的始终是最新结论,不会在申诉被驳回后读到旧理由。
    rejection_reason = models.TextField(blank=True, default="")
    decided_at = models.DateTimeField(null=True, blank=True)
    first_rejection_reason = models.TextField(blank=True, default="")
    first_decided_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["soul", "cycle"])]
        constraints = [
            # 「同时只能有一份进行中的申请」由数据库兜底;服务层另外锁账号行给出可读的 409。
            models.UniqueConstraint(
                fields=["soul"], condition=Q(status__in=list(OPEN_APPLICATION_STATUSES)),
                name="rebirth_application_one_open_per_soul",
            ),
        ]
