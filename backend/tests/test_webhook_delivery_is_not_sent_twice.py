"""同一条 webhook 投递同时在两个 worker 上,只 POST 一次(fix/backend-audit 2026-10-31,审查 C26 a)。

at-least-once 的队列会重投;`retry_pending_webhooks` 每 5 分钟把 FAILED 的行再入队,而那一行自己的
`self.retry` 还排着。此前 `deliver_event_webhook` 读一眼「还没 SUCCESS」就发,两个 worker 各发一次。
现在整次投递在这一行的行锁下:后到的在锁上等,醒来重读,看到 SUCCESS 就返回。

REQUIRES POSTGRESQL。SQLite 串行化写者,两个线程不会同时在里面;串行版本
`tests/test_a_failed_webhook_is_remembered.py::test_a_delivered_one_is_not_sent_twice` 每个引擎都跑。
"""
import threading
import time
from unittest.mock import patch

import pytest
from django.db import connection, connections

from apps.death_sync.models import ExternalApiKey, WebhookConfig
from apps.events.models import EventWebhookDelivery, EventWebhookStatus
from apps.events.tasks import deliver_event_webhook
from apps.tenants.models import Tenant

SQLITE = connection.vendor == "sqlite"
NEEDS_ROW_LOCKS = pytest.mark.skipif(
    SQLITE, reason="SQLite serializes writers; two workers cannot both be inside a delivery. Run on PostgreSQL.")


class _SlowOk:
    status_code = 200


@NEEDS_ROW_LOCKS
@pytest.mark.django_db(transaction=True)
def test_two_workers_given_the_same_delivery_post_it_once():
    tenant = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN_DIYU"})[0]
    _, key_hash, key_prefix = ExternalApiKey.generate_key()
    key = ExternalApiKey.objects.create(tenant=tenant, name="race", system_type="HOSPITAL",
                                        key_hash=key_hash, key_prefix=key_prefix)
    hook = WebhookConfig.objects.create(tenant=tenant, api_key=key, url="https://example.invalid/hook",
                                        signing_secret="s", events=[], max_retries=3)
    delivery = EventWebhookDelivery.objects.create(webhook=hook, tenant=tenant, domain="soul",
                                                   event_type="SOUL_CREATED", payload_json={"soul_id": "x"})
    posts = []

    def slow_post(*args, **kwargs):
        posts.append(1)
        time.sleep(0.3)  # long enough for the second worker to arrive while the first is still sending
        return _SlowOk()

    barrier = threading.Barrier(2)
    errors = []

    def worker():
        try:
            barrier.wait()
            deliver_event_webhook.apply(args=[str(delivery.pk)])
        except Exception as exc:  # pragma: no cover - 失败时报出来
            errors.append(exc)
        finally:
            connections.close_all()

    with patch("requests.Session.post", side_effect=slow_post), patch(
            "apps.events.handlers.webhook_handler._reject_if_not_publicly_routable", lambda url: None):
        threads = [threading.Thread(target=worker) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(30)

    assert errors == []
    assert posts == [1]
    delivery.refresh_from_db()
    assert delivery.status == EventWebhookStatus.SUCCESS and delivery.attempt == 1
