"""审查 2026-11-01 冥府服刑 / 调拨 / 转生那一组(local-gates/review-2026-11-01.md):

* P1 #2  撤销计划(赦免)与手动结束暂居要结束服刑:写 `expired_at`、离开界域,转生不再报 `term_not_served`。
* P1 #6  受刑计划自动调拨没能发起:记一次 NOT_STARTED 的拒绝(事件、待办),`retry_dispatch` 不再答 `not_refused`。
* P1 #7  手动结束暂居后,暂居地残留的处置不能再执行(租户检查 + 锁),且作废 —— 不再永久挡住转生。
* 拍板 #2 调拨只收「人在冥府」的灵魂(JUDGING / DISPOSED);计划进行中不许手动调拨 —— 都在服务层锁内判断。
* P2 #10 转生前检查没有未结案审判。

每条都断言缺陷的反面:修之前这些断言是红的(赦免后 `term_not_served`、`not_refused`、残留处置执行成功、
ALIVE 的灵魂调拨成功、带着未结案审判也能转生)。
"""
import pytest
from django.utils import timezone

from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.dispatch.services import DispatchService, SentencePlanActiveError, SoulNotDispatchableError
from apps.disposition.expiry import expire_one
from apps.disposition.models import Disposition
from apps.disposition.services import DispositionService
from apps.events.models import SoulEvent
from apps.judgment.models import Judgment, Verdict
from apps.reincarnation.services import RebirthBlocked, _unserved_term, assert_may_be_reborn
from apps.sentence_plan import requests as plan_requests
from apps.sentence_plan.models import SentencePlan
from apps.sentence_plan.services import NOT_STARTED, SentencePlanService, awaiting_redispatch_plan_ids, last_refusal
from apps.souls.models import Soul, SoulState
from tests import sentence_plan_support as plan

pytestmark = pytest.mark.django_db


@pytest.fixture
def cn():
    return plan.tenant("CN_DIYU")


@pytest.fixture
def eg():
    return plan.tenant("EG_DUAT")


def _code(soul):
    """`assert_may_be_reborn` 的拒绝码;不拒绝时 None。"""
    try:
        assert_may_be_reborn(Soul.all_objects.get(pk=soul.pk))
    except RebirthBlocked as blocked:
        return blocked.detail["code"]
    return None


def _serving_at_home(cn):
    """地府 FAILED 结案、判官定了三年刑期,原属那一站已执行、刑期没满(受刑中,节点 1 ACTIVE)。"""
    soul, case = plan.open_case(cn, name="受刑中")
    case.conclude(Verdict.FAILED, "", term_years=3)
    plan.walk_flow(case)
    soul.refresh_from_db()
    p = SentencePlan.all_objects.get(soul=soul)
    assert plan.execute_only(soul, p, 1)
    assert plan.node(p, 1).status == "ACTIVE"
    return soul, p


# ── P1 #2 赦免结束服刑 ────────────────────────────────────────────────────


def test_a_soul_still_serving_is_refused_rebirth(cn):
    soul, _ = _serving_at_home(cn)
    assert _unserved_term(soul) is not None
    assert _code(soul) == "term_not_served"


def test_cancelling_the_plan_ends_the_term_being_served_and_rebirth_is_open(cn):
    soul, p = _serving_at_home(cn)
    served = Disposition.all_objects.get(pk=plan.node(p, 1).disposition_id)

    plan_requests.cancel(p, reason="复核赦免", user=None)

    served.refresh_from_db()
    soul.refresh_from_db()
    assert served.expired_at is not None
    assert plan.node(p, 1).status == "ABORTED"
    assert SentencePlan.all_objects.get(pk=p.pk).status == "CANCELLED"
    assert soul.current_state == SoulState.REINCARNATING
    assert _unserved_term(soul) is None
    assert _code(soul) is None


def test_ending_a_residence_by_hand_ends_the_term_served_there(cn, eg):
    soul, p, _ = plan.at_stop(cn, eg, years=10)
    assert plan.execute_only(soul, p, 2)
    served = Disposition.all_objects.get(pk=plan.node(p, 2).disposition_id)
    assert _code(soul) == "term_not_served"

    DispatchService.end_residence(soul, actor="system", trigger=DispatchService.RETURN_MANUAL, reason="提前召回")

    served.refresh_from_db()
    soul.refresh_from_db()
    assert served.expired_at is not None
    assert plan.node(p, 2).status == "ABORTED"
    assert not soul.is_residing and soul.current_state == SoulState.REINCARNATING
    assert _code(soul) is None


# ── P1 #6 自动调拨没发出去 ────────────────────────────────────────────────


def test_a_dispatch_the_plan_could_not_start_is_recorded_once_and_can_be_sent_again(cn, eg):
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5)], name="卡住")
    blocker = DispatchService.propose(cn, eg, soul, None, "一条存量的手动调拨")  # 系统那条会被它挡住

    plan.serve(soul, p, 1)
    SentencePlanService.advance(Soul.all_objects.get(pk=soul.pk))  # 再推进一次:不重复记

    node = plan.node(p, 2)
    assert node.status == "PENDING" and node.dispatch_record_id is None
    refused = SoulEvent.objects.filter(soul=soul, event_type="SENTENCE_NODE_REFUSED", payload__node_id=str(node.pk))
    assert [e.payload["dispatch_status"] for e in refused] == [NOT_STARTED]
    assert last_refusal(node)["status"] == NOT_STARTED and last_refusal(node)["reason"] is None
    assert awaiting_redispatch_plan_ids(SentencePlan.all_objects.filter(pk=p.pk)) == {p.pk}

    DispatchService.cancel(blocker, "canceller")
    node = plan_requests.retry_dispatch(p, node.pk, user=None)

    assert node.status == "DISPATCHING" and node.dispatch_record_id is not None
    assert SoulEvent.objects.filter(soul=soul, event_type="SENTENCE_NODE_REDISPATCHED").count() == 1


# ── P1 #7 手动结束暂居后的残留处置 ────────────────────────────────────────


def _resident_without_plan(cn, eg):
    soul = Soul.objects.create(name="无计划客魂", tenant=cn, current_state=SoulState.DISPOSED)
    record = DispatchService.propose(cn, eg, soul, plan.officer("cn_mod7", "ADMIN", cn), "手动调拨去受审")
    DispatchService.approve(record, "approver")
    DispatchService.execute(DispatchRecord.all_objects.get(pk=record.pk), "executor")
    soul.refresh_from_db()
    assert soul.is_residing
    return soul


def test_ending_a_residence_by_hand_voids_the_residence_halls_unexecuted_disposition(cn, eg):
    soul = _resident_without_plan(cn, eg)
    left = Disposition.objects.create(soul=soul, tenant=eg)

    DispatchService.end_residence(soul, actor="system", trigger=DispatchService.RETURN_MANUAL, reason="召回")

    left = Disposition.all_objects.get(pk=left.pk)
    assert left.is_deleted and not left.is_executed
    soul = Soul.all_objects.get(pk=soul.pk)
    assert not soul.is_residing
    assert _code(soul) != "disposition_not_executed"


def test_a_residence_halls_disposition_does_not_execute_once_the_soul_is_home(cn, eg):
    soul = _resident_without_plan(cn, eg)
    DispatchService.end_residence(soul, actor="system", trigger=DispatchService.RETURN_MANUAL, reason="召回")
    stray = Disposition.objects.create(soul=Soul.all_objects.get(pk=soul.pk), tenant=eg)

    assert DispositionService.execute(stray) is False

    stray.refresh_from_db()
    assert not stray.is_executed
    assert Soul.all_objects.get(pk=soul.pk).current_state == SoulState.DISPOSED


def test_the_home_halls_own_disposition_still_executes(cn):
    soul = Soul.objects.create(name="本殿", tenant=cn, current_state=SoulState.DISPOSED)
    own = Disposition.objects.create(soul=soul, tenant=cn)
    assert DispositionService.execute(own) is True
    assert Soul.all_objects.get(pk=soul.pk).current_state == SoulState.REINCARNATING


# ── 拍板 #2 调拨的状态规则 ────────────────────────────────────────────────


@pytest.mark.parametrize("state", [SoulState.ALIVE, SoulState.REINCARNATING, SoulState.SETTLED, SoulState.LOST])
def test_a_soul_outside_the_underworld_is_not_dispatched(cn, eg, state):
    soul = Soul.objects.create(name=f"不在冥府{state}", tenant=cn, current_state=state)
    with pytest.raises(SoulNotDispatchableError):
        DispatchService.propose(cn, eg, soul, plan.officer(f"m_{state}", "ADMIN", cn), "手动调拨")
    assert not DispatchRecord.all_objects.filter(soul=soul).exists()


@pytest.mark.parametrize("state", [SoulState.JUDGING, SoulState.DISPOSED])
def test_a_soul_in_the_underworld_is_dispatched(cn, eg, state):
    soul = Soul.objects.create(name=f"在冥府{state}", tenant=cn, current_state=state)
    record = DispatchService.propose(cn, eg, soul, plan.officer(f"m_{state}", "ADMIN", cn), "手动调拨")
    assert record.status == DispatchStatus.PROPOSED


def test_a_soul_that_left_the_underworld_after_approval_is_not_moved(cn, eg):
    soul = Soul.objects.create(name="批准后转生", tenant=cn, current_state=SoulState.DISPOSED)
    record = DispatchService.propose(cn, eg, soul, plan.officer("m_late", "ADMIN", cn), "手动调拨")
    DispatchService.approve(record, "approver")
    Soul.all_objects.filter(pk=soul.pk).update(current_state=SoulState.REINCARNATING)

    with pytest.raises(SoulNotDispatchableError):
        DispatchService.execute(DispatchRecord.all_objects.get(pk=record.pk), "executor")

    assert Soul.all_objects.get(pk=soul.pk).tenant_id == cn.pk
    assert DispatchRecord.all_objects.get(pk=record.pk).status == DispatchStatus.APPROVED


def test_the_service_refuses_a_manual_dispatch_while_a_plan_runs_but_the_plan_itself_dispatches(cn, eg):
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5)], name="计划中")
    with pytest.raises(SentencePlanActiveError):
        DispatchService.propose(cn, eg, soul, plan.officer("m_plan", "ADMIN", cn), "手动调拨")
    assert not DispatchRecord.all_objects.filter(soul=soul).exists()

    plan.serve(soul, p, 1)  # 计划自己发起的那条(dispatcher=None)照常
    assert plan.node(p, 2).status == "DISPATCHING"


# ── P2 #10 转生前没有未结案审判 ──────────────────────────────────────────


def test_a_soul_with_an_open_judgment_is_not_reborn(cn):
    soul = Soul.objects.create(name="候转世", tenant=cn, current_state=SoulState.REINCARNATING)
    assert _code(soul) is None
    case = Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=cn)

    with pytest.raises(RebirthBlocked) as refused:
        assert_may_be_reborn(Soul.all_objects.get(pk=soul.pk))

    assert refused.value.detail["code"] == "open_judgment"
    assert refused.value.detail["open_judgment_ids"] == [str(case.pk)]
    case.soft_delete(reason="撤案")
    assert _code(soul) is None


def test_the_cancelled_plans_term_end_is_now(cn):
    """赦免记的期满时刻就是撤销那一刻,不是原定的期满日。"""
    soul, p = _serving_at_home(cn)
    before = timezone.now()
    plan_requests.cancel(p, reason="复核赦免", user=None)
    served = Disposition.all_objects.get(pk=plan.node(p, 1).disposition_id)
    assert before <= served.expired_at <= timezone.now()


# ── 没能发起调拨的通知不说「被拒」──────────────────────────────────────────


def test_a_dispatch_the_plan_could_not_start_does_not_tell_the_judge_it_was_refused(
    cn, eg, django_capture_on_commit_callbacks,
):
    from apps.notifications import messages
    from apps.notifications.models import UserNotification

    judge = plan.officer("cn_not_started", "ADMIN", cn)
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5)], name="没发出去")
    DispatchService.propose(cn, eg, soul, None, "一条存量的手动调拨")  # 系统那条会被它挡住

    with django_capture_on_commit_callbacks(execute=True):
        plan.serve(soul, p, 1)

    row = UserNotification.objects.get(user=judge, notification_type="SENTENCE_NODE_REFUSED")
    assert row.title == "受刑节点未能发起调拨"
    assert "没能发起调拨" in row.message and "{{" not in row.message
    assert "被拒" not in row.title and "拒绝" not in row.message
    assert messages.render("en", messages.kind_for(row.notification_type, row.params), row.params)[0] == (
        "Sentence stop not dispatched")


def test_a_real_refusal_still_says_refused():
    from apps.notifications import messages

    params = {"soul": "甲", "order": 2, "tenant": "EG_DUAT"}
    kind = messages.kind_for("SENTENCE_NODE_REFUSED", params)
    assert kind == "sentence_node_refused"
    assert "拒绝" in messages.render("zh-Hans", kind, params)[1]


# ── 手动结束无计划的暂居:正在服的处置 ────────────────────────────────────


def _served_during_residence(cn, eg, **fields):
    soul = _resident_without_plan(cn, eg)
    served = Disposition.objects.create(soul=soul, tenant=eg, is_executed=True, executed_at=timezone.now(), **fields)
    return soul, served


def test_ending_a_planless_residence_by_hand_ends_the_term_being_served(cn, eg):
    soul, served = _served_during_residence(cn, eg, sentence_years=10)
    assert _code(soul) == "term_not_served"

    DispatchService.end_residence(soul, actor="system", trigger=DispatchService.RETURN_MANUAL, reason="召回")

    served.refresh_from_db()
    assert served.expired_at is not None and not served.is_deleted
    assert _code(soul) != "term_not_served"


def test_ending_a_planless_residence_by_hand_is_no_pardon_of_an_eternal_term(cn, eg):
    soul, served = _served_during_residence(cn, eg, is_eternal=True)

    DispatchService.end_residence(soul, actor="system", trigger=DispatchService.RETURN_MANUAL, reason="召回")

    served.refresh_from_db()
    assert served.expired_at is None
    assert _code(soul) == "eternal_sentence"


def test_a_manual_end_leaves_a_term_at_home_running(cn, eg):
    soul, at_residence = _served_during_residence(cn, eg, sentence_years=10)
    at_home = Disposition.objects.create(soul=soul, tenant=cn, is_executed=True, executed_at=timezone.now(),
                                         sentence_years=10)

    DispatchService.end_residence(soul, actor="system", trigger=DispatchService.RETURN_MANUAL, reason="召回")

    at_residence.refresh_from_db()
    at_home.refresh_from_db()
    assert at_residence.expired_at is not None and at_home.expired_at is None


def test_an_automatic_return_is_no_pardon(cn, eg):
    soul, served = _served_during_residence(cn, eg, sentence_years=10)

    DispatchService.end_residence(soul, actor="system", trigger=DispatchService.RETURN_ON_DISPOSITION, reason="执行完")

    served.refresh_from_db()
    assert served.expired_at is None
    assert _code(soul) == "term_not_served"


def test_a_planless_term_keeps_the_soul_in_residence_until_it_is_served(cn, eg):
    """执行 = 开始服刑(用户 2026-10-29),无计划的暂居也一样:期满才回原属地。
    变异:`_execute_during_residence` 不看 `serving` → 执行当场回原属地,红。
    变异:`finish_serving` 去掉暂居分支 → 期满后还留在暂居地,红。"""
    soul = _resident_without_plan(cn, eg)
    term = Disposition.objects.create(soul=soul, tenant=eg, sentence_years=10, is_eternal=False)

    assert DispositionService.execute(term) is True
    soul.refresh_from_db()
    assert soul.is_residing and soul.tenant_id == eg.pk
    assert _code(soul) == "term_not_served"

    expire_one(Disposition.all_objects.get(pk=term.pk), timezone.now())
    soul.refresh_from_db()
    assert not soul.is_residing and soul.tenant_id == cn.pk


def test_a_planless_disposition_with_no_term_still_returns_at_once(cn, eg):
    """没记刑期就没有期满日可等:照旧一执行就回。"""
    soul = _resident_without_plan(cn, eg)
    done = Disposition.objects.create(soul=soul, tenant=eg, is_eternal=False)

    assert DispositionService.execute(done) is True
    soul.refresh_from_db()
    assert not soul.is_residing and soul.tenant_id == cn.pk
