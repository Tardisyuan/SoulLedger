"""暂居开始 / 回归不经事件总线:`apps/dispatch/services.py` 直接写 `SoulEvent`。这里接那两种。

只接 `RESIDENCE_ACTIONS` 里的 action。其余 SoulEvent 都是 AuditHandler 从总线事件写下的,
那些已经由 `SoulPushHandler` 处理过 —— 在这里再接一遍只会多一次(幂等挡得住,但没有理由)。
交给同一个 `SoulPushHandler.handle`:同样的保存点、同样的「提交后才入队」。
"""
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.events.models import SoulEvent


@receiver(post_save, sender=SoulEvent, dispatch_uid="soul_push_residence_events")
def _residence_event(sender, instance, created, **kwargs):
    from apps.events.event_bus import EventEnvelope
    from apps.soul_push.handler import SoulPushHandler
    from apps.soul_push.services import RESIDENCE_ACTIONS

    payload = instance.payload if isinstance(instance.payload, dict) else {}
    if not created or payload.get("action") not in RESIDENCE_ACTIONS:
        return
    SoulPushHandler().handle(EventEnvelope(
        event_type=instance.event_type,
        payload={**payload, "soul_id": str(instance.soul_id), "_event_id": str(instance.pk)},
        domain="soul",
        tenant_code=instance.tenant.code if instance.tenant_id else None,
    ))
