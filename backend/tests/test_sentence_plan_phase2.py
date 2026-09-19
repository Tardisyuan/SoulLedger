"""受刑计划阶段 2:推进(docs/ARCHITECTURE-sentence-plan.md §9 第 2 行)。

暂居一站的到达 / 刑满 / 回归 / 暂留 / 被拒在 tests/test_dispatch_residence.py;这里是:
* 原审判结案抄联审节点(Q15:只抄 PASS)与挂着未结束联审答 409(Q17);
* §5 的站内通知(收件人两面都断言)与推送;
* 原属永久刑期的两种形状。

用户都不是 ADMIN,除非测试名说是。
"""
import json

import pytest

from apps.dispatch.models import JudgmentStatus
from apps.dispatch.services import CrossTenantJudgmentService
from apps.disposition.models import Disposition
from apps.events.models import SoulEvent
from apps.judgment.models import Judgment
from apps.notifications.models import UserNotification
from apps.sentence_plan.models import SentencePlan
from apps.soul_push.models import PushDelivery
from apps.souls.models import SoulState
from tests import sentence_plan_support as plan
from tests.soul_account_support import officer_client, ready_soul
from tests.soul_push_support import enqueued, register  # noqa: F401

pytestmark = pytest.mark.django_db


@pytest.fixture
def cn():
    return plan.tenant("CN_DIYU")


@pytest.fixture
def eg():
    return plan.tenant("EG_DUAT")


@pytest.fixture
def eu():
    return plan.tenant("EU_HEAVEN_HELL")


def _told(kind):
    return {n.user.username for n in UserNotification.objects.filter(notification_type=kind).select_related("user")}


# ── 原审判结案:抄联审节点(Q15)与未结束的联审(Q17)────────────────────


def test_a_pass_bench_puts_each_seat_into_the_plan_in_order(cn, eg, eu):
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5), (eu, plan.stop_realm(eu, eternal=True), None)])

    nodes = list(p.nodes.order_by("order"))
    assert [(n.order, n.tenant_code, n.is_home, n.status) for n in nodes] == [
        (1, "CN_DIYU", True, "ACTIVE"), (2, "EG_DUAT", False, "PENDING"), (3, "EU_HEAVEN_HELL", False, "PENDING")]
    assert (nodes[1].realm_code, nodes[1].sentence_years, nodes[1].is_eternal) == ("EG_DUAT_TEST_HALL", 5, False)
    assert (nodes[2].realm_code, nodes[2].sentence_years, nodes[2].is_eternal) == ("EU_HEAVEN_HELL_TEST_ETERNAL", None, True)
    assert all(n.added_by_judgment_id == p.origin_judgment_id for n in nodes)
    assert p.cross_judgment_id is not None
    assert SoulEvent.objects.filter(soul=soul, event_type="SENTENCE_PLAN_CREATED").count() == 1


def test_a_fail_bench_is_recorded_but_its_seats_are_not_copied(cn, eg):
    """Q15:FAIL 的联审照跑结束校验,但不抄节点 —— 计划只有原属一站。"""
    soul, case = plan.open_case(cn)
    cj = plan.bench(case, [(eg, plan.stop_realm(eg), 5)], conclusion="FAIL")
    case.conclude("PASSED", "")
    p = SentencePlan.all_objects.get(soul=soul)
    assert p.cross_judgment_id == cj.pk
    assert [(n.order, n.tenant_code) for n in p.nodes.all()] == [(1, "CN_DIYU")]


def test_a_cancelled_bench_does_not_hold_the_conclusion(cn, eg):
    soul, case = plan.open_case(cn)
    cj = CrossTenantJudgmentService.create("联审", "d", cn, None)
    cj.judgment = case
    cj.save(update_fields=["judgment"])
    cj.transition_to(JudgmentStatus.CANCELLED)
    assert case.conclude("PASSED", "") is True
    assert [n.order for n in SentencePlan.all_objects.get(soul=soul).nodes.all()] == [1]


@pytest.mark.parametrize("convened", [False, True])
def test_an_unfinished_bench_refuses_the_conclusion_with_409_and_writes_nothing(cn, eg, convened):
    """Q17:挂着的联审 PROPOSED / ACTIVE → 409 `cross_judgment_open`;裁决、处置、计划、灵魂状态都不动。"""
    soul, case = plan.open_case(cn)
    cj = CrossTenantJudgmentService.create("联审", "d", cn, None)
    cj.judgment = case
    cj.save(update_fields=["judgment"])
    if convened:
        from apps.dispatch.models import ParticipantRole

        seat = CrossTenantJudgmentService.add_participant(cj, eg, None, ParticipantRole.CO_JUDGE, node_order=2)
        CrossTenantJudgmentService.submit_sentence(seat, plan.stop_realm(eg), 5, "", None)
        CrossTenantJudgmentService.activate(cj)
    judge = plan.officer("cn_judge", "JUDGE", cn)

    response = officer_client(judge).post(f"/api/v1/judgment/{case.pk}/conclude/", {"verdict": "PASSED"}, format="json")

    assert response.status_code == 409, response.data
    assert response.data["code"] == "cross_judgment_open"
    case.refresh_from_db()
    soul.refresh_from_db()
    assert case.verdict is None and case.is_final is False
    assert not Disposition.all_objects.filter(soul=soul).exists()
    assert not SentencePlan.all_objects.filter(soul=soul).exists()
    assert soul.current_state == SoulState.JUDGING


def test_a_bench_whose_realm_went_away_refuses_the_conclusion(cn, eg):
    """§2.3:原属 `conclude/` 再跑一遍联审校验(realm 在联审结束后被改了文明)。"""
    from apps.realms.models import Realm

    soul, case = plan.open_case(cn)
    plan.bench(case, [(eg, plan.stop_realm(eg), 5)])
    Realm.all_objects.filter(realm_code="EG_DUAT_TEST_HALL").update(civilization="EUROPEAN")
    response = officer_client(plan.officer("cn_judge", "JUDGE", cn)).post(
        f"/api/v1/judgment/{case.pk}/conclude/", {"verdict": "PASSED"}, format="json")
    assert response.status_code == 409 and response.data["code"] == "cross_judgment_invalid"
    assert not SentencePlan.all_objects.filter(soul=soul).exists()


# ── 单节点计划:原属处置执行即计划完成 ─────────────────────────────────────


def test_executing_a_single_home_node_through_the_api_completes_the_plan_and_triggers_rebirth_once(cn):
    """`disposition/views.py` 原来在执行后调 `ReincarnationService.execute`;它挪到了计划完成(§3.3)。
    视图若照旧再调一次,中国灵魂的时间线上会有两条 REINCARNATION_TRIGGERED。"""
    soul, p = plan.planned(cn)
    home = plan.node(p, 1)
    response = officer_client(plan.officer("cn_mod", "MODERATOR", cn)).post(
        f"/api/v1/disposition/{home.disposition_id}/execute/", {}, format="json")
    assert response.status_code == 200, response.data
    soul.refresh_from_db()
    p.refresh_from_db()
    assert p.status == "COMPLETED" and soul.current_state == SoulState.REINCARNATING
    assert SoulEvent.objects.filter(soul=soul, event_type="REINCARNATION_TRIGGERED").count() == 1


# ── 原属地的永久刑期 ─────────────────────────────────────────────────────


def test_an_eternal_home_node_with_stops_after_it_holds_the_plan(cn, eg):
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5)])
    Disposition.all_objects.filter(pk=plan.node(p, 1).disposition_id).update(is_eternal=True)
    plan.serve(soul, p, 1)
    p.refresh_from_db()
    soul.refresh_from_db()
    assert plan.node(p, 1).status == "ETERNAL" and p.status == "HELD"
    assert plan.node(p, 2).status == "PENDING" and not plan.records(soul).exists()
    assert soul.current_state == SoulState.DISPOSED


# ── 站内通知(§5.1)──────────────────────────────────────────────────────


@pytest.fixture
def people(cn, eg, eu):
    make = plan.officer
    return {
        "cn_judge": make("cn_judge", "JUDGE", cn), "cn_mod": make("cn_mod", "MODERATOR", cn),
        "cn_admin": make("cn_admin", "ADMIN", cn),
        "eg_judge": make("eg_judge", "JUDGE", eg),
        # 不该收的:
        "cn_guardian": make("cn_guardian", "GUARDIAN", cn), "cn_retired": make("cn_retired", "JUDGE", cn, is_active=False),
        "eu_judge": make("eu_judge", "JUDGE", eu), "eu_admin": make("eu_admin", "ADMIN", eu),
        "eg_viewer": make("eg_viewer", "VIEWER", eg),
    }


HOME_JUDGES = {"cn_judge", "cn_mod", "cn_admin"}


def test_arrival_is_told_to_the_stops_judges_and_completion_to_the_homes(cn, eg, people):
    soul, p, _ = plan.at_stop(cn, eg)
    assert _told("SENTENCE_NODE_ACTIVE") == {"eg_judge"}
    plan.serve(soul, p, 2)
    # 原属节点与外地节点各一次「结束」,都只给原属判官。
    done = UserNotification.objects.filter(notification_type="SENTENCE_NODE_DONE")
    assert {n.user.username for n in done} == HOME_JUDGES and done.count() == 2 * len(HOME_JUDGES)
    assert _told("SENTENCE_PLAN_COMPLETED") == HOME_JUDGES


def test_the_notice_names_soul_stop_and_civilization_but_no_case_detail(cn, eg, people):
    soul, p, _ = plan.at_stop(cn, eg)
    note = UserNotification.objects.get(notification_type="SENTENCE_NODE_ACTIVE")
    assert "客魂" in note.message and "2" in note.message and "EG_DUAT" in note.message
    assert note.params == {"soul": "客魂", "order": 2, "tenant": "EG_DUAT"}
    for secret in (str(p.origin_judgment_id), "PASSED", "EG_DUAT_TEST_HALL"):
        assert secret not in note.message and secret not in note.title


def test_the_notice_is_rendered_in_the_readers_language(cn, eg, people):
    plan.at_stop(cn, eg)
    client = officer_client(people["eg_judge"])
    rows = client.get("/api/v1/notifications/", HTTP_ACCEPT_LANGUAGE="en").data["results"]
    [row] = [r for r in rows if r["notification_type"] == "SENTENCE_NODE_ACTIVE"]
    assert row["title"] == "Sentence stop begun" and "Stop 2" in row["message"] and "{{" not in row["message"]


def test_a_participants_sentence_is_told_to_the_initiators_judges(cn, eg, people):
    plan.planned(cn, [(eg, plan.stop_realm(eg), 5)])
    assert _told("CROSS_SENTENCE_SUBMITTED") == HOME_JUDGES


def test_the_blocked_return_inside_a_plan_keeps_the_notify_judges_rule(cn, eg, eu):
    """feat/notify-judges(Q8,§7.3)的规则在计划路径上同样成立:暂居地判官收,原属 / 第三文明 / 离职判官不收。"""
    soul, p, _ = plan.at_stop(cn, eg)
    away_judge = plan.officer("away_judge", "JUDGE", eg)
    home_judge = plan.officer("home_judge", "JUDGE", cn)
    third_judge = plan.officer("third_judge", "JUDGE", eu)
    retired = plan.officer("away_retired_judge", "JUDGE", eg, is_active=False)
    Judgment.objects.create(soul=soul, tenant=eg, civilization=soul.civilization)
    plan.serve(soul, p, 2)
    told = {n.user_id for n in UserNotification.objects.filter(notification_type="DISPATCH_RETURN_BLOCKED")}
    assert away_judge.pk in told
    assert not told & {home_judge.pk, third_judge.pk, retired.pk}


# ── 推送(§5.2)──────────────────────────────────────────────────────────


def _pushed_soul(home, stops):
    """带账号与设备的计划灵魂。"""
    account, client = ready_soul(home, name="推送魂")
    assert register(client).status_code == 201
    soul = account.soul
    case = Judgment.objects.create(soul=soul, civilization=soul.civilization, tenant=home)
    plan.bench(case, stops)
    case.conclude("PASSED", "")
    return soul, SentencePlan.all_objects.get(soul=soul)


def _kinds():
    return sorted(PushDelivery.objects.values_list("kind", flat=True))


def test_each_served_stop_pushes_once_and_completion_says_rebirth_is_open(cn, eg, enqueued):  # noqa: F811
    soul, p = _pushed_soul(cn, [(eg, plan.stop_realm(eg), 5)])
    PushDelivery.objects.all().delete()  # 结案的 judgment_result 不在这里比
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    plan.serve(soul, p, 2)
    assert _kinds() == ["disposition_executed", "disposition_executed", "residence_approved", "residence_returned",
                        "residence_started", "sentence_completed"]
    keys = set(PushDelivery.objects.filter(kind="disposition_executed").values_list("dedupe_key", flat=True))
    assert keys == {f"node:{plan.node(p, 1).pk}:done", f"node:{plan.node(p, 2).pk}:done"}
    completed = PushDelivery.objects.get(kind="sentence_completed")
    assert (completed.title, completed.data) == ("受刑完毕", {"screen": "Life", "kind": "sentence_completed"})


def test_a_waiting_soul_is_told_it_waits_and_nothing_about_the_case(cn, eg, enqueued):  # noqa: F811
    soul, p = _pushed_soul(cn, [(eg, plan.stop_realm(eg), 5)])
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    case = Judgment.objects.create(soul=soul, tenant=eg, civilization=soul.civilization, notes="SECRET-CASE")
    PushDelivery.objects.all().delete()
    plan.serve(soul, p, 2)
    assert _kinds() == ["sentence_waiting"]
    everything = json.dumps(list(PushDelivery.objects.values("title", "body", "data")), ensure_ascii=False)
    for secret in ("SECRET", str(case.pk), "EG_DUAT", "CN_DIYU"):
        assert secret not in everything, secret
