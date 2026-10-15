"""官员端 App(「灵魂簿 · 官员」)的推送设备。

与灵魂端的 `soul_push.PushDevice` 是**两张表**:官员的 token 不属于任何灵魂账号,
灵魂端的投递记录 / 回执 / 偏好机制也都不适用(官员端锁屏只写一句泛化的计数,不带内容)。
`token` 全局唯一:同一台手机换官员登录,是这一行换主人。
"""
import uuid

from django.conf import settings
from django.db import models

from apps.soul_push.models import PushPlatform


class OfficerPushDevice(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="officer_push_devices")
    token = models.CharField(max_length=255, unique=True)
    platform = models.CharField(max_length=10, choices=PushPlatform.choices)
    is_active = models.BooleanField(default=True)
    #: 注册时所在的登录会话(`sid`)。有它,到期 / 退出按**这台设备自己的会话**判;
    #: 没有(这个字段上线前的老登记、或注册请求不带 `sid`)沿用按人判断,下次登录重新注册时自然补上,不回填。
    session = models.ForeignKey("authentication.SignInSession", null=True, blank=True,
                                on_delete=models.SET_NULL, related_name="officer_push_devices")
    last_seen_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["user", "is_active"])]
