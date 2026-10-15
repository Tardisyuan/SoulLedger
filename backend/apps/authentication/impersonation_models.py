"""「以此人身份查看」的一次会话(Design 第二十八批 W6)。

一行 = 一次代看。令牌只是凭据,**这一行才是真相**:提前退出、到点、被新一次代看顶掉,
都是给 `ended_at` 落值,令牌随即被认证层拒绝(`impersonation.enforce`)。
看过的页面不逐次记审计,只在这一行上累计,结束时一并写进那一条「结束代看」。
"""
from django.conf import settings
from django.db import models


class Impersonation(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="impersonations_started")
    target = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="impersonations_received")
    reason = models.CharField(max_length=200)
    started_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    #: manual / expired / superseded
    ended_how = models.CharField(max_length=16, blank=True, default="")
    #: 看过的不同页面(前端随每个请求带 `X-Imp-Page`);条数有上限,只增不减。
    pages = models.JSONField(default=list, blank=True)

    class Meta:
        indexes = [models.Index(fields=["actor", "ended_at"])]
