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
    last_seen_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["user", "is_active"])]
