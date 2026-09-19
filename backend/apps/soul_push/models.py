"""灵魂端推送:设备令牌、推送偏好、投递记录。

通道是 Expo Push Service(2026-09-17 用户决定):后端把消息交给 Expo,Expo 转 APNs / FCM。
流程见 `services.py` 文件头。

**按分库约束写**(与 `apps/soul_accounts/models.py` 同一条):UUID 主键;只有同租户外键
(灵魂、它自己的账号);不存 tenant 列,租户经 `soul__tenant` 一跳读出。
"""
import uuid

from django.db import models


class PushPlatform(models.TextChoices):
    IOS = "IOS", "iOS"
    ANDROID = "ANDROID", "Android"


class DeviceInvalidReason(models.TextChoices):
    UNREGISTERED = "UNREGISTERED", "灵魂注销"
    ACCOUNT_RETIRED = "ACCOUNT_RETIRED", "账号转世停用"
    DEVICE_NOT_REGISTERED = "DEVICE_NOT_REGISTERED", "Expo 回报设备未注册"


class PushDevice(models.Model):
    """一个 Expo push token 与它**当前**属于的灵魂账号。

    `token` 全局唯一:同一台手机换账号登录,是这一行换主人,而不是两行各自有效 ——
    两行并存就是「上一个灵魂的通知推到下一个灵魂的手机上」。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey("soul_accounts.SoulAccount", on_delete=models.CASCADE, related_name="push_devices")
    # 冗余 soul:租户隔离按 `soul__tenant` 一跳(与 InitialCredential 同一理由)。
    soul = models.ForeignKey("souls.Soul", on_delete=models.CASCADE, related_name="push_devices")
    token = models.CharField(max_length=255, unique=True)
    platform = models.CharField(max_length=10, choices=PushPlatform.choices)
    is_active = models.BooleanField(default=True)
    invalid_reason = models.CharField(max_length=30, choices=DeviceInvalidReason.choices, blank=True, default="")
    last_seen_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["account", "is_active"])]


class PushLocale(models.TextChoices):
    # 与 packages/core/src/config/locale.ts 的 SUPPORTED_LOCALES 同一组。
    ZH_HANS = "zh-Hans", "简体中文"
    EN = "en", "English"
    EGY = "egy", "Medu Netjer"


class PushPreference(models.Model):
    """一个账号的推送偏好。没有这一行 = 全部开启、zh-Hans。

    **按账号(每一世)而不是按灵魂**:新一世是新账号、要重新注册设备,偏好随之从默认开始。
    跨世沿用是另一种合理读法 —— 待用户确认。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.OneToOneField(
        "soul_accounts.SoulAccount", on_delete=models.CASCADE, related_name="push_preference"
    )
    soul = models.ForeignKey("souls.Soul", on_delete=models.CASCADE, related_name="push_preferences")
    rebirth = models.BooleanField(default=True, help_text="转生申请:提交确认、申诉确认、结果")
    judgment = models.BooleanField(default=True, help_text="审判结论与处置执行")
    residence = models.BooleanField(default=True, help_text="暂居开始 / 回归(依赖 feat/dispatch-residence)")
    chat = models.BooleanField(default=True, help_text="新书信:私聊的新消息、殿司的回信")
    locale = models.CharField(max_length=10, choices=PushLocale.choices, default=PushLocale.ZH_HANS)
    updated_at = models.DateTimeField(auto_now=True)


class PushStatus(models.TextChoices):
    QUEUED = "QUEUED", "待发送"
    SENDING = "SENDING", "发送中"            # 已被一个 worker 认领;卡住由 sweep 退回 QUEUED
    SENT = "SENT", "已交给 Expo"             # 有 ticket id,等回执
    DELIVERED = "DELIVERED", "回执成功"      # Expo 已交给 APNs / FCM
    FAILED = "FAILED", "失败"
    DISABLED = "DISABLED", "推送未启用"      # SOUL_PUSH_ENABLED 未打开:照常记录,开启后 24 小时内的补发
    EXPIRED = "EXPIRED", "已过期"            # 未启用期间记录、开启时已超过 24 小时:不补发,不删
    CANCELLED = "CANCELLED", "已取消"        # 发送前设备已失效或已转给别的账号


class PushDelivery(models.Model):
    """一个事件对一台设备的一次推送。

    `(dedupe_key, device)` 唯一 —— **幂等的主体**。`dedupe_key` 由业务主键拼成
    (如 `rebirth:<申请 id>:APPROVED`),不是事件的随机 id:同一件事被发布两次,
    第二次在这里撞约束,不会再推一遍。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    dedupe_key = models.CharField(max_length=120)
    device = models.ForeignKey(PushDevice, on_delete=models.CASCADE, related_name="deliveries")
    account = models.ForeignKey("soul_accounts.SoulAccount", on_delete=models.CASCADE, related_name="push_deliveries")
    soul = models.ForeignKey("souls.Soul", on_delete=models.CASCADE, related_name="push_deliveries")
    event_type = models.CharField(max_length=40)
    kind = models.CharField(max_length=40)
    title = models.CharField(max_length=120)
    body = models.CharField(max_length=300)
    data = models.JSONField(default=dict)
    status = models.CharField(max_length=10, choices=PushStatus.choices, default=PushStatus.QUEUED)
    ticket_id = models.CharField(max_length=64, blank=True, default="")
    error = models.CharField(max_length=200, blank=True, default="")
    attempts = models.PositiveIntegerField(default=0)
    next_attempt_at = models.DateTimeField(null=True, blank=True, help_text="可重试失败后的退避到期时刻")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    receipt_checked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["dedupe_key", "device"], name="push_delivery_once_per_device"),
        ]
        indexes = [
            models.Index(fields=["status", "created_at"]),
            models.Index(fields=["status", "sent_at"]),
        ]
