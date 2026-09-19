"""受刑计划的并发(docs/ARCHITECTURE-sentence-plan.md §8 的 PostgreSQL 专属清单)。

锁序 `Soul → SentencePlan → SentenceNode → DispatchRecord / Disposition / Judgment`;
推进的幂等靠灵魂行锁串行化,再由部分唯一约束兜底。SQLite 没有行锁可等,所以真并发的
那几条 `skipif(SQLITE)`,名字登记在 `tests/test_concurrency.py::test_the_postgres_only_set_is_the_set_we_think_it_is`;
每条都配一条串行版本,每个引擎都跑。

**本地没跑过 PostgreSQL 版本**(本轮约定:真 PG 由主会话跑)。
"""
import threading

import pytest
from django.db import connection, connections

from apps.dispatch.models import DispatchRecord
from apps.events.models import SoulEvent
from apps.judgment.models import Judgment
from tests import sentence_plan_support as plan

SQLITE = connection.vendor == "sqlite"
NEEDS_ROW_LOCKS = "Requires real row-level locking (select_for_update); SQLite has none to wait on."


def _client(user):
    from tests.soul_account_support import officer_client

    return officer_client(user)


def _race(calls):
    """同时放出 `calls`(label → 无参函数),返回 label → 结果或异常 repr。"""
    barrier = threading.Barrier(len(calls))
    results = {}

    def run(label, fn):
        try:
            barrier.wait(timeout=10)
            results[label] = fn()
        except Exception as exc:  # 在断言里显形
            results[label] = repr(exc)
        finally:
            connections.close_all()

    threads = [threading.Thread(target=run, args=item, name=item[0]) for item in calls.items()]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    return results


def _execute(client, disposition_id):
    return lambda: client.post(f"/api/v1/disposition/{disposition_id}/execute/", {}, format="json").status_code


# ── 1. 两个官员并发执行原属处置 → 恰一条调拨、一个 DISPATCHING 节点 ────────────────


def _home_served_twice(cn, eg, run):
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5)])
    home = plan.node(p, 1)
    a = _client(plan.officer("pg1_a", "ADMIN", cn))
    b = _client(plan.officer("pg1_b", "ADMIN", cn))
    results = run({"a": _execute(a, home.disposition_id), "b": _execute(b, home.disposition_id)})
    assert sorted(results.values()) == [200, 400], results
    assert DispatchRecord.all_objects.filter(soul=soul).count() == 1
    assert [n.status for n in p.nodes.order_by("order")] == ["COMPLETED", "DISPATCHING"]


@pytest.mark.django_db(transaction=True)
def test_executing_the_home_disposition_twice_in_a_row_dispatches_once():
    _home_served_twice(plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT"),
                       lambda calls: {label: fn() for label, fn in calls.items()})


@pytest.mark.skipif(SQLITE, reason=NEEDS_ROW_LOCKS)
@pytest.mark.django_db(transaction=True)
def test_two_officers_executing_the_home_disposition_at_once_dispatch_once():
    _home_served_twice(plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT"), _race)


# ── 2. 执行地刑满回归 与 执行地开新审判 并发 ─────────────────────────────────


def _serve_while_opening(cn, eg, run):
    soul, p, record = plan.at_stop(cn, eg)
    stop = plan.node(p, 2)
    executor = _client(plan.officer("pg2_exec", "ADMIN", eg))
    judge = _client(plan.officer("pg2_judge", "JUDGE", eg))
    results = run({
        "serve": _execute(executor, stop.disposition_id),
        "open": lambda: judge.post("/api/v1/judgment/", {"soul": str(soul.pk)}, format="json").status_code,
    })
    soul.refresh_from_db()
    opened = Judgment.all_objects.filter(soul=soul, tenant=eg, is_deleted=False)
    assert results["serve"] == 200, results
    if results["open"] == 201:
        # 审判先建好:它拦下回归,灵魂刑满暂留在执行地。
        assert opened.count() == 1 and soul.tenant_id == eg.pk
        assert plan.node(p, 2).status == "WAITING"
    else:
        # 回归先完成:灵魂已回原属,执行地的开审被拒(400:「本租户没有这个灵魂」)。
        assert results["open"] == 400, results
        assert not opened.exists() and soul.tenant_id == cn.pk
    # 不存在的形状:回归了、审判却挂在执行地。
    assert not (soul.tenant_id == cn.pk and opened.exists())


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("first", ["serve", "open"])
def test_serving_then_opening_or_opening_then_serving_leaves_a_consistent_soul(first):
    def in_order(calls):
        order = [first, "open" if first == "serve" else "serve"]
        return {label: calls[label]() for label in order}

    _serve_while_opening(plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT"), in_order)


@pytest.mark.skipif(SQLITE, reason=NEEDS_ROW_LOCKS)
@pytest.mark.django_db(transaction=True)
def test_serving_a_stop_and_opening_a_case_there_at_once_never_strands_the_case():
    _serve_while_opening(plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT"), _race)


# ── 5. 两个执行地官员并发执行节点处置 → 节点完成一次、回归一次 ─────────────────


def _stop_served_twice(cn, eg, run):
    soul, p, record = plan.at_stop(cn, eg)
    stop = plan.node(p, 2)
    a = _client(plan.officer("pg5_a", "ADMIN", eg))
    b = _client(plan.officer("pg5_b", "ADMIN", eg))
    results = run({"a": _execute(a, stop.disposition_id), "b": _execute(b, stop.disposition_id)})
    assert sorted(results.values()) == [200, 400], results
    assert plan.node(p, 2).status == "COMPLETED"
    assert SoulEvent.objects.filter(soul=soul, event_type="SENTENCE_NODE_COMPLETED", payload__order=2).count() == 1
    assert len(plan.returned_events(soul)) == 1


@pytest.mark.django_db(transaction=True)
def test_executing_a_stop_twice_in_a_row_completes_and_returns_once():
    _stop_served_twice(plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT"),
                       lambda calls: {label: fn() for label, fn in calls.items()})


@pytest.mark.skipif(SQLITE, reason=NEEDS_ROW_LOCKS)
@pytest.mark.django_db(transaction=True)
def test_two_officers_executing_a_stop_at_once_complete_and_return_once():
    _stop_served_twice(plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT"), _race)
