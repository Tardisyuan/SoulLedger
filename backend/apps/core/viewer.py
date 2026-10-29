"""跨殿读的字段口径(决定 24,2026-10-29):读的人属于哪一殿。

别殿的行只给「自己那一站 + 对方殿名」—— 各序列化器的 `to_representation` 拿这里的结果和行的殿比,
不同殿就收掉对方的人名与意见原文。
"""

#: 看全部:没有请求(服务内部序列化、通知正文)或全局 ADMIN。
SEE_ALL = object()


def viewer_tenant_id(request):
    """``SEE_ALL``,或读者所在殿的 pk(没有殿的非 ADMIN 是 None,与任何行都不同殿)。"""
    from apps.core.tenant import is_tenant_exempt

    if request is None:
        return SEE_ALL
    user = getattr(request, "user", None)
    if is_tenant_exempt(user):
        return SEE_ALL
    tenant = getattr(request, "tenant", None)
    return tenant.pk if tenant is not None else getattr(user, "tenant_id", None)
