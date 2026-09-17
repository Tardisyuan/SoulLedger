from celery import shared_task

from apps.soul_push.services import MAX_ATTEMPTS


@shared_task(name="soul_push.send", bind=True, max_retries=MAX_ATTEMPTS)
def send_push(self, delivery_ids):
    """发送一批已记录的推送。幂等:只认领仍 QUEUED 的行。"""
    from apps.soul_push import services

    try:
        return services.send_deliveries(delivery_ids)
    except services.PushRetryError as later:
        # 行上的 attempts 封顶 MAX_ATTEMPTS。celery 的 retry 丢了或用尽时,剩下的行停在 QUEUED,
        # 由 sweep 按 next_attempt_at 接手,不会无声丢失。
        raise self.retry(args=[later.delivery_ids], countdown=later.countdown, exc=None) from None


@shared_task(name="soul_push.sweep")
def sweep():
    """兜底入队 + 查回执。登记在 apps/scheduler/registry.py。"""
    from apps.soul_push import services

    return {"backfilled": services.backfill_disabled(), "requeued": services.requeue_stale(),
            "receipts": services.check_receipts()}
