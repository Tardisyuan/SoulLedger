"""两个 worker 拿到同一批推送 id(at-least-once 队列的常态),只有一个真的发。

`services._claim` 用 `select_for_update(of=("self",))` 锁行并把 QUEUED 改成 SENDING;第二个 worker
在锁上等,醒来看到的已不是 QUEUED,认领到零行。

REQUIRES POSTGRESQL。SQLite 串行化写者,两个线程不可能同时在锁里,断言永远不会失败;
串行版本 `test_soul_push_delivery.py::test_the_same_event_twice_is_pushed_once` 每个引擎都跑。
"""
import threading
import time

import pytest
from django.db import connection, connections
from django.utils import timezone

from apps.soul_accounts import services as account_svc
from apps.soul_accounts.models import AccountOrigin
from apps.soul_push import services
from apps.soul_push.models import PushDelivery, PushDevice, PushStatus
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

SQLITE = connection.vendor == "sqlite"
NEEDS_ROW_LOCKS = pytest.mark.skipif(
    SQLITE, reason="SQLite serializes writers; two workers cannot race inside _claim. Run on PostgreSQL.")


class SlowSender:
    calls = []

    def send(self, messages):
        SlowSender.calls.append(len(messages))
        time.sleep(0.2)
        return [{"status": "ok", "id": f"t-{i}"} for i in range(len(messages))]


@NEEDS_ROW_LOCKS
@pytest.mark.django_db(transaction=True)
def test_two_workers_given_the_same_ids_send_once(settings):
    settings.SOUL_PUSH_ENABLED = True
    tenant = Tenant.objects.get_or_create(code="CN_DIYU_PUSHRACE", defaults={"display_name": "race"})[0]
    soul = Soul.objects.create(name="并发推送", tenant=tenant, current_state=SoulState.JUDGING)
    account, _ = account_svc.provision_account(soul, AccountOrigin.OFFICER)
    device = PushDevice.objects.create(account=account, soul=soul, token="ExponentPushToken[raceraceracerace]",
                                       platform="IOS", last_seen_at=timezone.now())
    delivery = PushDelivery.objects.create(dedupe_key="judgment:race", device=device, account=account, soul=soul,
                                           event_type="JUDGMENT_CONCLUDED", kind="judgment_result", title="t", body="b")
    SlowSender.calls = []
    barrier = threading.Barrier(2)
    errors = []

    def worker():
        try:
            barrier.wait()
            services.send_deliveries([str(delivery.pk)], sender=SlowSender())
        except Exception as exc:  # pragma: no cover - 失败时报出来
            errors.append(exc)
        finally:
            connections.close_all()

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    assert SlowSender.calls == [1]
    delivery.refresh_from_db()
    assert delivery.status == PushStatus.SENT and delivery.attempts == 1
