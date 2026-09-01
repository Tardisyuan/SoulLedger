"""EventBus webhook 的投递任务。

`WebhookHandler` 只负责**记下要投递什么**(在发布者的事务里),投递本身在这里。
两件事因此分开:一次投递的存在性由事务决定,一次投递的成败由 worker 决定。
"""
import hashlib
import hmac
import json
import logging
import urllib.error
import urllib.request

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)

#: 一条投递最多试几次。与 `WebhookConfig.max_retries` 取小者 —— 模型上的那个是
#: 租户能配的,这个是系统的上限,防止一个配了 999 的端点把 worker 占住。
MAX_ATTEMPTS = 5


def _sign(secret: str, payload: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


@shared_task(name="events.deliver_webhook", bind=True, max_retries=MAX_ATTEMPTS)
def deliver_event_webhook(self, delivery_id):
    """投递一条已记录的 EventBus webhook。

    幂等:已经 SUCCESS 的行直接返回 —— 重复投递比漏投更难查,而 at-least-once
    的队列**一定**会重复。
    """
    from apps.events.models import EventWebhookDelivery, EventWebhookStatus

    try:
        delivery = EventWebhookDelivery.objects.select_related("webhook").get(
            id=delivery_id
        )
    except EventWebhookDelivery.DoesNotExist:
        logger.error("deliver_event_webhook: 投递记录 %s 不存在", delivery_id)
        return

    if delivery.status == EventWebhookStatus.SUCCESS:
        return

    webhook = delivery.webhook
    ceiling = min(getattr(webhook, "max_retries", MAX_ATTEMPTS) or MAX_ATTEMPTS,
                  MAX_ATTEMPTS)
    if delivery.attempt >= ceiling:
        delivery.status = EventWebhookStatus.ABANDONED
        delivery.error = f"放弃:已试 {delivery.attempt} 次,上限 {ceiling}"
        delivery.save(update_fields=["status", "error", "update_time"])
        return

    secret = webhook.signing_secret
    if not secret:
        # 与 handler 里同一个理由:没有密钥就不发,而不是用空密钥签一个
        # 谁都能伪造的签名。
        delivery.status = EventWebhookStatus.ABANDONED
        delivery.error = "webhook 没有 signing_secret,拒绝发出未签名的投递"
        delivery.save(update_fields=["status", "error", "update_time"])
        return

    payload = json.dumps(delivery.payload_json, default=str).encode()
    delivery.attempt += 1

    try:
        from apps.events.handlers.webhook_handler import (
            _reject_if_not_publicly_routable,
        )

        _reject_if_not_publicly_routable(webhook.url)
        request = urllib.request.Request(
            webhook.url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "X-SoulLedger-Domain": delivery.domain,
                "X-SoulLedger-Event": delivery.event_type,
                "X-SoulLedger-Signature": _sign(secret, payload),
                "X-SoulLedger-Delivery": str(delivery.id),
            },
            method="POST",
        )
        timeout = getattr(webhook, "timeout_seconds", None) or 10
        with urllib.request.urlopen(request, timeout=timeout) as response:
            delivery.response_status = getattr(response, "status", None)
        delivery.status = EventWebhookStatus.SUCCESS
        delivery.delivered_at = timezone.now()
        delivery.error = ""
        delivery.save(update_fields=[
            "status", "attempt", "response_status", "delivered_at", "error",
            "update_time",
        ])
        return
    except Exception as exc:  # noqa: BLE001 — 记下来再决定重试
        delivery.status = EventWebhookStatus.FAILED
        delivery.error = f"{type(exc).__name__}: {exc}"[:2000]
        if isinstance(exc, urllib.error.HTTPError):
            delivery.response_status = exc.code
        delivery.save(update_fields=[
            "status", "attempt", "response_status", "error", "update_time",
        ])

    if delivery.attempt < ceiling:
        # 指数退避。`countdown` 而不是固定间隔:一个刚挂掉的端点通常不会在
        # 一秒后好起来,而每秒重试只会把它压得更久。
        raise self.retry(countdown=2 ** delivery.attempt, exc=None)


@shared_task(name="events.retry_pending_webhooks")
def retry_pending_webhooks(older_than_seconds=300, limit=200):
    """把没人接手的投递捡回来。

    **入队是尽力而为的**:`WebhookHandler` 在事务提交之后才 `.delay()`,而那时
    broker 可能是不可达的。行已经写下了,所以那种情况下投递不会丢——它只是停在
    PENDING。这个任务就是那条兜底路径。

    `older_than_seconds` 给正常入队的投递留出被 worker 取走的时间,免得刚写下的
    行立刻被这里重复入队一次。
    """
    from datetime import timedelta

    from apps.events.models import EventWebhookDelivery, EventWebhookStatus

    cutoff = timezone.now() - timedelta(seconds=older_than_seconds)
    stale = EventWebhookDelivery.objects.filter(
        status__in=[EventWebhookStatus.PENDING, EventWebhookStatus.FAILED],
        create_time__lt=cutoff,
    ).order_by("create_time")[:limit]

    picked = 0
    for delivery in stale:
        try:
            deliver_event_webhook.delay(str(delivery.id))
            picked += 1
        except Exception:
            logger.exception("retry_pending_webhooks: 入队 %s 失败", delivery.id)
    if picked:
        logger.info("retry_pending_webhooks: 重新入队 %s 条", picked)
    return picked
