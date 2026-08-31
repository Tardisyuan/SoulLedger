"""一次失败的 webhook 投递必须留下痕迹,并且有人会再试。

M26 分两次修。第一次(2026-08-31)把投递挪到事务提交之后 —— 那治的是
「一个开着的事务被租户配的慢端点占着连接和行锁」。**没治的是另外两半**:
投递仍在请求线程上,而且**失败之后没有任何东西记得这件事**。

这一次(2026-09-01,用户决定「建 Celery 任务 + 投递日志」)治的是后两半:

* handler 在**发布者的事务里**写 `EventWebhookDelivery` 行 —— 事务回滚时投递
  也不存在,一次没有发生的事件不留下投递记录;
* 提交之后尽力入队。**入队失败不算数据丢失**:行停在 PENDING,
  `events.retry_pending_webhooks` 会捡起来。这是它比「发不出去就算了」强的
  全部地方,所以这个文件主要在断它。
"""
from unittest.mock import patch

import pytest

from apps.death_sync.models import ExternalApiKey, WebhookConfig
from apps.events.event_bus import EventEnvelope
from apps.events.handlers.webhook_handler import WebhookHandler
from apps.events.models import EventWebhookDelivery, EventWebhookStatus
from apps.events.tasks import deliver_event_webhook, retry_pending_webhooks
from apps.tenants.models import Tenant


@pytest.fixture
def hook(db):
    tenant = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "CN_DIYU"}
    )[0]
    _, key_hash, key_prefix = ExternalApiKey.generate_key()
    key = ExternalApiKey.objects.create(
        tenant=tenant, name="fw", system_type="HOSPITAL",
        key_hash=key_hash, key_prefix=key_prefix,
    )
    return WebhookConfig.objects.create(
        tenant=tenant, api_key=key, url="https://example.invalid/hook",
        signing_secret="s", events=[], max_retries=3,
    )


def _envelope():
    return EventEnvelope(
        domain="soul", event_type="SOUL_CREATED",
        payload={"soul_id": "abc"}, tenant_code="CN_DIYU",
    )


def _record(envelope):
    from django.db import transaction

    connection = transaction.get_connection()
    start = len(connection.run_on_commit)
    WebhookHandler().handle(envelope)
    callbacks = [fn for _sids, fn, *_ in connection.run_on_commit[start:]]
    del connection.run_on_commit[start:]
    for fn in callbacks:
        fn()
    return list(EventWebhookDelivery.objects.all())


@pytest.mark.django_db
def test_the_delivery_is_written_down_before_anything_is_sent(hook):
    rows = _record(_envelope())
    assert len(rows) == 1
    row = rows[0]
    assert row.status == EventWebhookStatus.PENDING
    assert row.attempt == 0
    assert row.event_type == "SOUL_CREATED"
    assert row.payload_json, "载荷没存下来 —— 重试时就得重新拼一份"


@pytest.mark.django_db
def test_a_failure_is_recorded_not_swallowed(hook):
    """**这是这次改动买到的东西。** 从前失败只留一行 debug 日志。"""
    row = _record(_envelope())[0]

    def boom(req, timeout=None):
        raise OSError("connection refused")

    with patch("urllib.request.urlopen", side_effect=boom), patch(
        "apps.events.handlers.webhook_handler._reject_if_not_publicly_routable",
        lambda url: None,
    ):
        deliver_event_webhook.apply(args=[str(row.id)])

    row.refresh_from_db()
    assert row.status == EventWebhookStatus.FAILED
    assert "connection refused" in row.error, (
        "失败的原因没有被记下来 —— 从前它只留一行 debug 日志"
    )
    # `attempt` 是 3 而不是 1:`.apply()` 是 eager 的,`self.retry()` 在同一个调用里
    # 同步重跑,直到撞上 `max_retries`。断 `>= 1` 而不是 `== 1`,因为这个数字取决于
    # 跑在 eager 还是真 worker 上 —— 而这条测试要说的是「失败被记下了」,
    # 不是「重试机制在这个执行模式下的圈数」。
    assert row.attempt >= 1


@pytest.mark.django_db
def test_it_gives_up_after_the_ceiling_and_says_so(hook):
    row = _record(_envelope())[0]
    row.attempt = 3  # == hook.max_retries
    row.save(update_fields=["attempt"])

    deliver_event_webhook.apply(args=[str(row.id)])

    row.refresh_from_db()
    assert row.status == EventWebhookStatus.ABANDONED, (
        "超过上限还在试 —— 一个挂掉的端点会一直占着 worker"
    )
    assert "上限" in row.error


@pytest.mark.django_db
def test_a_delivered_one_is_not_sent_twice(hook):
    """队列是 at-least-once 的,**一定**会重复。重复投递比漏投更难查。"""
    row = _record(_envelope())[0]
    row.status = EventWebhookStatus.SUCCESS
    row.save(update_fields=["status"])

    sent = []
    with patch("urllib.request.urlopen", side_effect=lambda *a, **k: sent.append(1)):
        deliver_event_webhook.apply(args=[str(row.id)])
    assert sent == []


@pytest.mark.django_db
def test_a_row_the_enqueue_never_reached_is_picked_up(hook):
    """**入队是尽力而为的。** broker 不可达时行停在 PENDING —— 兜底任务要能捡到。"""
    from datetime import timedelta

    from django.utils import timezone

    row = _record(_envelope())[0]
    # 装成一条 broker 挂掉那会儿写下的行
    EventWebhookDelivery.objects.filter(pk=row.pk).update(
        create_time=timezone.now() - timedelta(seconds=600)
    )

    enqueued = []
    with patch.object(deliver_event_webhook, "delay", side_effect=enqueued.append):
        picked = retry_pending_webhooks(older_than_seconds=300)

    assert picked == 1, "兜底任务没捡到那条 PENDING"
    assert enqueued == [str(row.id)]


@pytest.mark.django_db
def test_a_fresh_row_is_not_double_enqueued(hook):
    """**断存在的反面。** 刚写下的行已经入过队了,兜底不该再来一次。"""
    _record(_envelope())
    enqueued = []
    with patch.object(deliver_event_webhook, "delay", side_effect=enqueued.append):
        picked = retry_pending_webhooks(older_than_seconds=300)
    assert picked == 0 and enqueued == []


@pytest.mark.django_db
def test_a_webhook_that_lost_its_secret_is_abandoned_not_retried_forever(hook):
    row = _record(_envelope())[0]
    hook.signing_secret = ""
    hook.save(update_fields=["signing_secret"])

    deliver_event_webhook.apply(args=[str(row.id)])

    row.refresh_from_db()
    assert row.status == EventWebhookStatus.ABANDONED
    assert "signing_secret" in row.error
