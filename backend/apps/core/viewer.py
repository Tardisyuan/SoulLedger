"""跨殿读的字段口径(决定 24,2026-10-29):读的人属于哪一殿。

别殿的行只给「自己那一站 + 对方殿名」—— 各序列化器的 `to_representation` 拿这里的结果和行的殿比,
不同殿就收掉对方的人名与意见原文。
"""

#: 看全部:没有请求(服务内部序列化、通知正文)或 SYSTEM_ADMIN。
SEE_ALL = object()


def viewer_tenant_id(request):
    """``SEE_ALL``;文明管理员是它那个文明各殿 pk 的 frozenset;否则读者所在殿的 pk(没有殿的非 ADMIN 是 None,
    与任何行都不同殿)。和行的殿比用 ``sees``。"""
    from apps.core.tenant import admin_hall_ids, is_civilization_admin, is_tenant_exempt

    if request is None:
        return SEE_ALL
    user = getattr(request, "user", None)
    if is_tenant_exempt(user):
        return SEE_ALL
    if is_civilization_admin(user):
        return admin_hall_ids(user)
    tenant = getattr(request, "tenant", None)
    return tenant.pk if tenant is not None else getattr(user, "tenant_id", None)


def sees(viewer, *tenant_ids) -> bool:
    """``viewer``(``viewer_tenant_id`` 的结果)是否算任一 ``tenant_ids`` 那一殿的人。"""
    if viewer is SEE_ALL:
        return True
    if isinstance(viewer, frozenset):
        return any(pk in viewer for pk in tenant_ids)
    return viewer in tenant_ids
