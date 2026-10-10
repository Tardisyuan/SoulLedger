"""受刑计划:被拒 / 取消后等着重新发起的调拨,能被列出来(待办条的一格)、并说出已重发几次。

`GET sentence-plans/?awaiting_redispatch=true`:原属租户(ADMIN 不限)里,计划 ACTIVE / RETRIAL、
下一站是被拒 / 取消后退回 PENDING 的外地站。口径 = `retry_dispatch` 里与时间无关的前置条件
(`services.awaiting_redispatch_plan_ids`)。`last_refusal.redispatched` = `SENTENCE_NODE_REDISPATCHED` 事件数。
"""
import pytest

from apps.dispatch.models import DispatchRecord
from apps.dispatch.services import DispatchService
from tests import sentence_plan_support as plan
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db
PLANS = "/api/v1/sentence-plans/"


@pytest.fixture
def cn():
    return plan.tenant("CN_DIYU")


@pytest.fixture
def eg():
    return plan.tenant("EG_DUAT")


def _refuse(soul, p, eg, who="eg_rej"):
    record = DispatchRecord.all_objects.get(pk=plan.node(p, 2).dispatch_record_id)
    DispatchService.reject(record, plan.officer(who, "MODERATOR", eg), "不收")
    assert plan.node(p, 2).status == "PENDING"


def _refused_plan(cn, eg):
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5)])
    plan.serve(soul, p, 1)
    _refuse(soul, p, eg)
    return soul, p


def _awaiting(user, value="true"):
    res = officer_client(user).get(PLANS, {"awaiting_redispatch": value})
    assert res.status_code == 200, res.data
    return {row["id"] for row in res.data["results"]}


def test_a_refused_stop_puts_the_plan_on_the_home_judges_list_and_nobody_elses(cn, eg):
    soul, p = _refused_plan(cn, eg)
    judge = plan.officer("cn_judge", "JUDGE", cn)
    assert _awaiting(judge) == {str(p.pk)}
    # 执行地看得到这份计划,但这件事不是它的:不算它的待办。
    assert _awaiting(plan.officer("eg_judge", "JUDGE", eg)) == set()
    # 取反给出补集。
    assert str(p.pk) not in _awaiting(judge, "false")


def test_it_leaves_the_list_once_sent_again_and_comes_back_if_refused_again(cn, eg):
    soul, p = _refused_plan(cn, eg)
    judge = plan.officer("cn_judge", "JUDGE", cn)
    node = plan.node(p, 2)
    sent = officer_client(judge).post(f"{PLANS}{p.pk}/nodes/{node.pk}/retry-dispatch/", {}, format="json")
    assert sent.status_code == 200, sent.data
    assert _awaiting(judge) == set()

    _refuse(soul, p, eg, who="eg_rej2")
    assert _awaiting(judge) == {str(p.pk)}


def test_a_plan_whose_dispatch_is_simply_underway_is_not_listed(cn, eg):
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5)])
    plan.serve(soul, p, 1)  # 第 2 站正在调拨,没被拒过
    assert plan.node(p, 2).status == "DISPATCHING"
    assert _awaiting(plan.officer("cn_judge", "JUDGE", cn)) == set()


def test_a_closed_plan_is_not_listed(cn, eg):
    soul, p = _refused_plan(cn, eg)
    type(p).all_objects.filter(pk=p.pk).update(status="CANCELLED")
    assert _awaiting(plan.officer("cn_judge", "JUDGE", cn)) == set()


def test_the_card_says_how_many_times_it_was_sent_again(cn, eg):
    soul, p = _refused_plan(cn, eg)
    judge = plan.officer("cn_judge", "JUDGE", cn)

    def shown():
        data = officer_client(judge).get(f"{PLANS}{p.pk}/").data
        return next(n for n in data["nodes"] if n["order"] == 2)["last_refusal"]

    assert shown()["redispatched"] == 0
    node = plan.node(p, 2)
    officer_client(judge).post(f"{PLANS}{p.pk}/nodes/{node.pk}/retry-dispatch/", {}, format="json")
    _refuse(soul, p, eg, who="eg_rej2")
    assert shown()["redispatched"] == 1
