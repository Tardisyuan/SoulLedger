"""受刑计划阶段 3:加减项与撤销(docs/ARCHITECTURE-sentence-plan.md §4、§3.1,§9 第 3 行)。

* 情况 1:灵魂所在地开 AMENDMENT 审判,结案带 `plan_changes` → 请求 → 原审判官决定。
* 情况 2.1 / 2.2:提出方直接提请求(AMEND / REOPEN)。
* REOPEN(Q7、N1=(a)):批准即在原属地开重开审判,结案产出新裁决 + 新的原属节点。
* 撤销(Q11):`sentence_plan.cancel`。

**每一种拒绝都断言未写入**:只断言 4xx,在「拒绝了但写了一半」时照样是绿的。
用户都不是 ADMIN,除非测试名说是。
"""
import pytest

from apps.audit.models import AuditLog
from apps.dispatch.models import DispatchRecord
from apps.disposition.models import Disposition
from apps.events.models import SoulEvent
from apps.judgment.models import Judgment
from apps.notifications.models import UserNotification
from apps.sentence_plan.models import SentenceNode, SentencePlan, SentencePlanRequest
from apps.souls.models import SoulState
from tests import sentence_plan_support as plan
from tests.soul_account_support import officer_client
from tests.soul_push_support import enqueued  # noqa: F401

pytestmark = pytest.mark.django_db
PLANS = "/api/v1/sentence-plans/"


@pytest.fixture
def cn():
    return plan.tenant("CN_DIYU")


@pytest.fixture
def eg():
    return plan.tenant("EG_DUAT")


@pytest.fixture
def eu():
    return plan.tenant("EU_HEAVEN_HELL")


@pytest.fixture
def judges(cn, eg, eu):
    return {code: plan.officer(f"judge_{code}", "JUDGE", t) for code, t in (("cn", cn), ("eg", eg), ("eu", eu))}


def _c(user):
    return officer_client(user)


def _shape(p):
    return [(n.order, n.tenant_code, n.status) for n in SentenceNode.all_objects.filter(plan=p).order_by("order", "status")]


def _two_stops(cn, eg, eu):
    """原属已执行,灵魂在埃及(第 2 站 ACTIVE),欧洲第 3 站未开始。"""
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5), (eu, plan.stop_realm(eu), 7)])
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    return soul, p


def _open_amendment(judge, soul):
    response = _c(judge).post("/api/v1/judgment/", {"soul": str(soul.pk)}, format="json")
    assert response.status_code == 201, response.data
    return Judgment.all_objects.get(pk=response.data["id"])


def _conclude(judge, case, **body):
    return _c(judge).post(f"/api/v1/judgment/{case.pk}/conclude/", {"verdict": "FAILED", **body}, format="json")


def _nothing_changed(p, shape, *, requests=0):
    assert _shape(p) == shape
    assert SentencePlanRequest.all_objects.filter(plan=p).count() == requests


# ── 情况 1:灵魂在 X,X 开加减项审判 ──────────────────────────────────────


def test_a_case_opened_where_the_soul_serves_is_an_amendment_of_its_plan(cn, eg, eu, judges):
    soul, p = _two_stops(cn, eg, eu)
    case = _open_amendment(judges["eg"], soul)
    assert (case.kind, case.amends_plan_id, case.tenant_id) == ("AMENDMENT", p.pk, eg.pk)


def test_concluding_an_amendment_files_a_request_and_moves_nothing_else(cn, eg, eu, judges):
    soul, p = _two_stops(cn, eg, eu)
    case = _open_amendment(judges["eg"], soul)
    dispositions = Disposition.all_objects.filter(soul=soul).count()

    response = _conclude(judges["eg"], case, notes="当地加刑",
                         plan_changes={"add": [{"realm_code": plan.stop_realm(eg), "sentence_years": 3}]})

    assert response.status_code == 200, response.data
    case.refresh_from_db()
    soul.refresh_from_db()
    assert case.verdict == "FAILED" and case.is_final
    # G1:以前结不了案;现在结了,但不建处置、不动灵魂状态。
    assert soul.current_state == SoulState.DISPOSED and Disposition.all_objects.filter(soul=soul).count() == dispositions
    [req] = SentencePlanRequest.all_objects.filter(plan=p)
    assert (req.kind, req.status, req.from_tenant_code, req.requested_by_judgment_id) == (
        "AMEND", "PENDING", "EG_DUAT", case.pk)
    assert req.changes["add"][0]["tenant_code"] == "EG_DUAT" and req.changes["add"][0]["sentence_years"] == 3
    assert {n.user_id for n in UserNotification.objects.filter(notification_type="SENTENCE_REQUEST_PENDING")} == {
        judges["cn"].pk}
    # 节点还没变:原审判官批准之前计划原样(Q2)。
    assert _shape(p) == [(1, "CN_DIYU", "COMPLETED"), (2, "EG_DUAT", "ACTIVE"), (3, "EU_HEAVEN_HELL", "PENDING")]


def test_accepting_an_amendment_inserts_after_the_current_stop_and_shifts_the_rest(cn, eg, eu, judges):
    soul, p = _two_stops(cn, eg, eu)
    case = _open_amendment(judges["eg"], soul)
    _conclude(judges["eg"], case, plan_changes={"add": [{"realm_code": plan.stop_realm(eg), "sentence_years": 3}]})
    req = SentencePlanRequest.all_objects.get(plan=p)

    response = _c(judges["cn"]).post(f"{PLANS}{p.pk}/requests/{req.pk}/decide/", {"decision": "ACCEPT"}, format="json")

    assert response.status_code == 200, response.data
    assert _shape(p) == [(1, "CN_DIYU", "COMPLETED"), (2, "EG_DUAT", "ACTIVE"), (3, "EG_DUAT", "PENDING"),
                         (4, "EU_HEAVEN_HELL", "PENDING")]
    added = SentenceNode.all_objects.get(plan=p, order=3)
    assert added.added_by_request_id == req.pk and added.added_by_judgment_id == case.pk
    req.refresh_from_db()
    assert req.status == "ACCEPTED" and req.decided_at is not None
    assert SoulEvent.objects.filter(soul=soul, event_type="SENTENCE_PLAN_AMENDED").count() == 1
    assert AuditLog.objects.filter(resource="sentence_plan", resource_id=str(p.pk)).exists()
    assert {n.user_id for n in UserNotification.objects.filter(notification_type="SENTENCE_REQUEST_DECIDED")} == {
        judges["eg"].pk}
    amended = {n.user_id for n in UserNotification.objects.filter(notification_type="SENTENCE_PLAN_AMENDED")}
    assert amended == {judges["cn"].pk, judges["eg"].pk}  # 欧洲的节点没被动,欧洲判官不收


def test_a_soul_whose_stop_is_served_stays_until_the_original_judge_decides(cn, eg, eu, judges):
    """§4.2:加减项审判未结时刑满 → WAITING;结案生成请求 → 仍留在 X;驳回 → 回家并调往下一站。"""
    soul, p = _two_stops(cn, eg, eu)
    case = _open_amendment(judges["eg"], soul)
    plan.serve(soul, p, 2)
    assert plan.node(p, 2).status == "WAITING"

    _conclude(judges["eg"], case, plan_changes={"add": [{"realm_code": plan.stop_realm(eg)}]})
    soul.refresh_from_db()
    assert soul.tenant_id == eg.pk and plan.node(p, 2).status == "COMPLETED"

    req = SentencePlanRequest.all_objects.get(plan=p)
    _c(judges["cn"]).post(f"{PLANS}{p.pk}/requests/{req.pk}/decide/", {"decision": "REJECT", "reason": "不必"},
                          format="json")
    soul.refresh_from_db()
    assert soul.tenant_id == cn.pk and plan.node(p, 3).status == "DISPATCHING"
    assert _shape(p)[-1] == (3, "EU_HEAVEN_HELL", "DISPATCHING")


def test_an_amendment_without_changes_files_no_request(cn, eg, eu, judges):
    soul, p = _two_stops(cn, eg, eu)
    case = _open_amendment(judges["eg"], soul)
    assert _conclude(judges["eg"], case).status_code == 200
    assert not SentencePlanRequest.all_objects.filter(plan=p).exists()


@pytest.mark.parametrize("changes,code,status", [
    # N2=(a):只能给自己文明加节点。
    ({"add": [{"tenant_code": "EU_HEAVEN_HELL", "realm_code": "EU_HEAVEN_HELL_TEST_HALL"}]}, "foreign_node", 400),
    ({"add": [{"realm_code": "EU_HEAVEN_HELL_TEST_HALL"}]}, "foreign_realm", 400),
    ({"add": [{"realm_code": "EG_DUAT_TEST_HALL", "sentence_years": -1}]}, "invalid_changes", 400),
    ({"remove": ["CURRENT"]}, "node_not_pending", 400),
    ({"remove": ["00000000-0000-0000-0000-000000000009"]}, "unknown_node", 400),
    ({"move": []}, "invalid_changes", 400),
])
def test_a_refused_amendment_writes_nothing_not_even_its_verdict(cn, eg, eu, judges, changes, code, status):
    soul, p = _two_stops(cn, eg, eu)
    plan.stop_realm(eu)
    if changes.get("remove") == ["CURRENT"]:
        changes = {"remove": [str(plan.node(p, 2).pk)]}
    case = _open_amendment(judges["eg"], soul)
    before = _shape(p)

    response = _conclude(judges["eg"], case, plan_changes=changes)

    assert response.status_code == status and response.data["code"] == code, response.data
    case.refresh_from_db()
    assert case.verdict is None and not case.is_final
    _nothing_changed(p, before)


def test_an_amendment_on_a_held_plan_is_refused(cn, eg, judges):
    soul, p, _ = plan.at_stop(cn, eg, eternal=True)
    plan.serve(soul, p, 2)
    case = _open_amendment(judges["eg"], soul)
    before = _shape(p)
    response = _conclude(judges["eg"], case, plan_changes={"add": [{"realm_code": plan.stop_realm(eg)}]})
    assert response.status_code == 409 and response.data["code"] == "plan_held"
    case.refresh_from_db()
    assert case.verdict is None
    _nothing_changed(p, before)


def test_plan_changes_on_an_original_judgment_are_refused(cn, judges):
    soul, case = plan.open_case(cn)
    response = _conclude(judges["cn"], case, plan_changes={"add": [{"realm_code": "X"}]})
    assert response.status_code == 400 and response.data["code"] == "invalid_changes"
    case.refresh_from_db()
    assert case.verdict is None and not SentencePlan.all_objects.filter(soul=soul).exists()


# ── 情况 2.1 / 2.2:提出方直接提请求 ───────────────────────────────────────


def _file(judge, p, **body):
    return _c(judge).post(f"{PLANS}{p.pk}/requests/", body, format="json")


def test_a_stop_not_yet_reached_asks_for_a_node_and_it_is_appended_at_the_tail(cn, eg, eu, judges):
    soul, p = _two_stops(cn, eg, eu)
    response = _file(judges["eu"], p, kind="AMEND", reason="再加一站",
                     changes={"add": [{"realm_code": plan.stop_realm(eu), "sentence_years": 2}]})
    assert response.status_code == 201, response.data
    assert response.data["from_tenant_code"] == "EU_HEAVEN_HELL" and response.data["status"] == "PENDING"
    _c(judges["cn"]).post(f"{PLANS}{p.pk}/requests/{response.data['id']}/decide/", {"decision": "ACCEPT"},
                          format="json")
    assert _shape(p)[-1] == (4, "EU_HEAVEN_HELL", "PENDING")


def test_a_pending_node_can_be_removed_and_frees_its_number(cn, eg, eu, judges):
    soul, p = _two_stops(cn, eg, eu)
    third = plan.node(p, 3)
    req = _file(judges["eu"], p, kind="AMEND", changes={"remove": [str(third.pk)]}).data
    _c(judges["cn"]).post(f"{PLANS}{p.pk}/requests/{req['id']}/decide/", {"decision": "ACCEPT"}, format="json")
    third.refresh_from_db()
    assert third.status == "REMOVED" and str(third.removed_by_request_id) == req["id"]
    # 刑满回家后没有剩余节点 → 计划完成。
    plan.serve(soul, p, 2)
    p.refresh_from_db()
    assert p.status == "COMPLETED"


def test_a_dispatching_node_cannot_be_removed(cn, eg, eu, judges):
    """§4.1:DISPATCHING 的节点不能删 —— 先在调拨侧 reject,节点自动回 PENDING。"""
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5), (eu, plan.stop_realm(eu), 7)])
    plan.serve(soul, p, 1)
    before = _shape(p)
    response = _file(judges["eu"], p, kind="AMEND", changes={"remove": [str(plan.node(p, 2).pk)]})
    assert response.status_code == 400 and response.data["code"] == "node_not_pending"
    assert response.data["node_status"] == "DISPATCHING"
    _nothing_changed(p, before)


def test_a_tenant_with_no_node_cannot_reach_the_plan_and_home_must_open_a_case(cn, eg, eu, judges):
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5)])
    plan.serve(soul, p, 1)
    # 欧洲在这份计划里没有节点:连计划都看不到(见交付报告「待拍板」:2.2 的「X 不在计划里」)。
    response = _file(judges["eu"], p, kind="AMEND", changes={"add": [{"realm_code": plan.stop_realm(eu)}]})
    assert response.status_code == 404
    # 灵魂就在原属:原属判官要开审判,不是提请求。
    response = _file(judges["cn"], p, kind="AMEND", changes={"remove": [str(plan.node(p, 2).pk)]})
    assert response.status_code == 400 and response.data["code"] == "soul_is_here"
    assert not SentencePlanRequest.all_objects.filter(plan=p).exists()


def test_the_soul_being_here_means_open_a_case_not_file_a_request(cn, eg, eu, judges):
    soul, p = _two_stops(cn, eg, eu)
    before = _shape(p)
    response = _file(judges["eg"], p, kind="AMEND", changes={"add": [{"realm_code": plan.stop_realm(eg)}]})
    assert response.status_code == 400 and response.data["code"] == "soul_is_here"
    _nothing_changed(p, before)


def test_a_request_for_another_civilizations_node_is_refused(cn, eg, eu, judges):
    """N2=(a):要在别处加节点,由原属判官另开联审。"""
    soul, p = _two_stops(cn, eg, eu)
    before = _shape(p)
    response = _file(judges["eu"], p, kind="AMEND",
                     changes={"add": [{"tenant_code": "EG_DUAT", "realm_code": plan.stop_realm(eg)}]})
    assert response.status_code == 400 and response.data["code"] == "foreign_node"
    _nothing_changed(p, before)


def test_removing_a_started_node_by_request_is_refused_with_its_state(cn, eg, eu, judges):
    soul, p = _two_stops(cn, eg, eu)
    before = _shape(p)
    response = _file(judges["eu"], p, kind="AMEND", changes={"remove": [str(plan.node(p, 2).pk)]})
    assert response.status_code == 400 and response.data["code"] == "node_not_pending"
    assert response.data["node_status"] == "ACTIVE"
    _nothing_changed(p, before)


def test_one_pending_request_per_plan(cn, eg, eu, judges):
    soul, p = _two_stops(cn, eg, eu)
    assert _file(judges["eu"], p, kind="AMEND", changes={"add": [{"realm_code": plan.stop_realm(eu)}]}).status_code == 201
    response = _file(judges["eu"], p, kind="AMEND", changes={"add": [{"realm_code": plan.stop_realm(eu)}]})
    assert response.status_code == 409 and response.data["code"] == "request_pending"
    assert SentencePlanRequest.all_objects.filter(plan=p).count() == 1


def test_an_empty_amend_and_a_reasonless_reopen_are_refused(cn, eg, eu, judges):
    soul, p = _two_stops(cn, eg, eu)
    assert _file(judges["eu"], p, kind="AMEND", changes={}).data["code"] == "empty_changes"
    assert _file(judges["eu"], p, kind="REOPEN").data["code"] == "reason_required"
    assert _file(judges["eu"], p, kind="REOPEN", reason="x",
                 changes={"add": [{"realm_code": plan.stop_realm(eu)}]}).data["code"] == "invalid_changes"
    assert not SentencePlanRequest.all_objects.filter(plan=p).exists()


def test_only_the_home_tenant_decides(cn, eg, eu, judges):
    soul, p = _two_stops(cn, eg, eu)
    req = _file(judges["eu"], p, kind="AMEND", changes={"add": [{"realm_code": plan.stop_realm(eu)}]}).data
    before = _shape(p)
    for judge in (judges["eu"], judges["eg"]):
        response = _c(judge).post(f"{PLANS}{p.pk}/requests/{req['id']}/decide/", {"decision": "ACCEPT"}, format="json")
        assert response.status_code == 403 and response.data["code"] == "not_home"
    assert SentencePlanRequest.all_objects.get(pk=req["id"]).status == "PENDING"
    _nothing_changed(p, before, requests=1)
    guardian = plan.officer("cn_guardian", "GUARDIAN", cn)
    assert _c(guardian).post(f"{PLANS}{p.pk}/requests/{req['id']}/decide/", {"decision": "ACCEPT"},
                             format="json").status_code == 403


def test_a_decided_request_cannot_be_decided_again(cn, eg, eu, judges):
    soul, p = _two_stops(cn, eg, eu)
    req = _file(judges["eu"], p, kind="AMEND", changes={"add": [{"realm_code": plan.stop_realm(eu)}]}).data
    url = f"{PLANS}{p.pk}/requests/{req['id']}/decide/"
    assert _c(judges["cn"]).post(url, {"decision": "REJECT"}, format="json").status_code == 200
    before = _shape(p)
    response = _c(judges["cn"]).post(url, {"decision": "ACCEPT"}, format="json")
    assert response.status_code == 409 and response.data["code"] == "request_closed"
    _nothing_changed(p, before, requests=1)


def test_the_requester_withdraws_and_nobody_else_may(cn, eg, eu, judges):
    soul, p = _two_stops(cn, eg, eu)
    req = _file(judges["eu"], p, kind="AMEND", changes={"add": [{"realm_code": plan.stop_realm(eu)}]}).data
    url = f"{PLANS}{p.pk}/requests/{req['id']}/withdraw/"
    response = _c(judges["eg"]).post(url, {}, format="json")
    assert response.status_code == 403 and response.data["code"] == "not_requester"
    assert SentencePlanRequest.all_objects.get(pk=req["id"]).status == "PENDING"
    assert _c(judges["eu"]).post(url, {}, format="json").status_code == 200
    assert SentencePlanRequest.all_objects.get(pk=req["id"]).status == "WITHDRAWN"


def test_accepting_an_eternal_node_before_pending_ones_is_refused(cn, eg, eu, judges):
    """Q5 在批准时再问一遍:情况 1 插在当前节点之后,后面还有未执行的欧洲站 → 永久刑期不能排在它前面。"""
    soul, p = _two_stops(cn, eg, eu)
    case = _open_amendment(judges["eg"], soul)
    _conclude(judges["eg"], case, plan_changes={"add": [{"realm_code": plan.stop_realm(eg, eternal=True)}]})
    req = SentencePlanRequest.all_objects.get(plan=p)
    before = _shape(p)
    response = _c(judges["cn"]).post(f"{PLANS}{p.pk}/requests/{req.pk}/decide/", {"decision": "ACCEPT"}, format="json")
    assert response.status_code == 409 and response.data["code"] == "eternal_not_last"
    req.refresh_from_db()
    assert req.status == "PENDING"
    _nothing_changed(p, before, requests=1)


# ── 重开审判(Q7、N1=(a))──────────────────────────────────────────────


def _reopen_accepted(cn, eg, eu, judges):
    """埃及那站已刑满、灵魂到了欧洲;埃及提 REOPEN,原审判官批准 → 原属立刻开审。"""
    soul, p = _two_stops(cn, eg, eu)
    plan.serve(soul, p, 2)
    plan.arrive(soul, p, 3)
    req = _file(judges["eg"], p, kind="REOPEN", reason="新证据").data
    response = _c(judges["cn"]).post(f"{PLANS}{p.pk}/requests/{req['id']}/decide/", {"decision": "ACCEPT"},
                                     format="json")
    assert response.status_code == 200, response.data
    soul.refresh_from_db()
    return soul, p, Judgment.all_objects.get(soul=soul, kind="REOPEN")


def test_accepting_a_reopen_opens_the_retrial_at_home_while_the_soul_is_away(cn, eg, eu, judges):
    soul, p, retrial = _reopen_accepted(cn, eg, eu, judges)
    p.refresh_from_db()
    assert soul.tenant_id == eu.pk and soul.is_residing
    assert (retrial.tenant_id, retrial.amends_plan_id, retrial.verdict, retrial.civilization) == (
        cn.pk, p.pk, None, "CHINESE")
    assert p.status == "RETRIAL"
    # 原属判官在自己的队列里看得到、结得了这件案。
    queue = _c(judges["cn"]).get("/api/v1/judgment/next/").data
    assert queue["judgment"]["id"] == str(retrial.pk)


def test_during_the_retrial_the_away_stop_goes_on_and_holds_the_soul_when_served(cn, eg, eu, judges):
    soul, p, retrial = _reopen_accepted(cn, eg, eu, judges)
    plan.serve(soul, p, 3)
    soul.refresh_from_db()
    assert plan.node(p, 3).status == "WAITING" and soul.tenant_id == eu.pk


def test_the_retrials_verdict_adds_a_home_node_the_soul_serves_on_return(cn, eg, eu, judges):
    soul, p, retrial = _reopen_accepted(cn, eg, eu, judges)
    plan.serve(soul, p, 3)

    response = _conclude(judges["cn"], retrial)

    assert response.status_code == 200, response.data
    soul.refresh_from_db()
    p.refresh_from_db()
    # 重审结束 → 欧洲那站 WAITING → COMPLETED → 回家 → 新的原属节点(第 4 站)立即开始。
    assert soul.tenant_id == cn.pk and p.status == "ACTIVE"
    assert _shape(p) == [(1, "CN_DIYU", "COMPLETED"), (2, "EG_DUAT", "COMPLETED"), (3, "EU_HEAVEN_HELL", "COMPLETED"),
                         (4, "CN_DIYU", "ACTIVE")]
    new_home = plan.node(p, 4)
    assert new_home.is_home and new_home.added_by_judgment_id == retrial.pk
    disposition = Disposition.all_objects.get(pk=new_home.disposition_id)
    assert disposition.judgment_id == retrial.pk and disposition.tenant_id == cn.pk
    plan.serve(soul, p, 4)
    p.refresh_from_db()
    soul.refresh_from_db()
    assert p.status == "COMPLETED" and soul.current_state == SoulState.REINCARNATING


def test_withdrawing_the_retrial_ends_it_without_a_new_node(cn, eg, eu, judges):
    soul, p, retrial = _reopen_accepted(cn, eg, eu, judges)
    assert _c(judges["cn"]).delete(f"/api/v1/judgment/{retrial.pk}/").status_code == 204
    p.refresh_from_db()
    assert p.status == "ACTIVE" and len(_shape(p)) == 3


def test_a_reopen_waits_while_another_case_is_open(cn, eg, eu, judges):
    """「一个灵魂同时只能有一个未结案审判」不改(Q7):批准答 409 `open_judgment`,请求留在 PENDING。"""
    soul, p = _two_stops(cn, eg, eu)
    open_here = _open_amendment(judges["eg"], soul)
    req = _file(judges["eu"], p, kind="REOPEN", reason="x").data
    response = _c(judges["cn"]).post(f"{PLANS}{p.pk}/requests/{req['id']}/decide/", {"decision": "ACCEPT"},
                                     format="json")
    assert response.status_code == 409 and response.data["code"] == "open_judgment"
    assert response.data["open_judgment_ids"] == [str(open_here.pk)]
    assert SentencePlanRequest.all_objects.get(pk=req["id"]).status == "PENDING"
    assert not Judgment.all_objects.filter(soul=soul, kind="REOPEN").exists()
    p.refresh_from_db()
    assert p.status == "ACTIVE"


def test_the_home_tenant_still_cannot_open_a_case_on_a_residing_soul_by_hand(cn, eg, eu, judges):
    """写例外只在批准 REOPEN 那一处;`POST /judgment/` 不在里面(即使 body 写了 kind)。"""
    soul, p = _two_stops(cn, eg, eu)
    response = _c(judges["cn"]).post("/api/v1/judgment/", {"soul": str(soul.pk), "kind": "REOPEN"}, format="json")
    assert response.status_code == 400 and "soul" in response.data
    assert not Judgment.all_objects.filter(soul=soul, tenant=cn, verdict__isnull=True).exists()


def test_a_retrial_takes_no_plan_changes(cn, eg, eu, judges):
    soul, p, retrial = _reopen_accepted(cn, eg, eu, judges)
    response = _conclude(judges["cn"], retrial, plan_changes={"add": [{"realm_code": "X"}]})
    assert response.status_code == 400 and response.data["code"] == "invalid_changes"
    retrial.refresh_from_db()
    assert retrial.verdict is None


# ── 撤销(Q11;2026-09-19 用户决定:撤销 = 赦免剩余刑期,视为完成)──────────────────


def _cancel(user, p, reason="复核撤销"):
    return _c(user).post(f"{PLANS}{p.pk}/cancel/", {"reason": reason}, format="json")


def test_cancelling_at_home_waives_the_rest_and_the_soul_may_apply_for_rebirth(cn, eg, eu, judges):
    from tests.soul_account_support import ready_soul

    account, client = ready_soul(cn, name="赦免")
    soul = account.soul
    case = Judgment.objects.create(soul=soul, civilization=soul.civilization, tenant=cn)
    plan.bench(case, [(eg, plan.stop_realm(eg), 5), (eu, plan.stop_realm(eu), 7)])
    case.conclude("PASSED", "")
    p = SentencePlan.all_objects.get(soul=soul)
    plan.serve(soul, p, 1)
    [record] = DispatchRecord.all_objects.filter(soul=soul)
    assert client.get("/api/v1/me/rebirth-applications/").data["reason"] == "sentence_in_progress"
    mod = plan.officer("cn_mod", "MODERATOR", cn)

    response = _cancel(mod, p)

    assert response.status_code == 200, response.data
    p.refresh_from_db()
    record.refresh_from_db()
    soul.refresh_from_db()
    assert p.status == "CANCELLED" and p.cancel_reason == "复核撤销" and p.completed_at is not None
    assert _shape(p) == [(1, "CN_DIYU", "COMPLETED"), (2, "EG_DUAT", "CANCELLED"), (3, "EU_HEAVEN_HELL", "CANCELLED")]
    assert record.status == "CANCELLED"
    # 与计划完成同一条路径:进轮回、记转生触发、通知原属判官(撤销的文案)。
    assert soul.current_state == SoulState.REINCARNATING
    assert SoulEvent.objects.filter(soul=soul, event_type="REINCARNATION_TRIGGERED").count() == 1
    [cancelled] = SoulEvent.objects.filter(soul=soul, event_type="SENTENCE_PLAN_CANCELLED")
    assert cancelled.payload["rebirth_open"] is True
    assert not SoulEvent.objects.filter(soul=soul, event_type="SENTENCE_PLAN_COMPLETED").exists()
    assert {n.user_id for n in UserNotification.objects.filter(notification_type="SENTENCE_PLAN_CANCELLED")} == {
        judges["cn"].pk, mod.pk}
    [audit] = AuditLog.objects.filter(resource="sentence_plan", resource_id=str(p.pk))
    assert audit.user_id == mod.pk and audit.changes["reason"] == "复核撤销"
    # Q6:撤销过的计划视为完成,转生申请开放。
    listing = client.get("/api/v1/me/rebirth-applications/").data
    assert listing["can_apply"] is True and listing["reason"] is None


def test_cancelling_pushes_the_pardon_not_the_completion(cn, eg, enqueued):  # noqa: F811
    from apps.soul_push.models import PushDelivery
    from tests.soul_account_support import ready_soul
    from tests.soul_push_support import register

    account, client = ready_soul(cn, name="赦免推送")
    assert register(client).status_code == 201
    soul = account.soul
    case = Judgment.objects.create(soul=soul, civilization=soul.civilization, tenant=cn)
    plan.bench(case, [(eg, plan.stop_realm(eg), 5)])
    case.conclude("PASSED", "")
    p = SentencePlan.all_objects.get(soul=soul)
    PushDelivery.objects.all().delete()
    assert _cancel(plan.officer("cn_mod", "MODERATOR", cn), p, reason="SECRET-REASON").status_code == 200
    [push] = PushDelivery.objects.filter(kind__startswith="sentence_")
    assert (push.kind, push.title) == ("sentence_pardoned", "受刑计划已撤销")
    assert "SECRET" not in push.body and "SECRET" not in push.title


def test_cancelling_while_the_soul_serves_abroad_ends_that_stop_and_brings_it_home(cn, eg, eu, judges):
    soul, p = _two_stops(cn, eg, eu)
    record = DispatchRecord.all_objects.get(pk=plan.node(p, 2).dispatch_record_id)

    assert _cancel(plan.officer("cn_mod", "MODERATOR", cn), p).status_code == 200

    soul.refresh_from_db()
    record.refresh_from_db()
    p.refresh_from_db()
    # 正在受的刑赦免(ABORTED);回归与计划推进里的回归同一个函数,触发记 PLAN_CANCELLED。
    assert _shape(p) == [(1, "CN_DIYU", "COMPLETED"), (2, "EG_DUAT", "ABORTED"), (3, "EU_HEAVEN_HELL", "CANCELLED")]
    assert soul.tenant_id == cn.pk and not soul.is_residing and record.status == "RETURNED"
    [returned] = plan.returned_events(soul)
    assert returned.payload["trigger"] == "PLAN_CANCELLED"
    assert p.status == "CANCELLED" and soul.current_state == SoulState.REINCARNATING
    assert Disposition.all_objects.get(pk=plan.node(p, 2).disposition_id).is_executed is False


def test_cancelling_a_held_plan_brings_the_soul_home_from_its_eternal_stop(cn, eg, judges):
    soul, p, _ = plan.at_stop(cn, eg, eternal=True)
    plan.serve(soul, p, 2)
    assert _cancel(plan.officer("cn_mod", "MODERATOR", cn), p).status_code == 200
    soul.refresh_from_db()
    assert plan.node(p, 2).status == "ABORTED" and soul.tenant_id == cn.pk
    assert soul.current_state == SoulState.REINCARNATING


def test_a_terminal_cosmology_settles_when_its_plan_is_cancelled(eu, eg):
    soul, p, _ = plan.at_stop(eu, eg, name="欧魂")
    assert _cancel(plan.officer("eu_mod", "MODERATOR", eu), p).status_code == 200
    soul.refresh_from_db()
    assert soul.tenant_id == eu.pk and soul.current_state == SoulState.SETTLED
    assert SoulEvent.objects.get(soul=soul, event_type="SENTENCE_PLAN_CANCELLED").payload["rebirth_open"] is False


def test_cancelling_withdraws_the_pending_request_and_the_open_retrial(cn, eg, eu, judges):
    soul, p, retrial = _reopen_accepted(cn, eg, eu, judges)
    assert _cancel(plan.officer("cn_mod", "MODERATOR", cn), p).status_code == 200
    retrial.refresh_from_db()
    soul.refresh_from_db()
    assert retrial.is_deleted and soul.tenant_id == cn.pk
    assert plan.node(p, 3).status == "ABORTED"


def test_a_cancelled_plan_neither_advances_nor_takes_requests(cn, eg, eu, judges):
    from apps.sentence_plan.services import SentencePlanService

    soul, p = _two_stops(cn, eg, eu)
    _cancel(plan.officer("cn_mod", "MODERATOR", cn), p)
    before, records = _shape(p), DispatchRecord.all_objects.filter(soul=soul).count()
    SentencePlanService.advance(soul)
    assert _shape(p) == before and DispatchRecord.all_objects.filter(soul=soul).count() == records
    response = _file(judges["eu"], p, kind="AMEND", changes={"add": [{"realm_code": plan.stop_realm(eu)}]})
    assert response.status_code == 409 and response.data["code"] == "plan_closed"
    assert not SentencePlanRequest.all_objects.filter(plan=p).exists()
    assert _cancel(plan.officer("cn_mod2", "MODERATOR", cn), p).data["code"] == "plan_closed"


@pytest.mark.allow_uncommitted_audit  # 撤销的 AuditLog 由服务直接写(不经 on_commit 信号),「不存在」不是空断言
def test_cancel_refusals_write_nothing(cn, eg, eu, judges):
    soul, p = _two_stops(cn, eg, eu)
    before = _shape(p)
    url = f"{PLANS}{p.pk}/cancel/"
    # 理由必填;JUDGE 不持有 sentence_plan.cancel;执行地的 MODERATOR 不是原属。
    assert _c(plan.officer("cn_mod", "MODERATOR", cn)).post(url, {"reason": ""}, format="json").status_code == 400
    assert _c(judges["cn"]).post(url, {"reason": "x"}, format="json").status_code == 403
    response = _c(plan.officer("eg_mod", "MODERATOR", eg)).post(url, {"reason": "x"}, format="json")
    assert response.status_code == 403 and response.data["code"] == "not_home"
    p.refresh_from_db()
    soul.refresh_from_db()
    assert p.status == "ACTIVE" and p.cancel_reason == "" and soul.tenant_id == eg.pk
    _nothing_changed(p, before)
    assert not AuditLog.objects.filter(resource="sentence_plan").exists()


@pytest.mark.allow_uncommitted_audit
def test_an_open_case_blocks_the_cancel_like_it_blocks_completion(cn, eg, eu, judges):
    """与正常完成一致:未结案审判拦住回归与完成 → 撤销答 409 `open_judgment`,什么都不写。"""
    soul, p = _two_stops(cn, eg, eu)
    case = _open_amendment(judges["eg"], soul)
    before = _shape(p)
    response = _cancel(plan.officer("cn_mod", "MODERATOR", cn), p)
    assert response.status_code == 409 and response.data["code"] == "open_judgment"
    assert response.data["open_judgment_ids"] == [str(case.pk)]
    p.refresh_from_db()
    soul.refresh_from_db()
    assert p.status == "ACTIVE" and soul.tenant_id == eg.pk and soul.current_state == SoulState.DISPOSED
    _nothing_changed(p, before)
    assert not AuditLog.objects.filter(resource="sentence_plan").exists()


def test_the_service_itself_refuses_a_blank_reason(cn, eg):
    """接口的序列化器先挡了空理由;服务层的这一道守非 API 的调用方(管理命令、shell)。"""
    from apps.sentence_plan import requests as plan_requests

    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5)])
    before = _shape(p)
    with pytest.raises(plan_requests.PlanChangeRefusedError) as refused:
        plan_requests.cancel(p, reason="   ", user=None)
    assert refused.value.code == "reason_required"
    p.refresh_from_db()
    assert p.status == "ACTIVE"
    _nothing_changed(p, before)


def test_a_finished_plan_cannot_be_cancelled(cn, judges):
    soul, p = plan.planned(cn)
    plan.serve(soul, p, 1)
    response = _c(plan.officer("cn_mod", "MODERATOR", cn)).post(f"{PLANS}{p.pk}/cancel/", {"reason": "x"}, format="json")
    assert response.status_code == 409 and response.data["code"] == "plan_closed"
    p.refresh_from_db()
    assert p.status == "COMPLETED" and p.cancel_reason == ""


def test_admin_of_another_tenant_can_cancel(cn, eg, eu, judges):
    soul, p = _two_stops(cn, eg, eu)
    admin = plan.officer("eu_admin", "ADMIN", eu)
    assert _c(admin).post(f"{PLANS}{p.pk}/cancel/", {"reason": "修数据"}, format="json").status_code == 200
