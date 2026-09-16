"""两次并发的死亡同步只开一个账号、只签发一份初始密码。

`provision_account` 先锁灵魂行,再靠 `(soul, cycle)` 唯一约束兜底。PostgreSQL 上第二个
线程在锁上等,拿到锁时看见第一个线程已经提交的账号,返回 `created=False` —— 于是只有一行
`InitialCredential`,也只有一次提交后发送。

REQUIRES POSTGRESQL。SQLite 串行化写者,两个线程不可能同时在锁里,断言永远不会失败;
串行版本(同一灵魂开两次只得到一个账号、一封邮件)在
`test_soul_accounts_lifecycle.py::test_death_sync_opens_the_account_and_mails_the_password_once`
里,每个引擎都跑。
"""
import threading

import pytest
from django.db import connection, connections

from apps.soul_accounts import services as svc
from apps.soul_accounts.models import AccountOrigin, InitialCredential, SoulAccount
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

SQLITE = connection.vendor == "sqlite"
NEEDS_ROW_LOCKS = pytest.mark.skipif(
    SQLITE,
    reason="SQLite serializes writers; two threads cannot race inside provision_account. Run on PostgreSQL.",
)


@NEEDS_ROW_LOCKS
@pytest.mark.django_db(transaction=True)
def test_two_simultaneous_death_syncs_open_one_account_and_issue_one_password():
    tenant = Tenant.objects.get_or_create(code="CN_DIYU_SOULRACE", defaults={"display_name": "race"})[0]
    soul = Soul.objects.create(name="并发亡魂", tenant=tenant, current_state=SoulState.JUDGING,
                               contact_email="race@example.com")
    barrier = threading.Barrier(2)
    results, errors = [], []

    def worker():
        try:
            barrier.wait()
            results.append(svc.provision_account(Soul.objects.get(pk=soul.pk), AccountOrigin.DEATH_SYNC)[1])
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
    assert sorted(results) == [False, True]
    assert SoulAccount.objects.filter(soul=soul).count() == 1
    assert InitialCredential.objects.filter(soul=soul).count() == 1
