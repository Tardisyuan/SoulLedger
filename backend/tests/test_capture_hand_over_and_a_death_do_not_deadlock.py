"""勾魂交接与别的路登记的死亡同时到,不死锁(fix/backend-audit 2026-10-31,审查 C26 e)。

死亡登记先锁灵魂(`Soul.transition_to`),再由 `capture.close_on_death` 锁这个灵魂开着的牒。`capture.hand_over`
原先反过来:先锁牒,`die()` 里才锁灵魂。两边同时到 —— 交接握着牒等灵魂,死亡同步握着灵魂等牒 —— PostgreSQL
判死锁,杀掉其中一个(一次 500)。现在 `hand_over` 先锁灵魂再锁牒,与死亡登记同一个方向:后到的那个在灵魂锁上等,
醒来看到先到的那个已经提交的结果。

REQUIRES POSTGRESQL。SQLite 串行化写者,没有行锁可等,两个线程不可能各握一把;串行行为
(交接只发一张牒、交接失败什么都不写、死亡登记补发并交接)由
`tests/test_diyu_stations_capture_tudi_continents.py` 每个引擎都跑。
"""
import threading
import time

import pytest
from django.db import connection, connections, transaction

from apps.dispatch import capture
from apps.dispatch.models import CaptureWarrant
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests.city_god_support import default_city_god

SQLITE = connection.vendor == "sqlite"
NEEDS_ROW_LOCKS = pytest.mark.skipif(
    SQLITE, reason="SQLite serializes writers; the two paths cannot each hold one lock. Run on PostgreSQL.")


def _wait_until_someone_waits_on_a_lock(timeout=10.0):
    deadline = time.monotonic() + timeout
    with connections["default"].cursor() as cursor:
        while time.monotonic() < deadline:
            cursor.execute("select count(*) from pg_stat_activity "
                           "where datname = current_database() and wait_event_type = 'Lock'")
            if cursor.fetchone()[0]:
                return True
            time.sleep(0.05)
    return False


@NEEDS_ROW_LOCKS
@pytest.mark.django_db(transaction=True)
def test_a_hand_over_and_a_death_sync_at_once_do_not_deadlock():
    tenant = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "地府"})[0]
    default_city_god(tenant)
    soul = Soul.objects.create(name="同时到", tenant=tenant, fated_death_year=2000, fated_death_month=1,
                               fated_death_day=1)
    warrant = capture.issue(soul)
    capture.capture(warrant.pk)

    soul_locked, release = threading.Event(), threading.Event()
    outcome, errors = {}, []

    def death_sync():
        """死亡同步的形状:先锁灵魂,停住等交接也走到它要等的那把锁上,再登记死亡(→ close_on_death 锁牒)。"""
        try:
            with transaction.atomic():
                Soul.lock(soul.pk)
                soul_locked.set()
                release.wait(10)
                outcome["death"] = Soul.all_objects.get(pk=soul.pk).die()
        except Exception as exc:  # pragma: no cover - 失败时报出来
            errors.append(exc)
        finally:
            connections.close_all()

    def hand_over():
        try:
            soul_locked.wait(10)
            capture.hand_over(warrant.pk)
            outcome["hand_over"] = "done"
        except capture.CaptureRefused as exc:
            outcome["hand_over"] = exc.detail["code"]
        except Exception as exc:  # pragma: no cover - 死锁时这里拿到 OperationalError
            errors.append(exc)
        finally:
            connections.close_all()

    threads = [threading.Thread(target=death_sync), threading.Thread(target=hand_over)]
    for t in threads:
        t.start()
    soul_locked.wait(10)
    assert _wait_until_someone_waits_on_a_lock(), "the hand-over never reached a lock it had to wait on"
    release.set()
    for t in threads:
        t.join(30)

    assert errors == [], errors
    assert outcome["death"] is not None
    assert outcome["hand_over"] == "wrong_status"  # the death came first and handed the warrant over
    warrant.refresh_from_db()
    assert warrant.status == "HANDED_OVER"
    assert Soul.objects.get(pk=soul.pk).current_state == SoulState.JUDGING
    assert CaptureWarrant.objects.filter(soul=soul).count() == 1
