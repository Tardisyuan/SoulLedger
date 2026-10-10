"""受刑计划:调拨被拒或取消后,原属判官对这一站「重新发起调拨」(docs/ARCHITECTURE-sentence-plan.md D5)。

重发走首次发起的同一条路径(`SentencePlanService.advance` → `_dispatch`),这里证明:
* 成功:节点 DISPATCHING、恰一条新调拨、一条 SENTENCE_NODE_REDISPATCHED(同一事务);
* 每一种拒绝**都断言未写入**(没有新调拨、节点没动、没有事件);
* 权限:原属租户(或 ADMIN)里持有 `judgment.execute` 的判官;
* `last_refusal` 由现有记录推导(事件 + 调拨记录),理由只来自调拨记录、不进事件 payload。
并发(两个官员同时点)只能在 PostgreSQL 上测,见 `tests/test_sentence_plan_concurrency.py`。
"""
import pytest
from django.db import OperationalError, connection

from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.dispatch.services import DispatchService
from apps.events.models import SoulEvent
from apps.sentence_plan import requests as plan_requests
from apps.sentence_plan.models import SentenceNode
from tests import sentence_plan_support as plan
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db
PLANS = "/api/v1/sentence-plans/"
REDISPATCHED = "SENTENCE_NODE_REDISPATCHED"


@pytest.fixture
def cn():
    return plan.tenant("CN_DIYU")


@pytest.fixture
def eg():
    return plan.tenant("EG_DUAT")


@pytest.fixture
def eu():
    return plan.tenant("EU_HEAVEN_HELL")


def _retry(user, p, order):
    node = plan.node(p, order)
    return officer_client(user).post(f"{PLANS}{p.pk}/nodes/{node.pk}/retry-dispatch/", {}, format="json")


def _refused(cn, eg, *, how="reject", stops=None):
    """原属已执行 → 第 2 站(埃及)被调拨;埃及拒绝 / 取消。返回 (soul, plan)。"""
    soul, p = plan.planned(cn, stops or [(eg, plan.stop_realm(eg), 5)])
    plan.serve(soul, p, 1)
    record = DispatchRecord.all_objects.get(pk=plan.node(p, 2).dispatch_record_id)
    if how == "reject":
        DispatchService.reject(record, plan.officer("eg_rej", "MODERATOR", eg), "不收")
    else:
        DispatchService.cancel(record, plan.officer("cn_can", "MODERATOR", cn))
    assert plan.node(p, 2).status == "PENDING"
    return soul, p


def _untouched(soul, p, order=2):
    """拒绝之后什么都没写:仍是 PENDING、没有新调拨、没有重发事件。"""
    assert plan.node(p, order).status == "PENDING"
    assert DispatchRecord.all_objects.filter(soul=soul).count() == 1
    assert not SoulEvent.objects.filter(soul=soul, event_type=REDISPATCHED).exists()


def test_a_judge_of_the_home_hall_sends_a_rejected_stop_again(cn, eg):
    soul, p = _refused(cn, eg)

    response = _retry(plan.officer("cn_judge", "JUDGE", cn), p, 2)

    assert response.status_code == 200, response.data
    node = plan.node(p, 2)
    assert node.status == "DISPATCHING"
    [new] = DispatchRecord.all_objects.filter(soul=soul, status__in=["PROPOSED", "APPROVED"])
    assert node.dispatch_record_id == new.pk and new.target_tenant_id == eg.pk and new.dispatched_by_id is None
    [event] = SoulEvent.objects.filter(soul=soul, event_type=REDISPATCHED)
    assert event.payload["node_id"] == str(node.pk) and event.payload["dispatch_id"] == str(new.pk)
    [shown] = [n for n in response.data["nodes"] if n["order"] == 2]
    assert shown["status"] == "DISPATCHING" and shown["last_refusal"] is None


def test_a_cancelled_dispatch_can_be_sent_again_too(cn, eg):
    soul, p = _refused(cn, eg, how="cancel")
    assert _retry(plan.officer("cn_judge", "JUDGE", cn), p, 2).status_code == 200
    assert plan.node(p, 2).status == "DISPATCHING"


def test_the_plan_says_why_the_last_dispatch_failed(cn, eg):
    soul, p = _refused(cn, eg)

    shown = officer_client(plan.officer("cn_judge", "JUDGE", cn)).get(f"{PLANS}{p.pk}/").data

    [stop] = [n for n in shown["nodes"] if n["order"] == 2]
    assert stop["last_refusal"]["status"] == "REJECTED" and stop["last_refusal"]["reason"] == "不收"
    assert stop["last_refusal"]["at"]
    [home] = [n for n in shown["nodes"] if n["order"] == 1]
    assert home["last_refusal"] is None
    # 理由不进灵魂能读到的事件
    [event] = SoulEvent.objects.filter(soul=soul, event_type="SENTENCE_NODE_REFUSED")
    assert "不收" not in str(event.payload)


def test_a_cancelled_dispatch_has_no_reason(cn, eg):
    soul, p = _refused(cn, eg, how="cancel")
    shown = officer_client(plan.officer("cn_judge", "JUDGE", cn)).get(f"{PLANS}{p.pk}/").data
    [stop] = [n for n in shown["nodes"] if n["order"] == 2]
    assert stop["last_refusal"]["status"] == "CANCELLED" and stop["last_refusal"]["reason"] is None


def test_a_second_attempt_is_refused_and_writes_nothing_more(cn, eg):
    soul, p = _refused(cn, eg)
    judge = plan.officer("cn_judge", "JUDGE", cn)
    assert _retry(judge, p, 2).status_code == 200

    again = _retry(judge, p, 2)

    assert again.status_code == 409 and again.data["code"] == "node_not_retryable"
    assert DispatchRecord.all_objects.filter(soul=soul).count() == 2
    assert SoulEvent.objects.filter(soul=soul, event_type=REDISPATCHED).count() == 1


def test_a_stop_that_was_never_refused_cannot_be_sent(cn, eg, eu):
    soul, p = _refused(cn, eg, stops=[(eg, plan.stop_realm(eg), 5), (eu, plan.stop_realm(eu), 7)])
    response = _retry(plan.officer("cn_judge", "JUDGE", cn), p, 3)
    assert response.status_code == 409 and response.data["code"] == "not_refused"
    _untouched(soul, p)


def test_a_later_refused_stop_waits_for_the_earlier_one(cn, eg, eu):
    soul, p = _refused(cn, eg, stops=[(eg, plan.stop_realm(eg), 5), (eu, plan.stop_realm(eu), 7)])
    # 构造:第 3 站也曾被拒(事件在),而第 2 站仍是 PENDING —— 重发第 3 站会让 `_step` 去调第 2 站。
    third = plan.node(p, 3)
    SoulEvent.objects.create(tenant=cn, soul=soul, event_type="SENTENCE_NODE_REFUSED", actor="system",
                             payload={"node_id": str(third.pk), "dispatch_status": "REJECTED"})
    response = _retry(plan.officer("cn_judge", "JUDGE", cn), p, 3)
    assert response.status_code == 409 and response.data["code"] == "not_next"
    _untouched(soul, p)


def test_the_home_stop_and_unknown_stops_are_not_sendable(cn, eg):
    soul, p = _refused(cn, eg)
    judge = plan.officer("cn_judge", "JUDGE", cn)
    assert _retry(judge, p, 1).data["code"] == "node_not_retryable"
    unknown = officer_client(judge).post(
        f"{PLANS}{p.pk}/nodes/00000000-0000-0000-0000-000000000000/retry-dispatch/", {}, format="json")
    assert unknown.status_code == 404 and unknown.data["code"] == "unknown_node"
    _untouched(soul, p)


def test_a_closed_plan_refuses(cn, eg):
    soul, p = _refused(cn, eg)
    node = plan.node(p, 2)
    plan_requests.cancel(p, reason="赦免", user=None)
    response = officer_client(plan.officer("cn_judge", "JUDGE", cn)).post(
        f"{PLANS}{p.pk}/nodes/{node.pk}/retry-dispatch/", {}, format="json")
    assert response.status_code == 409 and response.data["code"] == "plan_closed"
    assert not SoulEvent.objects.filter(soul=soul, event_type=REDISPATCHED).exists()


def test_an_open_judgment_blocks_it(cn, eg):
    from apps.judgment.models import Judgment

    soul, p = _refused(cn, eg)
    Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=cn)
    response = _retry(plan.officer("cn_judge", "JUDGE", cn), p, 2)
    assert response.status_code == 409 and response.data["code"] == "open_judgment"
    _untouched(soul, p)


def test_a_manual_dispatch_still_in_flight_blocks_it_and_nothing_is_kept(cn, eg):
    soul, p = _refused(cn, eg)
    DispatchService.propose(cn, eg, soul, None, "手动")
    response = _retry(plan.officer("cn_judge", "JUDGE", cn), p, 2)
    assert response.status_code == 409 and response.data["code"] == "dispatch_not_started"
    assert plan.node(p, 2).status == "PENDING" and plan.node(p, 2).dispatch_record_id is None
    assert DispatchRecord.all_objects.filter(soul=soul).count() == 2
    assert not SoulEvent.objects.filter(soul=soul, event_type=REDISPATCHED).exists()


def test_only_the_home_hall_and_admin_may_send_it(cn, eg, eu):
    soul, p = _refused(cn, eg)
    away = _retry(plan.officer("eg_judge", "JUDGE", eg), p, 2)
    assert away.status_code == 403 and away.data["code"] == "not_home"
    # 计划上没有节点的第三方看不到这份计划
    assert _retry(plan.officer("eu_judge", "JUDGE", eu), p, 2).status_code == 404
    # 原属租户里没有 `judgment.execute` 的角色
    assert _retry(plan.officer("cn_guard", "GUARDIAN", cn), p, 2).status_code == 403
    _untouched(soul, p)
    assert _retry(plan.officer("eu_admin", "ADMIN", eu), p, 2).status_code == 200


def test_a_failed_event_row_rolls_the_whole_retry_back(cn, eg):
    """事件是业务记录的一部分:写不进去,调拨与节点状态都不留(同 `test_event_log_inside_transactions` 的网格)。"""
    soul, p = _refused(cn, eg)
    node = plan.node(p, 2)

    def boom(execute, sql, params, many, context):
        if sql.lstrip().upper().startswith("INSERT INTO") and REDISPATCHED in (params or ()):
            raise OperationalError("injected")
        return execute(sql, params, many, context)

    with connection.execute_wrapper(boom), pytest.raises(OperationalError):
        plan_requests.retry_dispatch(p, node.pk, user=None)
    assert SentenceNode.all_objects.get(pk=node.pk).status == "PENDING"
    assert DispatchRecord.all_objects.filter(soul=soul).count() == 1
    assert DispatchRecord.all_objects.get(soul=soul).status == DispatchStatus.REJECTED
