"""
WebhookHandler — delivers events to external webhook endpoints.

Reads webhook URLs from Tenant.webhook_configs.
Only handles events for tenants that have webhooks configured.
"""
import logging

from django.db import transaction

from apps.events.event_bus import DomainEventHandler, EventEnvelope

logger = logging.getLogger(__name__)


def _reject_if_not_publicly_routable(url):
    """Raise unless `url` resolves somewhere off this machine's private nets.

    Delegates to the death_sync validator so there is one blocklist rather
    than two that drift. That validator's own gaps are fixed there.
    """
    from apps.death_sync.webhook_service import _validate_webhook_url

    _validate_webhook_url(url)


class WebhookHandler(DomainEventHandler):
    """
    Delivers events to external webhook endpoints via HTTP POST.

    Filters:
        - Requires ``tenant_code`` on the envelope
        - Skips tenants without webhook_configs

    Security:
        - HMAC-SHA256 signature in X-SoulLedger-Signature header
    """

    def should_handle(self, envelope: EventEnvelope) -> bool:
        return bool(envelope.tenant_code)

    def handle(self, envelope: EventEnvelope) -> None:
        """记下要投递什么(事务内),提交后交给 worker。

        WHAT THIS USED TO DO. 这些 handler 是从**发布者的事务里**同步派发的 ——
        `Soul.save()` 在 `super().save()` 之后立刻发 SOUL_CREATED,而这个 handler
        当时就对每个活跃 webhook 跑一次 `urllib.request.urlopen(..., timeout=10)`,
        串行。三个后果:

        * 回调进本 API 的接收方,看到的库里没有这个事件宣布的那一行(事务未提交,
          回调走的是另一条连接);
        * **一个开着的事务会一直占着它的连接和行锁,直到远端答复为止** ——
          而远端是租户自己配的,超时 10 秒;
        * 请求要等它,而**失败之后没有任何东西记得这件事**。

        前两条 2026-08-31 用 `transaction.on_commit` 修掉了。第三条(以及「仍在
        请求线程上」)是这一次:

        **记与发分开。** `_record_deliveries` 在事务里写 `EventWebhookDelivery`
        行 —— 所以事务回滚时投递也不存在,一次没有发生的事件不留下投递记录。
        提交之后 `_enqueue` 尽力把它们交给 worker;**入队失败不算数据丢失**,
        行停在 PENDING,`events.retry_pending_webhooks` 会捡起来。

        这段代码现在不发任何 HTTP。签名、重试、退避、放弃都在
        `apps/events/tasks.py`。
        """
        delivery_ids: list[str] = []
        try:
            delivery_ids = self._record_deliveries(envelope)
        except Exception:
            logger.exception(
                "WebhookHandler: 记录投递失败 %s", envelope.event_type
            )
            return
        if not delivery_ids:
            return

        def _dispatch():
            self._enqueue(delivery_ids)

        # `on_commit` only when there *is* a transaction to commit.
        #
        # `transaction.on_commit` needs a live connection, and a bare
        # `on_commit` broke ten existing tests that publish with no
        # database at all — silently, because this method swallows its
        # exceptions. Outside a transaction `on_commit` runs the
        # callback immediately anyway, so this is the same semantics
        # without requiring a connection to say so. `in_atomic_block`
        # is a plain attribute — no query, so it works under
        # pytest-django's DB blocker.
        if transaction.get_connection().in_atomic_block:
            transaction.on_commit(_dispatch)
        else:
            _dispatch()

    def _record_deliveries(self, envelope: EventEnvelope) -> list[str]:
        """把该发的投递**记下来**,返回它们的 id。不发。

        在发布者的事务里跑,所以事务回滚时这些行也不存在 —— 一次没有发生的事件
        不该留下投递记录。真正的 HTTP 在 `events.deliver_webhook` 里。
        """
        from apps.events.models import EventWebhookDelivery
        from apps.tenants.models import Tenant

        tenant = Tenant.objects.filter(code=envelope.tenant_code).first()
        if tenant is None:
            return []

        webhooks = getattr(tenant, "webhook_configs", None)
        if webhooks is None:
            return []

        payload = envelope.to_dict()
        ids = []
        for webhook in webhooks.filter(is_active=True):
            # `WebhookConfig.events` is documented as "event types to subscribe
            # to" and was never read: an integration registered for
            # DEATH_SYNC_RECEIVED was handed every workflow, dispatch,
            # notification and social event of the tenant, soul ids and
            # verdicts included, to an endpoint URL the tenant supplied.
            # Measured 2026-08-29. An empty list keeps its plain meaning of
            # "everything".
            subscribed = getattr(webhook, "events", None)
            if subscribed and envelope.event_type not in subscribed:
                continue
            # `webhook.secret` does not exist -- the field is
            # `signing_secret`. `getattr(..., "")` turned that typo into an
            # empty HMAC key, silently: the signature was reproducible by
            # anyone who could see the body. The signing now happens in the
            # task, and it refuses a webhook with no secret rather than
            # degrading into no signature at all -- but check here too, so a
            # misconfigured endpoint does not accumulate rows nobody can send.
            if not webhook.signing_secret:
                logger.error(
                    "WebhookHandler: webhook %s has no signing secret; "
                    "refusing to record a delivery it could never sign",
                    getattr(webhook, "id", "?"),
                )
                continue
            delivery = EventWebhookDelivery.objects.create(
                webhook=webhook,
                tenant=tenant,
                domain=envelope.domain,
                event_type=envelope.event_type,
                payload_json=payload,
            )
            ids.append(str(delivery.id))
        return ids

    @staticmethod
    def _enqueue(delivery_ids) -> None:
        """交给 worker。**尽力而为,失败不算数据丢失。**

        这里已经在事务提交之后,broker 可能是不可达的。行已经写下了,所以入队失败
        只是让那条投递停在 PENDING —— `events.retry_pending_webhooks` 会把它捡起来。
        异常一律吞掉:这段由**提交方**触发,抛出去会变成某个无关写请求的 500。
        """
        from apps.events.tasks import deliver_event_webhook

        for delivery_id in delivery_ids:
            try:
                deliver_event_webhook.delay(delivery_id)
            except Exception:
                logger.warning(
                    "WebhookHandler: 投递 %s 入队失败,留在 PENDING 等兜底任务",
                    delivery_id,
                )

