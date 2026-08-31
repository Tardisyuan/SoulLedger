"""Webhook 投递不能发生在发布者的事务里。

`apps/events/handlers/webhook_handler.py` 同步注册给 5 个 domain,而
`Soul.save()` 在 `super().save()` 之后立刻发 SOUL_CREATED —— 于是
`urllib.request.urlopen(req, timeout=10)` **对每个活跃 webhook 各跑一次,
在调用者的事务里**。

两个后果,第二个更严重:

* 回调进本 API 的接收方,看到的库里没有这个事件宣布的那一行(事务未提交,
  回调走的是另一条连接);
* **一个开着的事务会一直占着它的连接和行锁,直到远端答复为止。** 远端是**租户
  自己配的**,超时 10 秒,而且是串行的。

`on_commit` 把整块挪到提交之后。不在事务里时 `on_commit` 立即执行。

仍未修的那一半(投递仍在请求线程上,只是在提交之后)写在那个方法的 docstring 里
—— 挪到 worker 需要一个任务和一份投递日志,没有它们就会把失败丢在地上。
"""
import pytest
from django.db import transaction

from apps.events.event_bus import EventEnvelope
from apps.events.handlers.webhook_handler import WebhookHandler


@pytest.fixture
def spy(monkeypatch):
    calls = []
    monkeypatch.setattr(
        WebhookHandler,
        "_deliver_to_tenant_webhooks",
        lambda self, envelope: calls.append(envelope),
    )
    return calls


def _envelope():
    return EventEnvelope(
        domain="soul",
        event_type="SOUL_CREATED",
        payload={},
        tenant_code="CN_DIYU",
    )


@pytest.mark.django_db(transaction=True)
def test_nothing_is_sent_before_the_commit(spy):
    with transaction.atomic():
        WebhookHandler().handle(_envelope())
        assert spy == [], (
            "webhook 在事务提交前就发了 —— 接收方回调时看不到这一行,"
            "而这条 HTTP 调用正占着一个开着的事务"
        )
    assert len(spy) == 1, "提交之后 webhook 没有发出"


@pytest.mark.django_db(transaction=True)
def test_a_rolled_back_transaction_sends_nothing(spy):
    class _RollbackError(Exception):
        pass

    with pytest.raises(_RollbackError), transaction.atomic():
        WebhookHandler().handle(_envelope())
        raise _RollbackError
    assert spy == [], "事务回滚了,webhook 还是发了出去"


@pytest.mark.django_db(transaction=True)
def test_outside_a_transaction_it_still_goes_out(spy):
    """**断存在。** `on_commit` 在没有事务时立即执行 —— 不改变这类调用方的行为。

    `transaction=True` 是必须的:普通的 `django_db` 把整条测试裹在一个**永不提交**
    的 atomic 里,于是 `on_commit` 的回调一次都不会跑。那样这条会失败,
    而失败的原因是测试夹具,不是被测代码 —— 也就是最容易被读成「修坏了」的那种。
    """
    WebhookHandler().handle(_envelope())
    assert len(spy) == 1
