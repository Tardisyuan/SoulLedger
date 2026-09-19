"""不经事件总线的 SoulEvent:这里接。

* 调拨批准 / 暂居开始 / 回归:`apps/dispatch/services.py` 直接写 `SoulEvent`(`RESIDENCE_ACTIONS`)。
* 受刑计划:`apps/sentence_plan/services.py` 直接写 `SoulEvent`(`SENTENCE_EVENTS`)。

其余 SoulEvent 都是 AuditHandler 从总线事件写下的,那些已经由 `SoulPushHandler` 处理过 ——
在这里再接一遍只会多一次(幂等挡得住,但没有理由)。
交给同一个 `SoulPushHandler.handle`:同样的保存点、同样的「提交后才入队」。
"""
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.events.models import SoulEvent


@receiver(post_save, sender=SoulEvent, dispatch_uid="soul_push_residence_events")
def _residence_event(sender, instance, created, **kwargs):
    from apps.events.event_bus import EventEnvelope
    from apps.soul_push.handler import SoulPushHandler
    from apps.soul_push.services import RESIDENCE_ACTIONS, SENTENCE_EVENTS

    payload = instance.payload if isinstance(instance.payload, dict) else {}
    if not created:
        return
    if payload.get("action") not in RESIDENCE_ACTIONS and instance.event_type not in SENTENCE_EVENTS:
        return
    SoulPushHandler().handle(EventEnvelope(
        event_type=instance.event_type,
        payload={**payload, "soul_id": str(instance.soul_id), "_event_id": str(instance.pk)},
        domain="soul",
        tenant_code=instance.tenant.code if instance.tenant_id else None,
    ))
