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


# ── 阶段 3:3. 同一条请求被并发批准两次 → 一条 4xx,序号无重复 ──────────────────


PLANS = "/api/v1/sentence-plans/"


def _pending_addition(cn, eg, eu):
    """灵魂在埃及;欧洲(第 3 站未开始)提一条加项请求。"""
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5), (eu, plan.stop_realm(eu), 7)])
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    requester = _client(plan.officer("pg3_eu", "JUDGE", eu))
    response = requester.post(f"{PLANS}{p.pk}/requests/", {
        "kind": "AMEND", "changes": {"add": [{"realm_code": plan.stop_realm(eu)}]}}, format="json")
    assert response.status_code == 201, response.data
    return soul, p, response.data["id"]


def _accepted_twice(cn, eg, eu, run):
    from apps.sentence_plan.models import SentenceNode

    soul, p, request_id = _pending_addition(cn, eg, eu)
    a = _client(plan.officer("pg3_a", "JUDGE", cn))
    b = _client(plan.officer("pg3_b", "JUDGE", cn))
    url = f"{PLANS}{p.pk}/requests/{request_id}/decide/"
    results = run({
        "a": lambda: a.post(url, {"decision": "ACCEPT"}, format="json").status_code,
        "b": lambda: b.post(url, {"decision": "ACCEPT"}, format="json").status_code,
    })
    assert sorted(results.values()) == [200, 409], results
    orders = list(SentenceNode.all_objects.filter(plan=p).exclude(status__in=["REMOVED", "CANCELLED"])
                  .values_list("order", flat=True))
    assert sorted(orders) == [1, 2, 3, 4] and len(set(orders)) == len(orders)


@pytest.mark.django_db(transaction=True)
def test_accepting_one_request_twice_in_a_row_adds_once():
    _accepted_twice(plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT"), plan.tenant("EU_HEAVEN_HELL"),
                    lambda calls: {label: fn() for label, fn in calls.items()})


@pytest.mark.skipif(SQLITE, reason=NEEDS_ROW_LOCKS)
@pytest.mark.django_db(transaction=True)
def test_two_judges_accepting_one_request_at_once_add_once():
    _accepted_twice(plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT"), plan.tenant("EU_HEAVEN_HELL"), _race)


# ── 4. 计划完成 与 转生申请 并发 → 没有建在未完成计划上的申请 ───────────────────


def _completion_and_submit(cn, eg, run):
    from apps.sentence_plan.models import SentencePlan
    from apps.soul_accounts.models import RebirthApplication
    from tests.soul_account_support import ready_soul

    account, soul_client = ready_soul(cn, name="pg4")
    soul = account.soul
    case = Judgment.objects.create(soul=soul, civilization=soul.civilization, tenant=cn)
    plan.bench(case, [(eg, plan.stop_realm(eg), 5)])
    case.conclude("PASSED", "")
    p = SentencePlan.all_objects.get(soul=soul)
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    stop = plan.node(p, 2)
    executor = _client(plan.officer("pg4_exec", "ADMIN", eg))
    results = run({
        "serve": _execute(executor, stop.disposition_id),
        "apply": lambda: soul_client.post("/api/v1/me/rebirth-applications/", {"desired_form": "HUMAN"},
                                          format="json").status_code,
    })
    p.refresh_from_db()
    assert results["serve"] == 200 and p.status == "COMPLETED", results
    applications = list(RebirthApplication.objects.filter(soul=soul))
    if results["apply"] == 201:
        [application] = applications
        assert application.created_at >= p.completed_at
    else:
        assert results["apply"] == 409 and applications == [], results


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("first", ["serve", "apply"])
def test_completing_then_applying_or_applying_then_completing_never_applies_early(first):
    def in_order(calls):
        order = [first, "apply" if first == "serve" else "serve"]
        return {label: calls[label]() for label in order}

    _completion_and_submit(plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT"), in_order)


@pytest.mark.skipif(SQLITE, reason=NEEDS_ROW_LOCKS)
@pytest.mark.django_db(transaction=True)
def test_completing_a_plan_and_applying_for_rebirth_at_once_never_applies_early():
    _completion_and_submit(plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT"), _race)


# ── 6. 撤销计划 与 推进 并发 → 撤销之后不再出现新的 DISPATCHING ──────────────────


def _cancel_while_advancing(cn, eg, run):
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5)])
    home = plan.node(p, 1)
    executor = _client(plan.officer("pg6_exec", "ADMIN", cn))
    canceller = _client(plan.officer("pg6_mod", "MODERATOR", cn))
    results = run({
        "serve": _execute(executor, home.disposition_id),
        "cancel": lambda: canceller.post(f"{PLANS}{p.pk}/cancel/", {"reason": "撤"}, format="json").status_code,
    })
    p.refresh_from_db()
    # 撤销 = 赦免剩余刑期、视为完成(2026-09-19):撤销在先,原属那站 ABORTED、灵魂已进轮回,
    # 随后的执行答 409(灵魂不在能执行处置的状态);执行在先,两者都 200。
    assert results in ({"serve": 200, "cancel": 200}, {"serve": 409, "cancel": 200}), results
    assert p.status == "CANCELLED"
    assert plan.node(p, 1).status == ("COMPLETED" if results["serve"] == 200 else "ABORTED")
    assert not p.nodes.filter(status="DISPATCHING").exists()
    assert not DispatchRecord.all_objects.filter(soul=soul, status__in=["PROPOSED", "APPROVED"]).exists()


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("first", ["serve", "cancel"])
def test_cancelling_before_or_after_the_advance_leaves_nothing_dispatching(first):
    def in_order(calls):
        order = [first, "cancel" if first == "serve" else "serve"]
        return {label: calls[label]() for label in order}

    _cancel_while_advancing(plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT"), in_order)


@pytest.mark.skipif(SQLITE, reason=NEEDS_ROW_LOCKS)
@pytest.mark.django_db(transaction=True)
def test_cancelling_a_plan_while_it_advances_leaves_nothing_dispatching():
    _cancel_while_advancing(plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT"), _race)


# ── 7. 两个租户并发给同一灵魂开未结案审判 → 恰一件 ──────────────────────────────


def _two_tenants_open(cn, eg, eu, run):
    """灵魂在欧洲受刑:欧洲判官开加减项审判(情况 1)与原审判官批准 REOPEN(原属开重审)同时发生。
    G7(开审在灵魂行锁下再问一次)与批准 REOPEN 的同一把锁 → 恰一件未结案审判。
    G11(未结案唯一落成数据库约束)**没有做**,理由见交付报告;这里证明的是锁,不是约束。"""
    from apps.judgment.models import open_judgments

    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5), (eu, plan.stop_realm(eu), 7)])
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    plan.serve(soul, p, 2)
    plan.arrive(soul, p, 3)
    req = _client(plan.officer("pg7_eg", "JUDGE", eg)).post(
        f"{PLANS}{p.pk}/requests/", {"kind": "REOPEN", "reason": "新证据"}, format="json").data
    home = _client(plan.officer("pg7_cn", "JUDGE", cn))
    away = _client(plan.officer("pg7_eu", "JUDGE", eu))
    results = run({
        "reopen": lambda: home.post(f"{PLANS}{p.pk}/requests/{req['id']}/decide/", {"decision": "ACCEPT"},
                                    format="json").status_code,
        "amend": lambda: away.post("/api/v1/judgment/", {"soul": str(soul.pk)}, format="json").status_code,
    })
    assert results in ({"reopen": 200, "amend": 400}, {"reopen": 409, "amend": 201}), results
    assert open_judgments(soul).count() == 1


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("first", ["reopen", "amend"])
def test_opening_a_second_case_in_either_order_is_refused(first):
    def in_order(calls):
        order = [first, "amend" if first == "reopen" else "reopen"]
        return {label: calls[label]() for label in order}

    _two_tenants_open(plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT"), plan.tenant("EU_HEAVEN_HELL"), in_order)


@pytest.mark.skipif(SQLITE, reason=NEEDS_ROW_LOCKS)
@pytest.mark.django_db(transaction=True)
def test_two_tenants_opening_a_case_on_one_soul_at_once_open_exactly_one():
    _two_tenants_open(plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT"), plan.tenant("EU_HEAVEN_HELL"), _race)
