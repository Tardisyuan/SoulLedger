"""事件总线 → 推送记录。注册在 `apps/events/event_bus.py::configure_default_handlers` 的 soul 域。"""
import logging

from django.db import transaction

from apps.events.event_bus import DomainEventHandler, EventEnvelope

logger = logging.getLogger(__name__)


class SoulPushHandler(DomainEventHandler):
    def should_handle(self, envelope: EventEnvelope) -> bool:
        from apps.soul_push.services import HANDLED_EVENTS

        return envelope.event_type in HANDLED_EVENTS and bool(envelope.payload.get("soul_id"))

    def handle(self, envelope: EventEnvelope) -> None:
        from apps.soul_push import services

        outer = transaction.get_connection().in_atomic_block
        try:
            # 保存点:这里的一条失败语句在 PostgreSQL 上会中止**发布者的**整个事务
            # (CLAUDE.md「SQLITE HIDES A WHOLE CLASS OF DEFECT」)。推送是派生物,不能拖垮业务写入。
            with transaction.atomic():
                ids = services.record_for_event(envelope.event_type, envelope.payload, envelope.tenant_code)
        except Exception:
            logger.exception("SoulPushHandler: 记录推送失败 %s", envelope.event_type)
            return
        if not ids:
            return
        if outer:
            # 发布者的事务回滚 → 行不存在,这个回调也不会跑:回滚的事件不推。
            transaction.on_commit(lambda: services.enqueue(ids))
        else:
            services.enqueue(ids)
